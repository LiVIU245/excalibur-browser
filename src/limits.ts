import type { IngestPayload } from './payload';

// Mirror the server's ingest schema; anything over these gets rejected there
const MAX_TAGS = 50;
const MAX_CUSTOM_DATA_ENTRIES = 200;
const MAX_CUSTOM_DATA_DEPTH = 20;

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

/** Trims a payload so the server never rejects it; the error itself is always kept. */
export function applyLimits(payload: IngestPayload): IngestPayload {
  const details = payload.Details;
  if (!details) return payload;

  const tags = details.Tags;
  if (tags && tags.length > MAX_TAGS) {
    console.warn(`[excalibur] ${tags.length} tags, only the first ${MAX_TAGS} are sent`);
    details.Tags = tags.slice(0, MAX_TAGS);
  }

  const customData = details.UserCustomData;
  if (customData && !customDataWithinLimits(customData)) {
    console.warn(
      `[excalibur] customData dropped: over ${MAX_CUSTOM_DATA_ENTRIES} entries or nested over ${MAX_CUSTOM_DATA_DEPTH} deep`,
    );
    details.UserCustomData = { _truncated: true };
  }

  return payload;
}
