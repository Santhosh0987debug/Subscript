/**
 * Exponential backoff with a hard ceiling. The exponent is bounded before the
 * multiplication so very large attempt counts cannot overflow to Infinity.
 */
export function boundedExponentialDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
): number {
  const exponent = Math.min(Math.max(attempt - 1, 0), 20);
  return Math.min(baseMs * 2 ** exponent, maxMs);
}
