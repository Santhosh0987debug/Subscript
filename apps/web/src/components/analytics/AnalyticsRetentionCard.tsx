import type { AnalyticsRetentionSummary } from "@subscript/shared";
import { Card } from "@/components/ui/Card";
import { formatBps } from "@/lib/analytics";
import { formatNumber } from "@/lib/format";

interface AnalyticsRetentionCardProps {
  summary: AnalyticsRetentionSummary;
  currency: string;
}

function RetentionStat({
  label,
  value,
  detail,
  progress,
  tone = "ink",
}: {
  label: string;
  value: string;
  detail: string;
  progress: number | null;
  tone?: "ink" | "lime" | "coral";
}) {
  const barClassName =
    tone === "lime" ? "bg-lime-deep" : tone === "coral" ? "bg-coral" : "bg-ink";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[11.5px] font-medium text-ink-soft">{label}</p>
        <p className="font-display text-[22px] leading-none tracking-[-0.03em] text-ink">
          {value}
        </p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
        <div
          className={`h-full rounded-full ${barClassName}`}
          style={{ width: `${Math.min(Math.max(progress ?? 0, 0), 100)}%` }}
        />
      </div>
      <p className="mt-1.5 font-mono text-[8px] uppercase tracking-[0.1em] text-muted">
        {detail}
      </p>
    </div>
  );
}

export function AnalyticsRetentionCard({
  summary,
  currency,
}: AnalyticsRetentionCardProps) {
  const revenue = summary.byCurrency.find((row) => row.currency === currency);
  const customerRetention =
    summary.customerChurnRateBps === null
      ? null
      : 10_000 - summary.customerChurnRateBps;
  const subscriptionRetention =
    summary.subscriptionRetentionBps === null
      ? null
      : summary.subscriptionRetentionBps;

  return (
    <Card className="flex h-full flex-col p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Retention</p>
          <h2 className="mt-2 font-display text-[27px] leading-none tracking-[-0.03em] text-ink">
            What stays
          </h2>
          <p className="mt-2 text-xs leading-5 text-muted">
            Churn and expansion measured against customers active at the start of
            the window.
          </p>
        </div>
        <span className="rounded-full border border-line bg-surface-raised px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-muted">
          {currency}
        </span>
      </div>

      <div className="mt-6 space-y-5">
        <RetentionStat
          label="Customer retention"
          value={formatBps(customerRetention)}
          progress={customerRetention === null ? null : customerRetention / 100}
          detail={`${formatNumber(summary.churnedCustomers)} of ${formatNumber(
            summary.startingCustomers,
          )} customers churned`}
          tone="lime"
        />
        <RetentionStat
          label="Subscription retention"
          value={formatBps(subscriptionRetention)}
          progress={subscriptionRetention === null ? null : subscriptionRetention / 100}
          detail={`${formatNumber(summary.churnedSubscriptions)} of ${formatNumber(
            summary.startingSubscriptions,
          )} subscriptions churned`}
          tone="ink"
        />
        <RetentionStat
          label="Gross revenue retention"
          value={formatBps(revenue?.grossRevenueRetentionBps ?? null)}
          progress={
            revenue?.grossRevenueRetentionBps == null
              ? null
              : revenue.grossRevenueRetentionBps / 100
          }
          detail="Starting MRR kept after churn"
          tone="ink"
        />
        <RetentionStat
          label="Net revenue retention"
          value={formatBps(revenue?.netRevenueRetentionBps ?? null)}
          progress={
            revenue?.netRevenueRetentionBps == null
              ? null
              : revenue.netRevenueRetentionBps / 100
          }
          detail="Includes expansion from returning customers"
          tone="lime"
        />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 border-t border-line/80 pt-4">
        <div>
          <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
            New customers
          </p>
          <p className="mt-1 font-display text-xl leading-none text-ink">
            {formatNumber(summary.newCustomers)}
          </p>
        </div>
        <div>
          <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
            Returning
          </p>
          <p className="mt-1 font-display text-xl leading-none text-ink">
            {formatNumber(summary.returningCustomers)}
          </p>
        </div>
      </div>
    </Card>
  );
}
