const REDACTED = '[redacted]';
const SENSITIVE_KEYS = new Set(['apikey', 'api_key', 'x-api-key', 'authorization', 'resume', 'cv']);

/** Deep-copies a value replacing secrets and resume content, so it is safe to print. */
export function redact(value: unknown, seen = new WeakSet()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redact(item, seen),
    ]),
  );
}

export interface Logger {
  info(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  error(message: string, context?: unknown): void;
}

type Sink = Pick<Console, 'info' | 'warn' | 'error'>;

export function createLogger(scope: string, sink: Sink = console): Logger {
  const write = (level: keyof Sink) => (message: string, context?: unknown) => {
    const line = `[cv-autofill:${scope}] ${message}`;
    if (context === undefined) sink[level](line);
    else sink[level](line, redact(context));
  };
  return { info: write('info'), warn: write('warn'), error: write('error') };
}
