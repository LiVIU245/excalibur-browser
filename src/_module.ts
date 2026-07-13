export { ExcaliburClient, type ExcaliburClientOptions } from './client';
export { ApiError } from './errors';
export { SessionManager } from './session';
export {
  BreadcrumbBuffer,
  type Breadcrumb,
  type BreadcrumbLevel,
} from './breadcrumbs';
export { anonymousUser, type UserDetails } from './user';
export { parseStackTrace, type StackFrame } from './stack-trace';
export {
  WindowHooks,
  type CaptureExtras,
  type ErrorCapture,
} from './window-hooks';
export type {
  IngestPayload,
  IngestPayloadDetails,
  WireBreadcrumb,
  WireClient,
  WireEnvironment,
  WireError,
  WireRequest,
  WireStackFrame,
  WireUser,
} from './payload';
export { CLIENT_NAME, CLIENT_VERSION } from './version';
