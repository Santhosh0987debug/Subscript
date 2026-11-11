import { useEffect, useRef, useState } from "react";
import { clamp, niceCeiling } from "@/lib/chart";
import { formatNumber } from "@/lib/format";

export interface AnalyticsBarSeries {
  id: string;
  label: string;
  values: readonly number[];
  color: string;
}

interface AnalyticsBarChartProps {
  labels: readonly string[];
  series: readonly AnalyticsBarSeries[];
  ariaLabel: string;
  height?: number;
}

export function AnalyticsBarChart({
  labels,
  series,
  ariaLabel,
  height = 232,
}: AnalyticsBarChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
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
    ? { top: 14, right: 8, bottom: 28, left: 34 }
    : { top: 16, right: 12, bottom: 30, left: 42 };
  const plotWidth = Math.max(width - margins.left - margins.right, 10);
  const plotHeight = Math.max(height - margins.top - margins.bottom, 10);
  const maximum = Math.max(...series.flatMap((item) => item.values), 0);
  const axisMax = niceCeiling((maximum || 1) * 1.05);
  const tickCount = 3;
  const groupWidth = labels.length > 0 ? plotWidth / labels.length : plotWidth;
  const labelStep = Math.max(Math.ceil(labels.length / 6), 1);
  const barWidth = Math.max(
    Math.min((groupWidth * 0.62) / Math.max(series.length, 1), 18),
    3,
  );
  const groupPadding = (groupWidth - barWidth * series.length) / 2;

  const handlePointer = (clientX: number) => {
    if (labels.length === 0 || !containerRef.current) {
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const relative = (clientX - rect.left - margins.left) / groupWidth;
    setActiveIndex(clamp(Math.floor(relative), 0, labels.length - 1));
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
          No subscription movement in this range.
        </div>
      ) : (
        <svg
          role="img"
          aria-label={ariaLabel}
          width={width || 640}
          height={height}
          className="block max-w-full overflow-visible"
        >
          {Array.from({ length: tickCount + 1 }, (_, index) => {
            const value = (axisMax / tickCount) * index;
            const y = margins.top + (1 - value / axisMax) * plotHeight;

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
                  x={margins.left - 7}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-muted font-mono text-[8px]"
                >
                  {formatNumber(value)}
                </text>
              </g>
            );
          })}

          {labels.map((label, index) => {
            const groupX = margins.left + index * groupWidth;

            return (
              <g key={`${label}-${index}`}>
                {activeIndex === index ? (
                  <rect
                    x={groupX + 1}
                    y={margins.top}
                    width={Math.max(groupWidth - 2, 1)}
                    height={plotHeight}
                    className="fill-ink/[0.035]"
                    rx="4"
                  />
                ) : null}
                {series.map((item, seriesIndex) => {
                  const value = item.values[index] ?? 0;
                  const barHeight = value <= 0
                    ? 0
                    : Math.max((value / axisMax) * plotHeight, 1);
                  const x = groupX + groupPadding + seriesIndex * barWidth;

                  return (
                    <rect
                      key={item.id}
                      x={x}
                      y={margins.top + plotHeight - barHeight}
                      width={Math.max(barWidth - 1.5, 1)}
                      height={barHeight}
                      rx={Math.min(barWidth / 3, 4)}
                      fill={item.color}
                      opacity={activeIndex === null || activeIndex === index ? 1 : 0.55}
                    />
                  );
                })}
                {index % labelStep === 0 || index === labels.length - 1 ? (
                  <text
                    x={groupX + groupWidth / 2}
                    y={height - 7}
                    textAnchor="middle"
                    className="fill-muted font-mono text-[8px] uppercase tracking-[0.04em]"
                  >
                    {label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      )}

      {activeIndex !== null && hasData ? (
        <div
          className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-xl border border-line bg-surface/95 px-3 py-2 shadow-card backdrop-blur"
          style={{
            left: clamp(
              margins.left + activeIndex * groupWidth - 60,
              0,
              Math.max(width - 160, 0),
            ),
          }}
        >
          <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
            {labels[activeIndex]}
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
                    style={{ backgroundColor: item.color }}
                  />
                  {item.label}
                </span>
                <span className="font-mono text-[10px] font-medium text-ink">
                  {formatNumber(item.values[activeIndex] ?? 0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
