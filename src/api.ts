import { ApiError } from './errors';
import type { IngestPayload } from './payload';

// keepalive requests are capped at 64KiB; larger bodies fall back to a plain fetch.
const KEEPALIVE_BODY_LIMIT = 60_000;

export interface ApiOptions {
  apiKey: string;
  endpoint: string;
  fetch: typeof fetch;
}

function resolveUrl(endpoint: string, apiKey: string): string {
  const base =
    typeof location === 'undefined' ? 'http://localhost' : location.href;
  const url = new URL(endpoint, base);
  url.searchParams.set('apikey', apiKey);
  return url.toString();
}

export async function sendEntry(
  payload: IngestPayload,
  options: ApiOptions,
): Promise<void> {
  const body = JSON.stringify(payload);
  const fetchFn = options.fetch;

  const response = await fetchFn(resolveUrl(options.endpoint, options.apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: body.length < KEEPALIVE_BODY_LIMIT,
  });

  if (!response.ok) {
    throw await ApiError.fromResponse(response);
  }
}
