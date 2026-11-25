const MAX_DESCRIPTION_LENGTH = 1_000;

/** Readable text for any thrown or rejected value; never throws. */
export function describeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';

  try {
    const seen = new WeakSet<object>();
    const json = JSON.stringify(value, (_key, item) => {
      if (typeof item === 'bigint') return `${item}n`;
      if (typeof item !== 'object' || item === null) return item;
      if (seen.has(item)) return '[Circular]';
      seen.add(item);
      return item;
    });
    if (json !== undefined) return json.slice(0, MAX_DESCRIPTION_LENGTH);
  } catch {
    // Throwing toJSON or getter; fall through to String()
  }

  try {
    return String(value).slice(0, MAX_DESCRIPTION_LENGTH);
  } catch {
    return 'Unserializable value';
  }
}

function stringField(value: unknown, field: string): string | undefined {
  try {
    const found = (value as Record<string, unknown>)[field];
    return typeof found === 'string' ? found : undefined;
  } catch {
    return undefined;
  }
}

/** Wraps non-Error values. Error-shaped objects (other realms, plain { message }) keep their fields. */
export function toError(value: unknown, fallbackName?: string): Error {
  if (value instanceof Error) return value;

  const message = value && typeof value === 'object' ? stringField(value, 'message') : undefined;
  if (message === undefined) {
    const error = new Error(describeValue(value));
    if (fallbackName) error.name = fallbackName;
    return error;
  }

  const error = new Error(message);
  error.name = stringField(value, 'name') ?? fallbackName ?? error.name;
  const stack = stringField(value, 'stack');
  if (stack) error.stack = stack;
  return error;
}
