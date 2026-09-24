/** Helpers for reading settings that come from outside (the hub's JSON, older versions). */

export type Json = Record<string, unknown>;

export function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `input` laid over `defaults`, key by key: missing keys, wrong types, and
 * non-finite numbers fall back to the default. Only the keys of `defaults`
 * survive. Arrays are taken as they are, so check them afterwards.
 */
export function mergeInto<T>(defaults: T, input: unknown): T {
  if (!isObject(defaults) || !isObject(input)) return defaults;
  const out: Json = { ...defaults };
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = input[key];
    if (value === undefined || fallback === null) continue;
    if (isObject(fallback)) out[key] = mergeInto(fallback, value);
    else if (typeof value === typeof fallback && (typeof value !== 'number' || Number.isFinite(value))) out[key] = value;
  }
  return out as T;
}
