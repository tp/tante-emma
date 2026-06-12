// Shared formatting helpers.

/** Format integer euro cents as "€1.20". */
export function euro(cents: number): string {
  return '€' + (cents / 100).toFixed(2);
}
