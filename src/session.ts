import { generateUuid } from './uuid';

const SESSION_STORAGE_KEY = 'excalibur:session-id';

function defaultStorage(): Storage | null {
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage;
}

/**
 * Manages the session identifier attached to every entry.
 * - Persisted in sessionStorage so a session spans page loads within a tab.
 * - Falls back to in-memory storage when sessionStorage is unavailable.
 */
export class SessionManager {
  private memoryId: string | null = null;

  constructor(private readonly storage: Storage | null = defaultStorage()) {}

  get id(): string | null {
    if (!this.storage) return this.memoryId;

    try {
      return this.storage.getItem(SESSION_STORAGE_KEY);
    } catch {
      return this.memoryId;
    }
  }

  /** Returns the current session id, creating one if none exists. */
  getOrStart(): string {
    const existing = this.id;
    if (existing) return existing;
    return this.start();
  }

  /** Starts a fresh session, replacing any existing one. */
  start(): string {
    const id = generateUuid();
    this.memoryId = id;

    try {
      this.storage?.setItem(SESSION_STORAGE_KEY, id);
    } catch {
      // Storage full or denied (private mode); memory fallback covers it.
    }

    return id;
  }

  end(): void {
    this.memoryId = null;

    try {
      this.storage?.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignore; nothing to clean up if storage is unavailable.
    }
  }
}
