import type { IngestPayload } from './payload';

const DEFAULT_BACKOFF_MS = 60_000;
const DUPLICATE_WINDOW_MS = 1_000;
const MAX_TRACKED_ERRORS = 100;

// Same class, message and throw site = same error
function signature(payload: IngestPayload): string {
  const error = payload.Details?.Error;
  const top = error?.StackTrace?.[0];
  return [
    error?.ClassName,
    error?.Message,
    top?.FileName,
    top?.LineNumber,
    top?.ColumnNumber,
  ].join('|');
}

function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get('Retry-After'));
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_BACKOFF_MS;
  return seconds * 1000;
}

/**
 * Keeps an error loop from flooding the API: drops repeats of the same error
 * within a few seconds, and stops sending while the server says to back off.
 */
export class SendGuard {
  private blockedUntil = 0;
  private readonly lastSent = new Map<string, number>();

  /** True when the payload should be sent, recording it as sent. */
  allow(payload: IngestPayload): boolean {
    const now = Date.now();
    if (now < this.blockedUntil) return false;

    const key = signature(payload);
    const last = this.lastSent.get(key);
    if (last !== undefined && now - last < DUPLICATE_WINDOW_MS) return false;

    // Bounded memory: forget everything rather than track the oldest entry
    if (this.lastSent.size >= MAX_TRACKED_ERRORS) this.lastSent.clear();
    this.lastSent.set(key, now);
    return true;
  }

  /** Pauses all sends after a 429 (rate limited) or 503 (server overloaded). */
  backOff(response: Response): boolean {
    if (response.status !== 429 && response.status !== 503) return false;
    this.blockedUntil = Date.now() + retryAfterMs(response);
    return true;
  }
}
