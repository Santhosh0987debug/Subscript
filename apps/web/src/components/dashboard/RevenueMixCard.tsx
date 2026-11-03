import { formatCompactCurrency, formatCurrency, formatPercent } from "@/lib/format";
import type { PlanMixSlice, RetentionSnapshot } from "@/data/overview";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";

interface RevenueMixCardProps {
  plans: readonly PlanMixSlice[];
  retention: RetentionSnapshot;
  totalMrr: number;
}

const barToneClassNames = {
  lime: "bg-lime-deep",
  ink: "bg-ink",
  sand: "bg-sand",
};

const dotToneClassNames = {
  lime: "bg-lime-deep",
  ink: "bg-ink",
  sand: "bg-sand",
};

export function RevenueMixCard({ plans, retention, totalMrr }: RevenueMixCardProps) {
  return (
    <Card className="flex h-full flex-col p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Composition</p>
          <h2 className="mt-2 font-display text-[26px] leading-none tracking-[-0.03em]">
            Revenue mix
          </h2>
          <p className="mt-2 text-xs text-muted">MRR by plan · October 2026</p>
        </div>
        <Badge tone="neutral">{plans.length} plans</Badge>
      </div>

      <div
        aria-hidden="true"
        className="mt-6 flex h-2.5 w-full gap-1 overflow-hidden rounded-full"
      >
        {plans.map((plan) => (
          <span
            key={plan.id}
            className={cn("h-full", barToneClassNames[plan.tone])}
            style={{ width: `${(plan.mrr / totalMrr) * 100}%` }}
          />
        ))}
      </div>

      <ul className="mt-5 divide-y divide-line/75">
        {plans.map((plan) => {
          const share = (plan.mrr / totalMrr) * 100;

          return (
            <li key={plan.id} className="flex items-center gap-3 py-3 first:pt-0">
              <span
                aria-hidden="true"
                className={cn("h-2 w-2 shrink-0 rounded-full", dotToneClassNames[plan.tone])}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold tracking-[-0.01em] text-ink">
                  {plan.name}
                </p>
                <p className="mt-0.5 text-[10px] text-muted">
                  {plan.subscribers.toLocaleString("en-US")} subscriptions
                </p>
              </div>
              <div className="text-right">
                <p className="text-[12px] font-semibold tabular-nums text-ink">
                  {formatCurrency(plan.mrr)}
                </p>
                <p className="mt-0.5 font-mono text-[8.5px] uppercase tracking-[0.08em] text-muted/80">
                  {formatPercent(share).replace(".0", "")}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto rounded-2xl border border-lime-deep/30 bg-lime/20 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-ink/55">
              Net revenue retention
            </p>
            <p className="mt-2 font-display text-[2.2rem] leading-none tracking-[-0.04em] text-ink">
              {formatPercent(retention.netRevenueRetention)}
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2 py-1 font-mono text-[8px] uppercase tracking-[0.08em] text-lime">
            Healthy
          </span>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-ink/10 pt-3 text-[10px] text-ink/60">
          <p>
            Expansion{" "}
            <span className="font-semibold text-ink">
              {formatCompactCurrency(retention.expansionMrr)}
            </span>
          </p>
          <p>
            Churn{" "}
            <span className="font-semibold text-ink">
              {formatCompactCurrency(retention.churnedMrr)}
            </span>
          </p>
        </div>
      </div>
    </Card>
  );
}
