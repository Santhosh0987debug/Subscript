import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { buildAreaPath, buildSmoothPath, clamp, niceCeiling } from "@/lib/chart";
import { formatCompactMoney } from "@/lib/analytics";
import { formatMoney } from "@/lib/money";

export type AnalyticsLineTone = "ink" | "lime" | "coral" | "sand";

export interface AnalyticsLineSeries {
  id: string;
  label: string;
  values: readonly number[];
  tone: AnalyticsLineTone;
  area?: boolean;
  dashed?: boolean;
}

interface AnalyticsLineChartProps {
  labels: readonly string[];
  series: readonly AnalyticsLineSeries[];
  currency: string;
  ariaLabel: string;
  height?: number;
}

const TONE_COLORS: Record<AnalyticsLineTone, string> = {
  ink: "#171712",
  lime: "#c6ed3f",
  coral: "#dd5c3d",
  sand: "#cbbba1",
};

const TONE_STROKES: Record<AnalyticsLineTone, string> = {
  ink: "stroke-ink",
  lime: "stroke-lime-deep",
  coral: "stroke-coral",
  sand: "stroke-sand",
};

export function AnalyticsLineChart({
  labels,
  series,
  currency,
  ariaLabel,
  height = 264,
}: AnalyticsLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const chartId = useId().replaceAll(":", "");
  const hasData = labels.length > 0 && series.some((item) => item.values.length > 0);

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

  const margins = width > 0 && width < 560
    ? { top: 20, right: 10, bottom: 28, left: 46 }
    : { top: 24, right: 18, bottom: 30, left: 60 };
  const plotWidth = Math.max(width - margins.left - margins.right, 10);
  const plotHeight = Math.max(height - margins.top - margins.bottom, 10);
  const numerator = Math.max(labels.length - 1, 1);
  const maximum = Math.max(
    ...series.flatMap((item) => item.values),
    0,
  );
  const axisMax = niceCeiling((maximum || 1) * 1.06);
  const xPosition = (index: number) =>
    margins.left + (index / numerator) * plotWidth;
  const yPosition = (value: number) =>
    margins.top + (1 - value / axisMax) * plotHeight;
  const tickCount = 4;
  const labelStep = Math.max(Math.ceil(labels.length / 6), 1);
  const active = activeIndex !== null ? activeIndex : null;

  const handlePointer = (clientX: number) => {
    if (labels.length === 0 || !containerRef.current) {
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const relative = (clientX - rect.left - margins.left) / plotWidth;
    const index = Math.round(relative * numerator);
    setActiveIndex(clamp(index, 0, labels.length - 1));
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      onPointerMove={(event) => handlePointer(event.clientX)}
      onPointerLeave={() => setActiveIndex(null)}
    >
      {!hasData ? (
        <div
          className="flex items-center justify-center rounded-xl border border-dashed border-line px-4 text-center text-xs text-muted"
          style={{ height }}
        >
          No activity in this range.
        </div>
      ) : (
        <svg
          role="img"
          aria-label={ariaLabel}
          width={width || 640}
          height={height}
          className="block max-w-full overflow-visible"
        >
          <defs>
            {series.map((item) => (
              <linearGradient
                key={item.id}
                id={`${chartId}-${item.id}`}
                x1="0"
                x2="0"
                y1="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor={TONE_COLORS[item.tone]}
                  stopOpacity="0.16"
                />
                <stop
                  offset="100%"
                  stopColor={TONE_COLORS[item.tone]}
                  stopOpacity="0"
                />
              </linearGradient>
            ))}
          </defs>

          {Array.from({ length: tickCount + 1 }, (_, index) => {
            const value = (axisMax / tickCount) * index;
            const y = yPosition(value);

            return (
              <g key={index}>
                <line
                  x1={margins.left}
                  x2={margins.left + plotWidth}
                  y1={y}
                  y2={y}
                  className={index === 0 ? "stroke-line-strong" : "stroke-line"}
                  strokeWidth="1"
                  strokeDasharray={index === 0 ? undefined : "2 5"}
                />
                <text
                  x={margins.left - 9}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-muted font-mono text-[8px]"
                >
                  {formatCompactMoney(value, currency)}
                </text>
              </g>
            );
          })}

          {labels.map((label, index) => {
            if (index % labelStep !== 0 && index !== labels.length - 1) {
              return null;
            }

            return (
              <text
                key={`${label}-${index}`}
                x={xPosition(index)}
                y={height - 7}
                textAnchor={
                  index === 0
                    ? "start"
                    : index === labels.length - 1
                      ? "end"
                      : "middle"
                }
                className="fill-muted font-mono text-[8px] uppercase tracking-[0.04em]"
              >
                {label}
              </text>
            );
          })}

          {series.map((item) => {
            if (item.values.length === 0) {
              return null;
            }

            const points = item.values.map((value, index) => ({
              x: xPosition(index),
              y: yPosition(value),
            }));
            const path = buildSmoothPath(points);
            const areaPath = item.area
              ? buildAreaPath(points, margins.top + plotHeight)
              : null;

            return (
              <g key={item.id}>
                {areaPath ? (
                  <path
                    d={areaPath}
                    fill={`url(#${chartId}-${item.id})`}
                    stroke="none"
                  />
                ) : null}
                <path
                  d={path}
                  fill="none"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={item.dashed ? "4 4" : undefined}
                  className={cn(TONE_STROKES[item.tone])}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}

          {active !== null ? (
            <g>
              <line
                x1={xPosition(active)}
                x2={xPosition(active)}
                y1={margins.top}
                y2={margins.top + plotHeight}
                className="stroke-ink/20"
                strokeWidth="1"
                strokeDasharray="3 4"
              />
              {series.map((item) => {
                const value = item.values[active];

                if (value === undefined) {
                  return null;
                }

                return (
                  <circle
                    key={item.id}
                    cx={xPosition(active)}
                    cy={yPosition(value)}
                    r="3.2"
                    fill={TONE_COLORS[item.tone]}
                    stroke="#fffdf7"
                    strokeWidth="1.5"
                  />
                );
              })}
            </g>
          ) : null}
        </svg>
      )}

      {active !== null && hasData ? (
        <div
          className="pointer-events-none absolute top-0 z-10 min-w-40 rounded-xl border border-line bg-surface/95 px-3 py-2 shadow-card backdrop-blur"
          style={{
            left: clamp(xPosition(active) - 74, 0, Math.max(width - 176, 0)),
          }}
        >
          <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
            {labels[active]}
          </p>
          <div className="mt-1.5 space-y-1">
            {series.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-4 text-[11px]"
              >
                <span className="inline-flex items-center gap-1.5 text-muted">
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: TONE_COLORS[item.tone] }}
                  />
                  {item.label}
                </span>
                <span className="font-mono text-[10px] font-medium text-ink">
                  {formatMoney(item.values[active] ?? 0, currency)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
