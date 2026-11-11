import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { cn } from "@/lib/cn";
import { formatChange } from "@/lib/format";

export type AnalyticsMetricSentiment = "positive" | "negative" | "neutral";

interface AnalyticsMetricCardProps {
  label: string;
  value: string;
  note?: string;
  comparison?: string;
  change?: number | null;
  sentiment?: AnalyticsMetricSentiment;
  sparkline?: readonly number[];
  highlighted?: boolean;
}

export function AnalyticsMetricCard({
  label,
  value,
  note,
  comparison,
  change,
  sentiment = "neutral",
  sparkline,
  highlighted = false,
}: AnalyticsMetricCardProps) {
  const hasChange = change !== undefined && change !== null;
  const isIncrease = (change ?? 0) > 0;
  const isDecrease = (change ?? 0) < 0;
  const TrendIcon = isIncrease ? ArrowUpRight : isDecrease ? ArrowDownRight : Minus;
  const changeClassName = highlighted
    ? "bg-ink text-lime"
    : sentiment === "positive"
      ? "bg-lime/65 text-ink"
      : sentiment === "negative"
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
          {label}
        </p>
        {hasChange ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-1 font-mono text-[9px] font-medium leading-none tracking-[0.02em]",
              changeClassName,
            )}
          >
            <TrendIcon aria-hidden="true" className="h-3 w-3" strokeWidth={2.2} />
            {formatChange(change, "%")}
          </span>
        ) : null}
      </div>

      <div className="relative z-10 mt-6 flex items-end justify-between gap-3">
        <p className="font-display text-[clamp(2.35rem,3.7vw,3.2rem)] leading-[0.86] tracking-[-0.05em] text-ink">
          {value}
        </p>
        {sparkline && sparkline.length > 1 ? (
          <Sparkline
            data={sparkline}
            className={cn(
              "mb-0.5 shrink-0",
              highlighted ? "text-ink/70" : "text-ink/45",
            )}
          />
        ) : null}
      </div>

      {note ? (
        <p
          className={cn(
            "relative z-10 mt-4 text-[11px] leading-5",
            highlighted ? "text-ink/65" : "text-ink-soft/75",
          )}
        >
          {note}
        </p>
      ) : null}

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
          {comparison ?? ""}
        </p>
      </div>
    </article>
  );
}
