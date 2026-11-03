import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Sparkline } from "@/components/dashboard/Sparkline";
import type { MetricSummary } from "@/data/overview";
import { cn } from "@/lib/cn";
import { formatChange, formatMetricValue } from "@/lib/format";

interface MetricCardProps {
  metric: MetricSummary;
  highlighted?: boolean;
}

export function MetricCard({ metric, highlighted = false }: MetricCardProps) {
  const isIncrease = metric.change > 0;
  const isDecrease = metric.change < 0;
  const TrendIcon = isIncrease ? ArrowUpRight : isDecrease ? ArrowDownRight : Minus;

  const changeClassName = highlighted
    ? "bg-ink text-lime"
    : metric.sentiment === "positive"
      ? "bg-lime/65 text-ink"
      : metric.sentiment === "negative"
        ? "bg-coral-soft text-coral"
        : "bg-ink/[0.055] text-ink-soft";

  return (
    <article
      className={cn(
        "group relative flex min-h-[214px] flex-col overflow-hidden rounded-card border p-5 transition-[transform,box-shadow,border-color] duration-300 sm:p-6",
        highlighted
          ? "border-ink/10 bg-lime shadow-[0_24px_50px_-38px_rgba(23,23,18,0.65)]"
          : "border-line bg-surface shadow-card hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift",
      )}
    >
      {highlighted ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-16 -right-4 select-none font-display text-[12rem] leading-none text-ink/[0.055]"
        >
          $
        </span>
      ) : null}

      <div className="relative z-10 flex items-start justify-between gap-3">
        <p
          className={cn(
            "font-mono text-[9px] font-medium uppercase tracking-[0.18em]",
            highlighted ? "text-ink/65" : "text-muted",
          )}
        >
          {metric.shortLabel}
        </p>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-1 font-mono text-[9px] font-medium leading-none tracking-[0.02em]",
            changeClassName,
          )}
        >
          <TrendIcon aria-hidden="true" className="h-3 w-3" strokeWidth={2.2} />
          {formatChange(metric.change, metric.changeSuffix)}
        </span>
      </div>

      <div className="relative z-10 mt-6 flex items-end justify-between gap-3">
        <p className="font-display text-[clamp(2.7rem,4vw,3.4rem)] leading-[0.82] tracking-[-0.05em] text-ink">
          {formatMetricValue(metric.value, metric.format)}
        </p>
        <Sparkline
          data={metric.sparkline}
          className={cn(
            "mb-0.5 shrink-0",
            highlighted ? "text-ink/70" : "text-ink/45",
          )}
        />
      </div>

      <p
        className={cn(
          "relative z-10 mt-4 text-[11px] leading-5",
          highlighted ? "text-ink/65" : "text-ink-soft/75",
        )}
      >
        {metric.note}
      </p>

      <div
        className={cn(
          "relative z-10 mt-auto flex items-end justify-between gap-3 border-t pt-3.5",
          highlighted ? "border-ink/15" : "border-line/80",
        )}
      >
        <p
          className={cn(
            "text-[10.5px] leading-4",
            highlighted ? "text-ink/60" : "text-muted",
          )}
        >
          {metric.description}
        </p>
        <p
          className={cn(
            "shrink-0 font-mono text-[8px] uppercase tracking-[0.1em]",
            highlighted ? "text-ink/50" : "text-muted/75",
          )}
        >
          {metric.comparison}
        </p>
      </div>
    </article>
  );
}
