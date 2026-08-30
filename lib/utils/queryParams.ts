/**
 * Helpers for reading Next.js API route query parameters, which arrive as
 * `string | string[] | undefined`.
 */

export function getSingleQueryValue(
  value: string | string[] | undefined,
): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
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
export function getQueryValues(
  value: string | string[] | undefined,
): string[] {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((v) => v.trim()).filter(Boolean);
}
