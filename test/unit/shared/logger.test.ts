import { describe, expect, it, vi } from 'vitest';
import { createLogger, redact } from '../../../src/shared/logger';

describe('redact', () => {
  it('hides secrets and resume content at any depth', () => {
    const input = {
      model: 'm1',
      apiKey: 'secret',
      request: { headers: { 'X-Api-Key': 'secret', accept: 'json' }, resume: { basics: {} } },
      items: [{ cv: 'text' }],
    };
    expect(redact(input)).toEqual({
      model: 'm1',
      apiKey: '[redacted]',
      request: { headers: { 'X-Api-Key': '[redacted]', accept: 'json' }, resume: '[redacted]' },
      items: [{ cv: '[redacted]' }],
    });
  });

  it('does not change the original value', () => {
    const input = { apiKey: 'secret' };
    redact(input);
    expect(input.apiKey).toBe('secret');
  });

  it('passes primitives through and summarizes errors', () => {
    expect(redact('text')).toBe('text');
    expect(redact(null)).toBeNull();
    expect(redact(new TypeError('boom'))).toEqual({ name: 'TypeError', message: 'boom' });
  });

  it('survives circular references', () => {
    const input: Record<string, unknown> = { name: 'loop' };
    input.self = input;
    expect(redact(input)).toEqual({ name: 'loop', self: '[circular]' });
  });
});

describe('createLogger', () => {
  it('prefixes the scope and redacts the context', () => {
    const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const logger = createLogger('test', sink);

    logger.info('started');
    logger.warn('careful', { apiKey: 'secret' });
    logger.error('failed', new Error('boom'));

    expect(sink.info).toHaveBeenCalledWith('[cv-autofill:test] started');
    expect(sink.warn).toHaveBeenCalledWith('[cv-autofill:test] careful', { apiKey: '[redacted]' });
    expect(sink.error).toHaveBeenCalledWith('[cv-autofill:test] failed', {
      name: 'Error',
      message: 'boom',
    });
  });
});
