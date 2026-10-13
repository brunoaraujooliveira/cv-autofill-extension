import { describe, expect, it, vi } from 'vitest';
import { HttpLlmClient, LlmError } from '../../../src/background/llm/client';

const ENDPOINT = 'http://llm.test/v1/messages';
const REQUEST = {
  apiKey: 'key-1',
  model: 'model-1',
  system: 'system prompt',
  user: '{"fields":[]}',
  schema: { type: 'object' },
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}

const answer = (text: string, stopReason = 'end_turn') =>
  jsonResponse({ stop_reason: stopReason, content: [{ type: 'text', text }] });

function createClient(...responses: (Response | Error)[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) {
    if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
    else fetchMock.mockResolvedValueOnce(response);
  }
  const sleep = vi.fn().mockResolvedValue(undefined);
  return {
    client: new HttpLlmClient({ endpoint: ENDPOINT, fetch: fetchMock, sleep }),
    fetchMock,
    sleep,
  };
}

async function failure(promise: Promise<unknown>): Promise<LlmError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof LlmError)) throw new Error('Expected an LlmError');
  return error;
}

describe('HttpLlmClient', () => {
  it('posts the request and returns the parsed JSON answer', async () => {
    const { client, fetchMock } = createClient(answer('{"decisions":[]}'));

    expect(await client.completeJson(REQUEST)).toEqual({ decisions: [] });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(url).toBe(ENDPOINT);
    expect(init?.method).toBe('POST');
    expect(Object.values(init?.headers ?? {})).toContain('key-1');
    expect(body).toMatchObject({
      model: 'model-1',
      system: 'system prompt',
      messages: [{ role: 'user', content: '{"fields":[]}' }],
      output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
    });
    expect(JSON.stringify(body)).not.toContain('key-1');
  });

  it('skips non-text blocks when reading the answer', async () => {
    const { client } = createClient(
      jsonResponse({
        stop_reason: 'end_turn',
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: '{"ok":true}' },
        ],
      }),
    );
    expect(await client.completeJson(REQUEST)).toEqual({ ok: true });
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [400, 'bad_request'],
    [404, 'bad_request'],
  ] as const)('maps HTTP %i to a %s error without retrying', async (status, kind) => {
    const { client, fetchMock } = createClient(
      jsonResponse({ type: 'error', error: { type: 'x', message: 'nope' } }, { status }),
    );
    const error = await failure(client.completeJson(REQUEST));

    expect(error.kind).toBe(kind);
    expect(error.message).toBe(`HTTP ${status}: nope`);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('retries rate limits, honoring retry-after, then succeeds', async () => {
    const { client, sleep, fetchMock } = createClient(
      jsonResponse({}, { status: 429, headers: { 'retry-after': '3' } }),
      answer('{"ok":true}'),
    );

    expect(await client.completeJson(REQUEST)).toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledExactlyOnceWith(3000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries server and network failures with backoff, then gives up', async () => {
    const { client, sleep, fetchMock } = createClient(
      new TypeError('Failed to fetch'),
      jsonResponse({}, { status: 529 }),
      jsonResponse({}, { status: 500, statusText: 'Server Error' }),
    );
    const error = await failure(client.completeJson(REQUEST));

    expect(error.kind).toBe('unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
  });

  it('reports a network error when every attempt fails to connect', async () => {
    const offline = new TypeError('Failed to fetch');
    const { client } = createClient(offline, offline, offline);
    expect((await failure(client.completeJson(REQUEST))).kind).toBe('network');
  });

  it.each([
    ['a refusal', answer('', 'refusal'), 'refusal'],
    ['a truncated answer', answer('{"decisions":[', 'max_tokens'), 'invalid_response'],
    ['text that is not JSON', answer('Sure! Here you go'), 'invalid_response'],
    [
      'an answer without text',
      jsonResponse({ stop_reason: 'end_turn', content: [] }),
      'invalid_response',
    ],
    ['an unexpected body', jsonResponse({ hello: 'world' }), 'invalid_response'],
    ['a body that is not JSON', new Response('<html>', { status: 200 }), 'invalid_response'],
  ] as const)('turns %s into an error without retrying', async (_, response, kind) => {
    const { client, fetchMock } = createClient(response);
    expect((await failure(client.completeJson(REQUEST))).kind).toBe(kind);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
