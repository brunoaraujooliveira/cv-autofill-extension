export const PROVIDER_CONFIG = {
  origin: 'https://api.anthropic.com',
  messagesPath: '/v1/messages',
  defaultModel: 'claude-sonnet-5-5',
  maxOutputTokens: 16000,
  effort: 'medium',
} as const;

export const PROVIDER_HOST_PERMISSION = `${PROVIDER_CONFIG.origin}/*`;

export const PROVIDER_ENDPOINT = `${PROVIDER_CONFIG.origin}${PROVIDER_CONFIG.messagesPath}`;

export function buildProviderHeaders(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    // Required because the request leaves from a browser context (the service worker).
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}
