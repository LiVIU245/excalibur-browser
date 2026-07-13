import { sendEntry, type ApiOptions } from './api';
import { BreadcrumbBuffer, type Breadcrumb } from './breadcrumbs';
import { collectEnvironment } from './environment';
import { collectRequest } from './request';
import { SessionManager } from './session';
import { parseStackTrace, toWireFrame } from './stack-trace';
import { anonymousUser, toWireUser, type UserDetails } from './user';
import { CLIENT_NAME, CLIENT_VERSION } from './version';
import { WindowHooks, type CaptureExtras } from './window-hooks';
import type { IngestPayload } from './payload';

export interface ExcaliburClientOptions {
  /** SDK key minted with the application (exc_...). */
  apiKey: string;

  /**
   * Ingest endpoint — an absolute URL to the Excalibur server, or a path
   * relative to the current origin. Defaults to `/api/entries`.
   */
  endpoint: string;

  /** Application version reported with every entry. */
  version: string;

  /** Tags appended to every entry. */
  tags: string[];

  /**
   * An alternative fetch function to use instead of the global fetch. Useful
   * in nonstandard runtime environments, such as edge workers or tests.
   */
  fetch: typeof fetch;

  /** Inspect or mutate each payload before sending; return null to drop it. */
  beforeSend: (payload: IngestPayload) => IngestPayload | null;

  /** Maximum breadcrumbs attached to an entry. Defaults to 32. */
  breadcrumbLimit: number;
}

function ensureError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : JSON.stringify(value));
}

/**
 * A client for the Excalibur log ingestion API.
 * - Reuse a single instance per page; construct it once at app startup.
 * - Call {@link attach} to capture uncaught errors and unhandled rejections.
 */
export class ExcaliburClient {
  private readonly apiOptions: ApiOptions;
  private readonly session = new SessionManager();
  private readonly breadcrumbs: BreadcrumbBuffer;
  private readonly hooks: WindowHooks;
  private readonly options: Partial<ExcaliburClientOptions>;
  private user: UserDetails | null = null;

  constructor(options: { apiKey: string } & Partial<ExcaliburClientOptions>) {
    this.options = options;
    this.apiOptions = {
      apiKey: options.apiKey,
      endpoint: options.endpoint ?? '/api/entries',
      fetch: options.fetch ?? ((...args) => fetch(...args)),
    };
    this.breadcrumbs = new BreadcrumbBuffer(options.breadcrumbLimit);
    this.hooks = new WindowHooks((error, extras) => {
      void this.send(error, extras).catch((sendError) => {
        console.error('[excalibur] failed to report error', sendError);
      });
    });
  }

  /** Hooks uncaught errors and unhandled promise rejections on window. */
  attach(target?: Window): this {
    this.hooks.attach(target);
    return this;
  }

  detach(): this {
    this.hooks.detach();
    return this;
  }

  /** Registers the end user attached to every subsequent entry. */
  setUser(user: UserDetails): this {
    this.user = { isAnonymous: false, ...user };
    return this;
  }

  /** Reverts to the persisted anonymous identity. */
  clearUser(): this {
    this.user = null;
    return this;
  }

  get sessionId(): string | null {
    return this.session.id;
  }

  /** Starts a fresh session and returns its id. */
  startSession(): string {
    return this.session.start();
  }

  endSession(): void {
    this.session.end();
  }

  recordBreadcrumb(
    message: string,
    crumb?: Omit<Breadcrumb, 'message'>,
  ): this {
    this.breadcrumbs.record({ message, ...crumb });
    return this;
  }

  /** Sends an error to the ingest API. Non-Error values are wrapped. */
  async send(error: unknown, extras?: CaptureExtras): Promise<void> {
    const payload = this.buildPayload(ensureError(error), extras);

    const final = this.options.beforeSend
      ? this.options.beforeSend(payload)
      : payload;
    if (!final) return;

    await sendEntry(final, this.apiOptions);
  }

  private buildPayload(error: Error, extras?: CaptureExtras): IngestPayload {
    const tags = [...(this.options.tags ?? []), ...(extras?.tags ?? [])];

    return {
      OccurredOn: new Date().toISOString(),
      Details: {
        Error: {
          ClassName: error.name || 'Error',
          Message: error.message || 'Unknown error',
          StackString: error.stack,
          StackTrace: parseStackTrace(error.stack).map(toWireFrame),
        },
        Environment: collectEnvironment(),
        Client: { Name: CLIENT_NAME, Version: CLIENT_VERSION },
        Request: collectRequest(),
        Version: this.options.version,
        Tags: tags.length ? tags : undefined,
        UserCustomData: extras?.customData,
        User: toWireUser(this.user ?? anonymousUser()),
        SessionId: this.session.getOrStart(),
        Breadcrumbs: this.breadcrumbs.snapshot(),
      },
    };
  }
}
