import type { IngestPayload, IngestPayloadDetails } from './payload';

// Mirror the server's ingest schema; anything over these gets rejected there
const MAX_TAGS = 50;
const MAX_CUSTOM_DATA_ENTRIES = 200;
const MAX_CUSTOM_DATA_DEPTH = 20;
const MAX_ENVIRONMENT_LENGTH = 64;
// Server body limit is 1MB; stay under it with room for multi-byte text
const MAX_BODY_BYTES = 900_000;

// The server has no limit on these, but one oversized field should not cost the whole event
const MAX_MESSAGE_LENGTH = 10_000;
const MAX_STACK_STRING_LENGTH = 50_000;
const MAX_TAG_LENGTH = 200;
const MAX_BREADCRUMB_MESSAGE_LENGTH = 1_000;

function customDataWithinLimits(data: unknown): boolean {
  let entries = 0;
  const stack: { value: unknown; depth: number }[] = [{ value: data, depth: 1 }];

  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (!value || typeof value !== 'object') continue;
    if (depth > MAX_CUSTOM_DATA_DEPTH) return false;

    const children = Array.isArray(value) ? value : Object.values(value);
    entries += children.length;
    if (entries > MAX_CUSTOM_DATA_ENTRIES) return false;

    for (const child of children) stack.push({ value: child, depth: depth + 1 });
  }
  return true;
}

function truncate(value: string | undefined, max: number): string | undefined {
  if (value === undefined || value.length <= max) return value;
  return `${value.slice(0, max)}… [truncated]`;
}

function trimFields(details: IngestPayloadDetails): void {
  const error = details.Error;
  if (error) {
    error.Message = truncate(error.Message, MAX_MESSAGE_LENGTH);
    error.StackString = truncate(error.StackString, MAX_STACK_STRING_LENGTH);
  }

  const environment = details.DeploymentEnvironment;
  if (environment && environment.length > MAX_ENVIRONMENT_LENGTH) {
    console.warn(`[excalibur] environment is over ${MAX_ENVIRONMENT_LENGTH} characters, truncated`);
    details.DeploymentEnvironment = environment.slice(0, MAX_ENVIRONMENT_LENGTH);
  }

  const tags = details.Tags;
  if (tags) {
    if (tags.length > MAX_TAGS) {
      console.warn(`[excalibur] ${tags.length} tags, only the first ${MAX_TAGS} are sent`);
    }
    // Plain-JS callers can pass numbers; the server only accepts strings
    details.Tags = tags.slice(0, MAX_TAGS).map((tag) => String(tag).slice(0, MAX_TAG_LENGTH));
  }

  for (const crumb of details.Breadcrumbs ?? []) {
    crumb.message = truncate(crumb.message, MAX_BREADCRUMB_MESSAGE_LENGTH);
  }

  const customData = details.UserCustomData;
  if (customData && !customDataWithinLimits(customData)) {
    console.warn(
      `[excalibur] customData dropped: over ${MAX_CUSTOM_DATA_ENTRIES} entries or nested over ${MAX_CUSTOM_DATA_DEPTH} deep`,
    );
    details.UserCustomData = { _truncated: true };
  }
}

// null when the payload cannot be serialized (circular or BigInt customData)
function byteSize(payload: IngestPayload): number | null {
  try {
    return new TextEncoder().encode(JSON.stringify(payload)).length;
  } catch {
    return null;
  }
}

/**
 * Trims a payload so the server never rejects it; the error itself is always kept.
 * Returns null only when it still cannot fit in one request.
 */
export function applyLimits(payload: IngestPayload): IngestPayload | null {
  const details = payload.Details;
  if (!details) return payload;

  trimFields(details);

  let size = byteSize(payload);
  if (size === null) {
    console.warn('[excalibur] customData dropped: not serializable to JSON');
    details.UserCustomData = { _unserializable: true };
    size = byteSize(payload);
  }
  if (size !== null && size <= MAX_BODY_BYTES) return payload;

  // Too big: shed the optional sections, largest first, until it fits
  console.warn('[excalibur] event over the size limit, dropping customData and breadcrumbs');
  details.UserCustomData = { _truncated: true };
  details.Breadcrumbs = undefined;
  size = byteSize(payload);
  if (size !== null && size <= MAX_BODY_BYTES) return payload;

  console.warn('[excalibur] event dropped: still over the size limit');
  return null;
}
