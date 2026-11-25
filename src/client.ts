import { sendEntry, type ApiOptions } from './api';
import { BreadcrumbBuffer, type Breadcrumb } from './breadcrumbs';
import { collectEnvironment } from './environment';
import { applyLimits } from './limits';
import { SendGuard } from './send-guard';
import { ApiError } from './errors';
import { collectRequest, type ParamMatcher } from './request';
import { SessionManager } from './session';
import { parseStackTrace, toWireFrame } from './stack-trace';
import { toError } from './to-error';
import { anonymousUser, toWireUser, type UserDetails } from './user';
import { CLIENT_NAME, CLIENT_VERSION } from './version';
import { WindowHooks, type CaptureExtras, type HookTarget } from './window-hooks';
import type { IngestPayload } from './payload';

const DEFAULT_ENDPOINT = 'https://excalibur.codes/api/entries';

// Browser noise that is never actionable
const DEFAULT_IGNORED_ERRORS: Array<string | RegExp> = [/^ResizeObserver loop/];

export interface ExcaliburOptions {
  /** SDK key minted with the application (exc_...). */
  apiKey: string;

  /**
   * Ingest endpoint — an absolute URL to the Excalibur server, or a path
   * relative to the current origin. Defaults to the hosted Excalibur ingest API.
   */
  endpoint: string;

  /** Application version reported with every entry. */
  version: string;

  /** Deployment environment (production, staging...) reported with every entry. */
  environment: string;

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

  /**
   * Extra query parameter names whose values are replaced with "[redacted]" in
   * the reported URL and referrer. Common credential names (token, code,
   * password, key, secret, session, auth...) are always redacted.
   */
  redactParams: ParamMatcher[];

  /**
   * Errors to drop, matched against the message: a string matches as a
   * substring, a RegExp is tested. Added to the built-in list.
   */
  ignoreErrors: Array<string | RegExp>;

  /** Most events sent per minute; the rest are dropped. Defaults to 10. */
  maxPerMinute: number;

  /**
   * Attribute entries to a random id kept in localStorage until setUser() is
   * called. Set to false to store nothing and send no user for anonymous
   * visitors. Defaults to true.
   */
  anonymousId: boolean;
}

function matches(message: string, patterns: Array<string | RegExp>): boolean {
  return patterns.some((pattern) =>
    typeof pattern === 'string' ? message.includes(pattern) : pattern.test(message),
  );
}

/**
 * A client for the Excalibur log ingestion API.
 * - Reuse a single instance per page; construct it once at app startup.
 * - Call {@link attach} to capture uncaught errors and unhandled rejections.
 */
export class Excalibur {
  private readonly apiOptions: ApiOptions;
  private readonly session = new SessionManager();
  private readonly breadcrumbs: BreadcrumbBuffer;
  private readonly hooks: WindowHooks;
  private readonly options: Partial<ExcaliburOptions>;
  private user: UserDetails | null = null;
  private readonly guard: SendGuard;
  private readonly ignored: Array<string | RegExp>;

  constructor(options: { apiKey: string } & Partial<ExcaliburOptions>) {
    this.options = options;
    this.apiOptions = {
      apiKey: options.apiKey,
      endpoint: options.endpoint ?? DEFAULT_ENDPOINT,
      fetch: options.fetch ?? ((...args) => fetch(...args)),
    };
    this.guard = new SendGuard({ maxPerMinute: options.maxPerMinute });
    this.ignored = [...DEFAULT_IGNORED_ERRORS, ...(options.ignoreErrors ?? [])];
    this.breadcrumbs = new BreadcrumbBuffer(options.breadcrumbLimit);
    this.hooks = new WindowHooks((error, extras) => {
      void this.send(error, extras).catch((sendError) => {
        console.error('[excalibur] failed to report error', sendError);
      });
    });
  }

  /**
   * Hooks uncaught errors and unhandled promise rejections on the global scope:
   * `window` in pages, `self` in workers and extension service workers.
   */
  attach(target?: HookTarget): this {
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
    const wrapped = toError(error);
    if (matches(wrapped.message, this.ignored)) return;

    const payload = this.buildPayload(wrapped, extras);

    const final = this.options.beforeSend
      ? this.options.beforeSend(payload)
      : payload;
    if (!final) return;
    if (!this.guard.allow(final)) return;

    const limited = applyLimits(final);
    if (!limited) return;

    try {
      await sendEntry(limited, this.apiOptions);
    } catch (sendError) {
      // Wrong or revoked key: retrying every error would only spam the API and the console
      if (sendError instanceof ApiError && this.guard.rejectKey(sendError.response)) {
        console.warn(
          `[excalibur] ${sendError.response.status} from ingest: check the apiKey. Reporting is off until the page reloads`,
        );
        return;
      }
      // Server asked us to wait: pause quietly instead of failing every send
      if (sendError instanceof ApiError && this.guard.backOff(sendError.response)) {
        console.warn(`[excalibur] ${sendError.response.status} from ingest, pausing sends`);
        return;
      }
      throw sendError;
    }
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
        Request: collectRequest(this.options.redactParams),
        Version: this.options.version,
        DeploymentEnvironment: this.options.environment,
        Tags: tags.length ? tags : undefined,
        UserCustomData: extras?.customData,
        User: this.wireUser(),
        SessionId: this.session.getOrStart(),
        Breadcrumbs: this.breadcrumbs.snapshot(),
      },
    };
  }

  private wireUser() {
    if (this.user) return toWireUser(this.user);
    if (this.options.anonymousId === false) return undefined;
    return toWireUser(anonymousUser());
  }
}
