import { z } from 'zod';
import { buildProviderHeaders, PROVIDER_CONFIG } from './provider-config';

export type LlmErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'unavailable'
  | 'network'
  | 'refusal'
  | 'invalid_response'
  | 'bad_request';

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface JsonCompletionRequest {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  /** JSON Schema the answer must follow. */
  schema: object;
}

export interface LlmClient {
  /** Returns the parsed JSON the model answered with; its shape is not validated here. */
  completeJson(request: JsonCompletionRequest): Promise<unknown>;
}

export interface HttpLlmClientOptions {
  endpoint: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}

const responseSchema = z.object({
  stop_reason: z.string().nullable(),
  content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })),
});

const errorBodySchema = z.object({ error: z.object({ message: z.string() }) });

const RETRYABLE: ReadonlySet<LlmErrorKind> = new Set(['rate_limit', 'unavailable', 'network']);
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 20000;

function kindForStatus(status: number): LlmErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'unavailable';
  return 'bad_request';
}

async function errorFromResponse(response: Response): Promise<LlmError> {
  const body = errorBodySchema.safeParse(await response.json().catch(() => null));
  const detail = body.success ? body.data.error.message : response.statusText;
  return new LlmError(kindForStatus(response.status), `HTTP ${response.status}: ${detail}`);
}

function retryDelayMs(response: Response | null, attempt: number): number {
  const retryAfterSeconds = Number(response?.headers.get('retry-after'));
  const delay =
    Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

function parseAnswer(body: unknown): unknown {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new LlmError('invalid_response', 'Unexpected response shape');
  const { stop_reason: stopReason, content } = parsed.data;
  if (stopReason === 'refusal') throw new LlmError('refusal', 'The model declined the request');
  if (stopReason === 'max_tokens') {
    throw new LlmError('invalid_response', 'The answer was cut off by the output limit');
  }
  const text = content.find((block) => block.type === 'text')?.text;
  if (text === undefined) throw new LlmError('invalid_response', 'The answer has no text');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LlmError('invalid_response', 'The answer is not valid JSON');
  }
}

export class HttpLlmClient implements LlmClient {
  private readonly endpoint: string;
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;

  constructor(options: HttpLlmClientOptions) {
    this.endpoint = options.endpoint;
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  async completeJson(request: JsonCompletionRequest): Promise<unknown> {
    for (let attempt = 1; ; attempt += 1) {
      let response: Response | null = null;
      try {
        response = await this.send(request);
        if (!response.ok) throw await errorFromResponse(response);
        return parseAnswer(await response.json().catch(() => null));
      } catch (error) {
        const llmError =
          error instanceof LlmError
            ? error
            : new LlmError('network', error instanceof Error ? error.message : String(error));
        if (!RETRYABLE.has(llmError.kind) || attempt >= this.maxAttempts) throw llmError;
        await this.sleep(retryDelayMs(response, attempt));
      }
    }
  }

  private send(request: JsonCompletionRequest): Promise<Response> {
    return this.fetch(this.endpoint, {
      method: 'POST',
      headers: buildProviderHeaders(request.apiKey),
      body: JSON.stringify({
        model: request.model,
        max_tokens: PROVIDER_CONFIG.maxOutputTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
        output_config: {
          effort: PROVIDER_CONFIG.effort,
          format: { type: 'json_schema', schema: request.schema },
        },
      }),
    });
  }
}
