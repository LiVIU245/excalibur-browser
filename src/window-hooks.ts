export interface CaptureExtras {
  tags?: string[];
  customData?: Record<string, unknown>;
}

export type ErrorCapture = (error: Error, extras?: CaptureExtras) => void;

function errorFromEvent(event: ErrorEvent): Error {
  if (event.error instanceof Error) return event.error;

  // Cross-origin scripts yield "Script error." with no Error object;
  // synthesize one so the location still reaches the stack parser.
  const error = new Error(event.message || 'Unknown error');
  error.stack = `${error.message}\n    at ${event.filename || '<anonymous>'}:${
    event.lineno || 0
  }:${event.colno || 0}`;
  return error;
}

function errorFromRejection(event: PromiseRejectionEvent): Error {
  if (event.reason instanceof Error) return event.reason;

  const error = new Error(
    typeof event.reason === 'string' ? event.reason : JSON.stringify(event.reason),
  );
  error.name = 'UnhandledRejection';
  return error;
}

/**
 * Global handlers for uncaught errors and unhandled promise rejections.
 * Uses addEventListener rather than overriding window.onerror, so it
 * composes with other handlers and detaches cleanly.
 */
export class WindowHooks {
  private target: Window | null = null;

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

  attach(target?: Window): void {
    if (this.target) return;
    if (!target && typeof window === 'undefined') return;

    this.target = target ?? window;
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
