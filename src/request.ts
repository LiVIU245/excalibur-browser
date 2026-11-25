import type { WireRequest } from './payload';

export type ParamMatcher = string | RegExp;

const REDACTED = '[redacted]';

// Query parameters that usually carry credentials (reset tokens, OAuth codes, signed URLs)
const SENSITIVE_NAME = /token|secret|passw|pwd|auth|session|signature|credential|jwt|otp|api[-_]?key/i;
const SENSITIVE_EXACT = new Set(['code', 'key', 'sig', 'pin']);

function isSensitive(name: string, extra: ParamMatcher[]): boolean {
  const lower = name.toLowerCase();
  if (SENSITIVE_EXACT.has(lower) || SENSITIVE_NAME.test(name)) return true;

  return extra.some((matcher) =>
    typeof matcher === 'string' ? matcher.toLowerCase() === lower : matcher.test(name),
  );
}

function redactParams(search: string, extra: ParamMatcher[]): Record<string, string> {
  const params: Record<string, string> = {};
  new URLSearchParams(search).forEach((value, key) => {
    params[key] = isSensitive(key, extra) ? REDACTED : value;
  });
  return params;
}

// Referrer without its fragment and with the same redaction as the page's own query
function redactUrl(raw: string, extra: ParamMatcher[]): string | undefined {
  try {
    const url = new URL(raw);
    const params = redactParams(url.search, extra);
    const query = Object.keys(params)
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');
    return url.origin + url.pathname + (query ? `?${query}` : '');
  } catch {
    return undefined;
  }
}

export function collectRequest(redact: ParamMatcher[] = []): WireRequest | undefined {
  if (typeof location === 'undefined') return undefined;

  const headers: Record<string, string> = {};
  if (typeof navigator !== 'undefined') headers['User-Agent'] = navigator.userAgent;

  const referrer = typeof document !== 'undefined' && document.referrer
    ? redactUrl(document.referrer, redact)
    : undefined;
  if (referrer) headers.Referer = referrer;

  return {
    Url: location.origin + location.pathname,
    QueryString: redactParams(location.search, redact),
    Headers: headers,
  };
}
