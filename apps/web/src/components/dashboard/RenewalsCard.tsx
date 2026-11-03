import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { AvatarTone, Renewal } from "@/data/overview";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";

const dateToneClassNames: Record<AvatarTone, string> = {
  lime: "border-lime-deep/30 bg-lime/30",
  sky: "border-[#b8d3df]/60 bg-[#dce9f0]/70",
  sand: "border-[#d8c7aa]/60 bg-[#ede2ce]/70",
  rose: "border-coral/15 bg-coral-soft/80",
  moss: "border-[#b7ccb8]/60 bg-[#dde8dc]/70",
  violet: "border-[#cfc1dc]/60 bg-[#e6dfed]/70",
};

interface RenewalsCardProps {
  renewals: readonly Renewal[];
  total: number;
}

export function RenewalsCard({ renewals, total }: RenewalsCardProps) {
  return (
    <Card className="flex h-full flex-col p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Pipeline</p>
          <h2 className="mt-2 font-display text-[26px] leading-none tracking-[-0.03em]">
            Renewals ahead
          </h2>
          <p className="mt-2 text-xs text-muted">
            {renewals.length} renewals · {formatCompactCurrency(total)} scheduled
          </p>
        </div>
        <Badge tone="neutral">Next 14 days</Badge>
      </div>

      <ul className="mt-5 flex-1 divide-y divide-line/75">
        {renewals.map((renewal) => {
          const [dateMonth = "Nov", dateDay = "--"] = renewal.dateLabel.split(" ");

          return (
            <li key={renewal.id} className="flex items-center gap-3 py-3.5 first:pt-1">
              <div
                className={cn(
                  "flex w-11 shrink-0 flex-col items-center rounded-xl border py-1.5",
                  dateToneClassNames[renewal.avatarTone],
                )}
              >
                <span className="font-mono text-[7px] uppercase tracking-[0.12em] text-muted">
                  {dateMonth}
                </span>
                <span className="mt-0.5 font-display text-[19px] leading-none tracking-[-0.02em] text-ink">
                  {dateDay}
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold tracking-[-0.01em] text-ink">
                  {renewal.company}
                </p>
                <p className="mt-1 truncate text-[10px] text-muted">
                  {renewal.plan} · {renewal.relative.toLowerCase()}
                </p>
              </div>

              <p className="shrink-0 text-[12px] font-semibold tabular-nums text-ink">
                {formatCurrency(renewal.amount)}
              </p>
            </li>
          );
        })}
      </ul>

      <Link
        to="/subscriptions"
        className="mt-4 flex items-center justify-between border-t border-line pt-4 text-[11px] font-semibold text-ink transition-colors hover:text-moss"
      >
        View subscription timeline
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.9} />
      </Link>
    </Card>
  );
}
