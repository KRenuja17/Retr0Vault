export type ClassValue = string | false | null | undefined;

/** Joins truthy class names. Kept local so the app carries no utility dependency. */
export function cx(...values: readonly ClassValue[]): string | undefined {
  const parts = values.filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(" ") : undefined;
}
