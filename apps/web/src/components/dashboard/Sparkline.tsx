import { cn } from "@/lib/cn";
import { buildSmoothPath } from "@/lib/chart";

interface SparklineProps {
  data: readonly number[];
  className?: string;
  tone?: "ink" | "coral" | "muted";
}

const toneClassNames = {
  ink: "text-ink",
  coral: "text-coral",
  muted: "text-muted",
};

export function Sparkline({ data, className, tone = "ink" }: SparklineProps) {
  if (data.length < 2) {
    return null;
  }

  const width = 96;
  const height = 36;
  const padding = 3;
  const minimum = Math.min(...data);
  const maximum = Math.max(...data);
  const range = maximum - minimum || 1;
  const lastIndex = data.length - 1;

  const points = data.map((value, index) => ({
    x: padding + (index / lastIndex) * (width - padding * 2),
    y: padding + (1 - (value - minimum) / range) * (height - padding * 2),
  }));

  const lastPoint = points[lastIndex];

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      className={cn("h-9 w-24 overflow-visible", toneClassNames[tone], className)}
      fill="none"
    >
      <path
        d={buildSmoothPath(points)}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {lastPoint ? (
        <>
          <circle
            cx={lastPoint.x}
            cy={lastPoint.y}
            r="3.6"
            fill="currentColor"
            opacity="0.14"
          />
          <circle cx={lastPoint.x} cy={lastPoint.y} r="1.7" fill="currentColor" />
        </>
      ) : null}
    </svg>
  );
}
