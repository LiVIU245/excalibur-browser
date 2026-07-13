import type { WireRequest } from './payload';

export function collectRequest(): WireRequest | undefined {
  if (typeof location === 'undefined') return undefined;

  const queryString: Record<string, string> = {};
  new URLSearchParams(location.search).forEach((value, key) => {
    queryString[key] = value;
  });

  const headers: Record<string, string> = {
    'User-Agent': navigator.userAgent,
  };
  if (typeof document !== 'undefined' && document.referrer) {
    headers.Referer = document.referrer;
  }

  return {
    Url: location.origin + location.pathname,
    QueryString: queryString,
    Headers: headers,
  };
}
