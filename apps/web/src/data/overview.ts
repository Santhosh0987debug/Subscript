import type { NumericFormat } from "@/lib/format";

export type MetricSentiment = "positive" | "negative" | "neutral";
export type ActivityGroup = "growth" | "risk";
export type ActivityKind =
  | "upgrade"
  | "new"
  | "renewal"
  | "payment_failed"
  | "cancellation"
  | "trial";
export type AvatarTone = "lime" | "sky" | "sand" | "rose" | "moss" | "violet";
export type PlanTone = "lime" | "ink" | "sand";

export interface MetricSummary {
  id: string;
  shortLabel: string;
  description: string;
  value: number;
  format: NumericFormat;
  change: number;
  changeSuffix: "%" | " pts";
  sentiment: MetricSentiment;
  comparison: string;
  note: string;
  sparkline: readonly number[];
}

export interface RevenuePoint {
  month: string;
  shortLabel: string;
  current: number;
  previous: number;
}

export interface PlanMixSlice {
  id: string;
  name: string;
  subscribers: number;
  mrr: number;
  tone: PlanTone;
}

export interface ActivityItem {
  id: string;
  company: string;
  initials: string;
  action: string;
  meta: string;
  amount: string;
  amountTone: "positive" | "negative" | "neutral";
  group: ActivityGroup;
  kind: ActivityKind;
  avatarTone: AvatarTone;
}

export interface Renewal {
  id: string;
  company: string;
  plan: string;
  dateLabel: string;
  relative: string;
  amount: number;
  initials: string;
  avatarTone: AvatarTone;
}

export interface RetentionSnapshot {
  netRevenueRetention: number;
  expansionMrr: number;
  churnedMrr: number;
}

export interface OverviewData {
  workspace: {
    name: string;
    asOf: string;
  };
  metrics: readonly MetricSummary[];
  revenue: readonly RevenuePoint[];
  planMix: readonly PlanMixSlice[];
  retention: RetentionSnapshot;
  activity: readonly ActivityItem[];
  renewals: readonly Renewal[];
}

export const overviewData: OverviewData = {
  workspace: {
    name: "Northwind Labs",
    asOf: "October 2026",
  },
  metrics: [
    {
      id: "mrr",
      shortLabel: "MRR",
      description: "Monthly recurring revenue",
      value: 84_290,
      format: "currency",
      change: 12.4,
      changeSuffix: "%",
      sentiment: "positive",
      comparison: "vs. Sep 2026",
      note: "$9.3k net new in October",
      sparkline: [
        38_420, 40_100, 42_850, 45_300, 48_900, 52_400, 57_100, 61_800, 66_400,
        70_200, 74_980, 84_290,
      ],
    },
    {
      id: "arr",
      shortLabel: "ARR",
      description: "Annual recurring revenue",
      value: 1_011_480,
      format: "compactCurrency",
      change: 12.4,
      changeSuffix: "%",
      sentiment: "positive",
      comparison: "vs. Sep 2026",
      note: "12× current MRR",
      sparkline: [
        38_420, 40_100, 42_850, 45_300, 48_900, 52_400, 57_100, 61_800, 66_400,
        70_200, 74_980, 84_290,
      ],
    },
    {
      id: "active-subscriptions",
      shortLabel: "Active subs",
      description: "Active subscriptions",
      value: 1_284,
      format: "number",
      change: 8.3,
      changeSuffix: "%",
      sentiment: "positive",
      comparison: "vs. Sep 2026",
      note: "98 net new in October",
      sparkline: [
        1_012, 1_035, 1_060, 1_084, 1_106, 1_128, 1_148, 1_160, 1_172, 1_180,
        1_186, 1_284,
      ],
    },
    {
      id: "net-churn",
      shortLabel: "Net churn",
      description: "Net revenue churn",
      value: 2.4,
      format: "percent",
      change: -0.6,
      changeSuffix: " pts",
      sentiment: "positive",
      comparison: "vs. Sep 2026",
      note: "Below the 3% target",
      sparkline: [3.8, 3.7, 3.5, 3.6, 3.3, 3.2, 3.1, 3.0, 3.1, 2.9, 3.0, 2.4],
    },
  ],
  revenue: [
    { month: "Nov 2025", shortLabel: "Nov", current: 38_420, previous: 21_400 },
    { month: "Dec 2025", shortLabel: "Dec", current: 40_100, previous: 22_600 },
    { month: "Jan 2026", shortLabel: "Jan", current: 42_850, previous: 24_100 },
    { month: "Feb 2026", shortLabel: "Feb", current: 45_300, previous: 25_800 },
    { month: "Mar 2026", shortLabel: "Mar", current: 48_900, previous: 27_600 },
    { month: "Apr 2026", shortLabel: "Apr", current: 52_400, previous: 29_300 },
    { month: "May 2026", shortLabel: "May", current: 57_100, previous: 31_100 },
    { month: "Jun 2026", shortLabel: "Jun", current: 61_800, previous: 32_500 },
    { month: "Jul 2026", shortLabel: "Jul", current: 66_400, previous: 33_900 },
    { month: "Aug 2026", shortLabel: "Aug", current: 70_200, previous: 35_100 },
    { month: "Sep 2026", shortLabel: "Sep", current: 74_980, previous: 36_000 },
    { month: "Oct 2026", shortLabel: "Oct", current: 84_290, previous: 36_900 },
  ],
  planMix: [
    { id: "scale", name: "Scale", subscribers: 312, mrr: 38_810, tone: "lime" },
    { id: "growth", name: "Growth", subscribers: 520, mrr: 31_990, tone: "ink" },
    { id: "starter", name: "Starter", subscribers: 452, mrr: 13_490, tone: "sand" },
  ],
  retention: {
    netRevenueRetention: 108.2,
    expansionMrr: 6_400,
    churnedMrr: 2_010,
  },
  activity: [
    {
      id: "act-1",
      company: "Meridian Studio",
      initials: "MS",
      action: "upgraded to Scale",
      meta: "Expansion · 12 min ago",
      amount: "+$490/mo",
      amountTone: "positive",
      group: "growth",
      kind: "upgrade",
      avatarTone: "lime",
    },
    {
      id: "act-2",
      company: "Halcyon Health",
      initials: "HH",
      action: "added 24 seats",
      meta: "Growth plan · 48 min ago",
      amount: "+$360/mo",
      amountTone: "positive",
      group: "growth",
      kind: "new",
      avatarTone: "moss",
    },
    {
      id: "act-3",
      company: "Northstar Freight",
      initials: "NF",
      action: "payment failed",
      meta: "Scale plan · 2 hr ago",
      amount: "$1,240 at risk",
      amountTone: "negative",
      group: "risk",
      kind: "payment_failed",
      avatarTone: "rose",
    },
    {
      id: "act-4",
      company: "Fable & Co.",
      initials: "FC",
      action: "canceled Growth",
      meta: "Cancellation · 4 hr ago",
      amount: "−$299/mo",
      amountTone: "negative",
      group: "risk",
      kind: "cancellation",
      avatarTone: "sand",
    },
    {
      id: "act-5",
      company: "Lumen Analytics",
      initials: "LA",
      action: "started a Scale trial",
      meta: "Trial · 6 hr ago",
      amount: "Trial",
      amountTone: "neutral",
      group: "growth",
      kind: "trial",
      avatarTone: "sky",
    },
    {
      id: "act-6",
      company: "Arcadia Labs",
      initials: "AL",
      action: "renewed an annual plan",
      meta: "Renewal · 9 hr ago",
      amount: "+$12,900/yr",
      amountTone: "positive",
      group: "growth",
      kind: "renewal",
      avatarTone: "violet",
    },
  ],
  renewals: [
    {
      id: "ren-1",
      company: "Meridian Studio",
      plan: "Scale · monthly",
      dateLabel: "Nov 04",
      relative: "In 2 days",
      amount: 1_470,
      initials: "MS",
      avatarTone: "lime",
    },
    {
      id: "ren-2",
      company: "Copperline",
      plan: "Growth · monthly",
      dateLabel: "Nov 06",
      relative: "In 4 days",
      amount: 890,
      initials: "CO",
      avatarTone: "sand",
    },
    {
      id: "ren-3",
      company: "Alder & Finch",
      plan: "Scale · annual",
      dateLabel: "Nov 09",
      relative: "In 7 days",
      amount: 2_490,
      initials: "AF",
      avatarTone: "moss",
    },
    {
      id: "ren-4",
      company: "Juniper Works",
      plan: "Growth · monthly",
      dateLabel: "Nov 12",
      relative: "In 10 days",
      amount: 640,
      initials: "JW",
      avatarTone: "sky",
    },
  ],
};

export const planMixTotalMrr = overviewData.planMix.reduce(
  (total, plan) => total + plan.mrr,
  0,
);

export const upcomingRenewalTotal = overviewData.renewals.reduce(
  (total, renewal) => total + renewal.amount,
  0,
);
