import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockAnswer, type MockPayload } from './mock-llm.ts';

/**
 * One local server for the e2e suite: serves the built fixture pages under /fixtures/ and
 * answers the LLM endpoint with deterministic decisions. It also records what it was sent,
 * so tests can assert on exactly what leaves the browser.
 */
export const PORT = 4319;

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/dist', import.meta.url));
/** The same pages under a second path, to stand for another job on the same portal. */
const FIXTURE_PREFIXES = /^\/(?:alt\/)?fixtures\//;
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

interface LlmRequestBody {
  messages: { role: string; content: string }[];
}

/** Requests received, by the API key that sent them. Each test uses its own key. */
const received = new Map<string, LlmRequestBody[]>();

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function serveFixture(pathname: string, response: ServerResponse): Promise<void> {
  const relative = normalize(pathname.replace(FIXTURE_PREFIXES, ''));
  if (relative.startsWith('..')) {
    sendJson(response, 400, { error: 'Bad path' });
    return;
  }
  const file = join(FIXTURES_DIR, relative.endsWith('/') ? `${relative}index.html` : relative);
  try {
    const content = await readFile(file);
    response.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file)] ?? 'text/plain' });
    response.end(content);
  } catch {
    sendJson(response, 404, { error: `Not found: ${pathname}` });
  }
}

async function answerLlm(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = JSON.parse(await readBody(request)) as LlmRequestBody;
  const key = String(request.headers['x-api-key'] ?? '');
  received.set(key, [...(received.get(key) ?? []), body]);
  const payload = JSON.parse(body.messages[0]?.content ?? '{}') as MockPayload;
  sendJson(response, 200, {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(mockAnswer(payload)) }],
  });
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const { pathname, searchParams } = new URL(request.url ?? '/', `http://localhost:${PORT}`);
  if (pathname === '/health') {
    sendJson(response, 200, { ok: true });
  } else if (pathname === '/v1/messages' && request.method === 'POST') {
    await answerLlm(request, response);
  } else if (pathname === '/mock/requests') {
    sendJson(response, 200, received.get(searchParams.get('key') ?? '') ?? []);
  } else if (FIXTURE_PREFIXES.test(pathname)) {
    await serveFixture(pathname, response);
  } else {
    sendJson(response, 404, { error: `Not found: ${pathname}` });
  }
}

createServer((request, response) => {
  route(request, response).catch((error: unknown) => {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  });
}).listen(PORT);
