/**
 * Helpers for reading Next.js API route query parameters, which arrive as
 * `string | string[] | undefined`.
 */

export function getSingleQueryValue(
  value: string | string[] | undefined,
): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export function getPositiveInt(
  value: string | string[] | undefined,
): number | null {
  const parsed = parseInt(getSingleQueryValue(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Reads a parameter that may be repeated (`?topic=a&topic=b`), always as a
 * list. Repeats rather than a delimiter so a value can contain any character.
 */
export function getQueryValues(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((v) => v.trim()).filter(Boolean);
}

/**
 * The same two readers for `router.query` on the client, where a parameter is
 * likewise `string | string[] | undefined`.
 */
export const readQueryValue = getSingleQueryValue;
export const readQueryValues = getQueryValues;

/**
 * The largest page a caller may ask for.
 *
 * A page size is a display concern, and no view shows hundreds of cards at
 * once. Without a ceiling `?pageSize=100000` makes the server read the whole
 * table and serialize it, which is the unbounded response the paged API was
 * meant to replace.
 */
export const MAX_PAGE_SIZE = 200;

/**
 * Used when a caller asks for no particular page size. The endpoints always
 * answer with a page now, so that a caller who names nothing still gets a
 * bounded response rather than the whole table.
 */
export const DEFAULT_PAGE_SIZE = 25;

/** A page size the caller asked for, clamped to something serveable. */
export function getBoundedPageSize(
  value: string | string[] | undefined,
): number | null {
  const parsed = getPositiveInt(value);
  return parsed === null ? null : Math.min(parsed, MAX_PAGE_SIZE);
}
