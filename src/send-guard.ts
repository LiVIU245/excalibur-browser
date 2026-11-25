import type { IngestPayload } from './payload';

const DEFAULT_BACKOFF_MS = 60_000;
const DUPLICATE_WINDOW_MS = 1_000;
const MAX_TRACKED_ERRORS = 100;
const MINUTE_MS = 60_000;

export const DEFAULT_MAX_PER_MINUTE = 10;

export interface SendLimits {
  maxPerMinute?: number;
}

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
 * Keeps an error loop from flooding the API:
 * - drops repeats of the same error within a second,
 * - caps events per minute, whatever their message (no lifetime cap: extension
 *   background scripts and long-lived tabs must keep reporting),
 * - pauses while the server says to back off, and stops for good on a rejected key.
 */
export class SendGuard {
  private blockedUntil = 0;
  private disabled = false;
  private recent: number[] = [];
  private warned = false;
  private readonly lastSent = new Map<string, number>();
  private readonly maxPerMinute: number;

  constructor(limits: SendLimits = {}) {
    this.maxPerMinute = limits.maxPerMinute ?? DEFAULT_MAX_PER_MINUTE;
  }

  /** True when the payload should be sent, recording it as sent. */
  allow(payload: IngestPayload): boolean {
    if (this.disabled) return false;

    const now = Date.now();
    if (now < this.blockedUntil) return false;

    const key = signature(payload);
    const last = this.lastSent.get(key);
    if (last !== undefined && now - last < DUPLICATE_WINDOW_MS) return false;

    this.recent = this.recent.filter((sentAt) => now - sentAt < MINUTE_MS);
    if (this.recent.length >= this.maxPerMinute) {
      return this.capped(`over ${this.maxPerMinute} events a minute, dropping the rest`);
    }

    // Bounded memory: forget everything rather than track the oldest entry
    if (this.lastSent.size >= MAX_TRACKED_ERRORS) this.lastSent.clear();
    this.lastSent.set(key, now);
    this.recent.push(now);
    this.warned = false;
    return true;
  }

  /** Pauses all sends after a 429 (rate limited) or 503 (server overloaded). */
  backOff(response: Response): boolean {
    if (response.status !== 429 && response.status !== 503) return false;
    this.blockedUntil = Date.now() + retryAfterMs(response);
    return true;
  }

  /** Stops all sends for the life of the page after a 401/403: the key is wrong or revoked. */
  rejectKey(response: Response): boolean {
    if (response.status !== 401 && response.status !== 403) return false;
    this.disabled = true;
    return true;
  }

  // One warning per dropped streak, not one per dropped event
  private capped(reason: string): false {
    if (!this.warned) console.warn(`[excalibur] ${reason}`);
    this.warned = true;
    return false;
  }
}
