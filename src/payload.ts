// Wire format for POST /api/entries — mirrors the server's IngestPayload.

export interface WireStackFrame {
  LineNumber?: number;
  ColumnNumber?: number;
  ClassName?: string;
  FileName?: string;
  MethodName?: string;
}

export interface WireError {
  ClassName?: string;
  Message?: string;
  StackTrace?: WireStackFrame[];
  StackString?: string;
}

export interface WireEnvironment {
  UtcOffset?: number;
  'Browser-Width'?: number;
  'Browser-Height'?: number;
  'Screen-Width'?: number;
  'Screen-Height'?: number;
  'Color-Depth'?: number;
  Browser?: string;
  'Browser-Name'?: string;
  'Browser-Version'?: string;
  Platform?: string;
}

export interface WireClient {
  Name?: string;
  Version?: string;
}

export interface WireRequest {
  Url?: string;
  QueryString?: Record<string, string>;
  Headers?: Record<string, string>;
}

export interface WireUser {
  Identifier?: string;
  IsAnonymous?: boolean;
  Email?: string;
  FullName?: string;
  FirstName?: string;
  UUID?: string;
}

export interface WireBreadcrumb {
  level?: string;
  timestamp?: number;
  type?: string;
  message?: string;
}

export interface IngestPayloadDetails {
  Error?: WireError;
  Environment?: WireEnvironment;
  Client?: WireClient;
  UserCustomData?: Record<string, unknown>;
  Tags?: string[];
  Request?: WireRequest;
  Version?: string;
  User?: WireUser;
  SessionId?: string;
  Breadcrumbs?: WireBreadcrumb[];
}

export interface IngestPayload {
  OccurredOn?: string;
  Details?: IngestPayloadDetails;
}
