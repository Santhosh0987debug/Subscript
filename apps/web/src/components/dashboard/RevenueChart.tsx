import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { RevenuePoint } from "@/data/overview";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import {
  buildAreaPath,
  buildSmoothPath,
  clamp,
  niceCeiling,
} from "@/lib/chart";
import {
  formatChange,
  formatChartCurrency,
  formatCurrency,
  formatSignedCurrency,
} from "@/lib/format";

type ChartRange = "6m" | "12m";

const RANGE_OPTIONS: ReadonlyArray<{ value: ChartRange; label: string }> = [
  { value: "6m", label: "6M" },
  { value: "12m", label: "12M" },
];

interface RevenueChartProps {
  data: readonly RevenuePoint[];
}

export function RevenueChart({ data }: RevenueChartProps) {
  const [range, setRange] = useState<ChartRange>("12m");
  const visibleData = range === "12m" ? data : data.slice(-6);
  const latest = data[data.length - 1];
  const previousMonth = data[data.length - 2];
  const delta = latest && previousMonth ? latest.current - previousMonth.current : 0;
  const monthOverMonth =
    latest && previousMonth && previousMonth.current !== 0
      ? ((latest.current - previousMonth.current) / previousMonth.current) * 100
      : 0;
  const latestMonthName = latest?.month.split(" ")[0] ?? "Latest";

  return (
    <Card className="flex h-full flex-col p-5 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <p className="eyebrow">Growth</p>
            <span aria-hidden="true" className="h-1 w-1 rounded-full bg-line-strong" />
            <p className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-muted/70">
              USD
            </p>
          </div>
          <h2 className="mt-2 font-display text-[27px] leading-none tracking-[-0.03em] text-ink">
            Revenue performance
          </h2>
          <p className="mt-2 text-xs text-muted">
            Monthly recurring revenue over the last twelve months
          </p>
        </div>

        <div
          role="group"
          aria-label="Chart range"
          className="flex self-start rounded-full border border-line bg-surface-raised p-1"
        >
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={range === option.value}
              onClick={() => setRange(option.value)}
              className={cn(
                "h-7 rounded-full px-3 font-mono text-[9px] font-medium uppercase tracking-[0.1em] transition-colors",
                range === option.value
                  ? "bg-ink text-surface shadow-sm"
                  : "text-muted hover:text-ink",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-baseline gap-3">
            <p className="font-display text-[2.55rem] leading-none tracking-[-0.045em] text-ink">
              {latest ? formatCurrency(latest.current) : "\u2014"}
            </p>
            <Badge tone="lime">{formatChange(monthOverMonth, "%")} MoM</Badge>
          </div>
          <p className="mt-2 text-[11px] text-muted">
            {latestMonthName} MRR ·{" "}
            <span className="font-medium text-ink">{formatSignedCurrency(delta)}</span>{" "}
            vs. previous month
          </p>
        </div>

        <div className="flex items-center gap-4 font-mono text-[8.5px] uppercase tracking-[0.1em] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ink" />
            This year
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="w-4 border-t border-dashed border-muted/70"
            />
            Last year
          </span>
        </div>
      </div>

      <div className="mt-4 flex-1">
        <RevenueChartBody key={range} data={visibleData} />
      </div>
    </Card>
  );
}

interface RevenueChartBodyProps {
  data: readonly RevenuePoint[];
}

const CHART_MARGINS = { top: 26, right: 16, bottom: 32, left: 52 };

function RevenueChartBody({ data }: RevenueChartBodyProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const chartId = useId().replaceAll(":", "");
  const instructionsId = `chart-instructions-${chartId}`;

  useEffect(() => {
    const element = containerRef.current;

    if (!element) {
      return;
    }

    const measure = () => setWidth(element.clientWidth);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const height = width > 0 && width < 560 ? 238 : 282;
  const left = width > 0 && width < 560 ? 43 : CHART_MARGINS.left;
  const top = CHART_MARGINS.top;
  const right = CHART_MARGINS.right;
  const bottom = CHART_MARGINS.bottom;
  const plotWidth = Math.max(width - left - right, 10);
  const plotHeight = height - top - bottom;
  const baselineY = top + plotHeight;

  const currentValues = data.map((point) => point.current);
  const previousValues = data.map((point) => point.previous);
  const axisMax = niceCeiling(Math.max(...currentValues, ...previousValues, 1) * 1.06);
  const numerator = Math.max(data.length - 1, 1);

  const pointPositions = data.map((point, index) => {
    const x = left + (index / numerator) * plotWidth;
    const y = (value: number) =>
      top + (1 - value / axisMax) * plotHeight;

    return {
      point,
      x,
      currentY: y(point.current),
      previousY: y(point.previous),
    };
  });

  const currentPoints = pointPositions.map((position) => ({
    x: position.x,
    y: position.currentY,
  }));
  const previousPoints = pointPositions.map((position) => ({
    x: position.x,
    y: position.previousY,
  }));
  const currentPath = buildSmoothPath(currentPoints);
  const previousPath = buildSmoothPath(previousPoints);
  const areaPath = buildAreaPath(currentPoints, baselineY);
  const activePosition =
    activeIndex !== null ? pointPositions[activeIndex] : undefined;
  const lastPosition = pointPositions[pointPositions.length - 1];
  const tickCount = 4;

  const nearestIndex = (pointerX: number): number => {
    let closest = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    pointPositions.forEach((position, index) => {
      const distance = Math.abs(position.x - pointerX);

      if (distance < closestDistance) {
        closest = index;
        closestDistance = distance;
      }
    });

    return closest;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!containerRef.current || pointPositions.length === 0) {
      return;
    }

    const bounds = containerRef.current.getBoundingClientRect();
    const pointerX = clamp(
      event.clientX - bounds.left,
      left,
      Math.max(width - right, left),
    );

    setActiveIndex(nearestIndex(pointerX));
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (pointPositions.length === 0) {
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      setActiveIndex((current) =>
        current === null ? 0 : Math.min(current + 1, pointPositions.length - 1),
      );
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setActiveIndex((current) =>
        current === null ? pointPositions.length - 1 : Math.max(current - 1, 0),
      );
    }

    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    }

    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(pointPositions.length - 1);
    }

    if (event.key === "Escape") {
      setActiveIndex(null);
    }
  };

  if (width <= 0) {
    return (
      <div
        ref={containerRef}
        aria-hidden="true"
        className="mt-5 h-[238px] sm:h-[282px]"
      />
    );
  }

  const tooltipX = activePosition
    ? clamp(activePosition.x, 82, Math.max(width - 82, 82))
    : 0;
  const labelStride = width < 560 ? 2 : 1;
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) =>
    (axisMax / tickCount) * index,
  );

  return (
    <div
      ref={containerRef}
      role="group"
      tabIndex={0}
      aria-label={`Revenue chart. ${data.length} months from ${data[0]?.month ?? ""} to ${
        data[data.length - 1]?.month ?? ""
      }. Latest MRR ${lastPosition ? formatCurrency(lastPosition.point.current) : "unavailable"}.`}
      aria-describedby={instructionsId}
      className="relative mt-5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/35 focus-visible:ring-offset-4 focus-visible:ring-offset-surface"
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setActiveIndex(null)}
      onKeyDown={handleKeyDown}
      onFocus={() => {
        if (activeIndex === null) {
          setActiveIndex(data.length - 1);
        }
      }}
      onBlur={() => setActiveIndex(null)}
      style={{ touchAction: "pan-y" }}
    >
      <p id={instructionsId} className="sr-only">
        Use the left and right arrow keys to inspect monthly recurring revenue.
        Press Escape to clear the selection. A data table follows the chart.
      </p>

      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block overflow-visible"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id={`revenue-gradient-${chartId}`}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor="#d9fb62" stopOpacity="0.55" />
            <stop offset="72%" stopColor="#d9fb62" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#d9fb62" stopOpacity="0" />
          </linearGradient>
          <clipPath id={`revenue-clip-${chartId}`}>
            <rect
              x={left}
              y={top - 4}
              width={plotWidth}
              height={plotHeight + 8}
              rx="4"
            />
          </clipPath>
        </defs>

        {ticks.map((tick) => {
          const tickY = top + (1 - tick / axisMax) * plotHeight;

          return (
            <g key={tick}>
              <line
                x1={left}
                y1={tickY}
                x2={width - right}
                y2={tickY}
                stroke="var(--color-line)"
                strokeWidth="1"
                strokeDasharray={tick === 0 ? undefined : "3 5"}
              />
              <text
                x={left - 9}
                y={tickY + 3}
                textAnchor="end"
                fill="var(--color-muted)"
                fontSize="8.5"
                fontFamily="var(--font-mono)"
              >
                {formatChartCurrency(tick)}
              </text>
            </g>
          );
        })}

        <g clipPath={`url(#revenue-clip-${chartId})`}>
          <path d={areaPath} fill={`url(#revenue-gradient-${chartId})`} className="chart-area" />
          <path
            d={previousPath}
            fill="none"
            stroke="var(--color-line-strong)"
            strokeWidth="1.5"
            strokeDasharray="4 5"
            strokeLinecap="round"
          />
          <path
            d={currentPath}
            fill="none"
            stroke="var(--color-ink)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            className="chart-line"
          />

          {activePosition ? (
            <line
              x1={activePosition.x}
              y1={top}
              x2={activePosition.x}
              y2={baselineY}
              stroke="var(--color-ink)"
              strokeWidth="1"
              strokeDasharray="3 4"
              opacity="0.35"
            />
          ) : null}

          {activePosition ? (
            <>
              <circle
                cx={activePosition.x}
                cy={activePosition.previousY}
                r="2.5"
                fill="var(--color-surface)"
                stroke="var(--color-muted)"
                strokeWidth="1.4"
              />
              <circle
                cx={activePosition.x}
                cy={activePosition.currentY}
                r="6"
                fill="var(--color-lime)"
                opacity="0.65"
              />
              <circle
                cx={activePosition.x}
                cy={activePosition.currentY}
                r="3"
                fill="var(--color-ink)"
                stroke="var(--color-surface)"
                strokeWidth="1.8"
              />
            </>
          ) : lastPosition ? (
            <>
              <circle
                cx={lastPosition.x}
                cy={lastPosition.currentY}
                r="6"
                fill="var(--color-lime)"
                opacity="0.7"
              />
              <circle
                cx={lastPosition.x}
                cy={lastPosition.currentY}
                r="3"
                fill="var(--color-ink)"
                stroke="var(--color-surface)"
                strokeWidth="1.8"
              />
            </>
          ) : null}
        </g>

        {pointPositions.map((position, index) => {
          const showLabel =
            index % labelStride === 0 || index === pointPositions.length - 1;

          return showLabel ? (
            <text
              key={position.point.month}
              x={position.x}
              y={height - 9}
              textAnchor="middle"
              fill="var(--color-muted)"
              fontSize="8.5"
              fontFamily="var(--font-mono)"
            >
              {position.point.shortLabel}
            </text>
          ) : null;
        })}
      </svg>

      {activePosition ? (
        <div
          className="pointer-events-none absolute top-0 z-10 w-[156px] -translate-x-1/2 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-lift"
          style={{ left: tooltipX }}
          aria-hidden="true"
        >
          <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-muted">
            {activePosition.point.month}
          </p>
          <p className="mt-1.5 font-display text-[22px] leading-none tracking-[-0.03em] text-ink">
            {formatCurrency(activePosition.point.current)}
          </p>
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-line/70 pt-1.5 text-[9px]">
            <span className="text-muted">Last year</span>
            <span className="font-medium tabular-nums text-ink">
              {formatCurrency(activePosition.point.previous)}
            </span>
          </div>
        </div>
      ) : null}

      <div className="sr-only">
        <table>
          <caption>
            Monthly recurring revenue for the displayed range, with the same
            month in the previous year.
          </caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">This year MRR</th>
              <th scope="col">Previous year MRR</th>
            </tr>
          </thead>
          <tbody>
            {data.map((point) => (
              <tr key={point.month}>
                <th scope="row">{point.month}</th>
                <td>{formatCurrency(point.current)}</td>
                <td>{formatCurrency(point.previous)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
