import { toError } from './to-error';

export interface CaptureExtras {
  tags?: string[];
  customData?: Record<string, unknown>;
}

/** A window, or a worker / service worker global scope. */
export type HookTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

// `window` in pages, `self` in workers and extension service workers
function defaultTarget(): HookTarget | null {
  if (typeof globalThis.addEventListener !== 'function') return null;
  return globalThis;
}

export type ErrorCapture = (error: Error, extras?: CaptureExtras) => void;

function errorFromEvent(event: ErrorEvent): Error {
  if (event.error instanceof Error) return event.error;
  if (event.error != null) return toError(event.error);

  // Cross-origin scripts yield "Script error." with no Error object;
  // synthesize one so the location still reaches the stack parser.
  const error = new Error(event.message || 'Unknown error');
  error.stack = `${error.message}\n    at ${event.filename || '<anonymous>'}:${
    event.lineno || 0
  }:${event.colno || 0}`;
  return error;
}

function errorFromRejection(event: PromiseRejectionEvent): Error {
  if (event.reason == null) {
    const error = new Error(`Promise rejected with ${event.reason}`);
    error.name = 'UnhandledRejection';
    return error;
  }
  return toError(event.reason, 'UnhandledRejection');
}

/**
 * Global handlers for uncaught errors and unhandled promise rejections.
 * Uses addEventListener rather than overriding window.onerror, so it
 * composes with other handlers and detaches cleanly.
 */
export class WindowHooks {
  private target: HookTarget | null = null;

  constructor(private readonly capture: ErrorCapture) {}

  private readonly onError = (event: Event): void => {
    this.capture(errorFromEvent(event as ErrorEvent), {
      tags: ['UnhandledException'],
    });
  };

  private readonly onRejection = (event: Event): void => {
    this.capture(errorFromRejection(event as PromiseRejectionEvent), {
      tags: ['UnhandledPromiseRejection'],
    });
  };

  attach(target?: HookTarget): void {
    if (this.target) return;

    const resolved = target ?? defaultTarget();
    if (!resolved) return;

    this.target = resolved;
    this.target.addEventListener('error', this.onError);
    this.target.addEventListener('unhandledrejection', this.onRejection);
  }

  detach(): void {
    if (!this.target) return;

    this.target.removeEventListener('error', this.onError);
    this.target.removeEventListener('unhandledrejection', this.onRejection);
    this.target = null;
  }
}
