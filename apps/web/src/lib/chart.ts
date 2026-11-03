export interface ChartPoint {
  x: number;
  y: number;
}

/**
 * Builds a smooth cubic path through points using a Catmull-Rom conversion.
 * The curve remains visually calm while still following subtle revenue changes.
 */
export function buildSmoothPath(points: readonly ChartPoint[]): string {
  const first = points[0];

  if (!first) {
    return "";
  }

  if (points.length === 1) {
    return `M ${first.x} ${first.y}`;
  }

  const segments: string[] = [`M ${first.x} ${first.y}`];

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];

    if (!current || !next) {
      continue;
    }

    const previous = points[index - 1] ?? current;
    const afterNext = points[index + 2] ?? next;

    const controlOneX = current.x + (next.x - previous.x) / 6;
    const controlOneY = current.y + (next.y - previous.y) / 6;
    const controlTwoX = next.x - (afterNext.x - current.x) / 6;
    const controlTwoY = next.y - (afterNext.y - current.y) / 6;

    segments.push(
      `C ${controlOneX} ${controlOneY}, ${controlTwoX} ${controlTwoY}, ${next.x} ${next.y}`,
    );
  }

  return segments.join(" ");
}

export function buildAreaPath(
  points: readonly ChartPoint[],
  baselineY: number,
): string {
  const first = points[0];
  const last = points[points.length - 1];

  if (!first || !last) {
    return "";
  }

  return `${buildSmoothPath(points)} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Rounds a chart maximum up to a clean axis ceiling.
 */
export function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const niceNormalized =
    normalized <= 1
      ? 1
      : normalized <= 2
        ? 2
        : normalized <= 2.5
          ? 2.5
          : normalized <= 5
            ? 5
            : 10;

  return niceNormalized * magnitude;
}
