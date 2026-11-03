import { useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  RefreshCw,
  Sparkles,
  UserPlus,
  X,
} from "lucide-react";
import type { ActivityGroup, ActivityItem, ActivityKind, AvatarTone } from "@/data/overview";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";

type ActivityFilter = "all" | ActivityGroup;

const FILTERS: ReadonlyArray<{ value: ActivityFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "growth", label: "Growth" },
  { value: "risk", label: "At risk" },
];

const avatarToneClassNames: Record<AvatarTone, string> = {
  lime: "bg-lime text-ink",
  sky: "bg-[#dce9f0] text-[#2f5568]",
  sand: "bg-[#ede2ce] text-[#6a5638]",
  rose: "bg-coral-soft text-coral",
  moss: "bg-[#dde8dc] text-moss",
  violet: "bg-[#e6dfed] text-[#5b446e]",
};

const kindStyles: Record<
  ActivityKind,
  { icon: typeof ArrowUpRight; className: string }
> = {
  upgrade: { icon: ArrowUpRight, className: "bg-lime text-ink" },
  new: { icon: UserPlus, className: "bg-lime text-ink" },
  renewal: { icon: RefreshCw, className: "bg-[#dde8dc] text-moss" },
  payment_failed: { icon: AlertTriangle, className: "bg-coral text-white" },
  cancellation: { icon: X, className: "bg-coral-soft text-coral" },
  trial: { icon: Sparkles, className: "bg-[#dce9f0] text-[#2f5568]" },
};

const amountToneClassNames = {
  positive: "text-moss",
  negative: "text-coral",
  neutral: "text-muted",
};

interface ActivityFeedProps {
  items: readonly ActivityItem[];
}

export function ActivityFeed({ items }: ActivityFeedProps) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const filteredItems =
    filter === "all" ? items : items.filter((item) => item.group === filter);

  return (
    <Card className="flex h-full flex-col p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="eyebrow">Signal</p>
          <h2 className="mt-2 font-display text-[26px] leading-none tracking-[-0.03em]">
            Recent activity
          </h2>
          <p className="mt-2 text-xs text-muted">
            Expansions, renewals, and revenue at risk.
          </p>
        </div>

        <div
          role="group"
          aria-label="Filter activity"
          className="flex self-start rounded-full border border-line bg-surface-raised p-1"
        >
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={cn(
                "h-7 rounded-full px-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.08em] transition-colors",
                filter === option.value
                  ? "bg-ink text-surface"
                  : "text-muted hover:text-ink",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {filteredItems.length} activity events shown.
      </p>

      {filteredItems.length === 0 ? (
        <div className="flex flex-1 items-center py-6">
          <EmptyState
            icon={Sparkles}
            title="Nothing in this lane"
            description="Activity will appear here as customers expand, renew, or need attention."
            className="w-full"
          />
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-line/75">
          {filteredItems.map((item) => {
            const kindStyle = kindStyles[item.kind];
            const KindIcon = kindStyle.icon;

            return (
              <li key={item.id} className="flex items-start gap-3.5 py-3.5 first:pt-2 last:pb-0">
                <div className="relative mt-0.5 shrink-0">
                  <span
                    className={cn(
                      "grid h-9 w-9 place-items-center rounded-xl text-[10px] font-semibold tracking-[0.02em]",
                      avatarToneClassNames[item.avatarTone],
                    )}
                  >
                    {item.initials}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full ring-2 ring-surface",
                      kindStyle.className,
                    )}
                  >
                    <KindIcon className="h-2.5 w-2.5" strokeWidth={2.3} />
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] leading-5 text-ink">
                    <span className="font-semibold">{item.company}</span>{" "}
                    <span className="text-muted">{item.action}</span>
                  </p>
                  <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.1em] text-muted/80">
                    {item.meta}
                  </p>
                </div>

                <p
                  className={cn(
                    "shrink-0 pt-0.5 text-right text-[10.5px] font-semibold tabular-nums",
                    amountToneClassNames[item.amountTone],
                  )}
                >
                  {item.amount}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
