import { getCurrencyFractionDigits } from "@/lib/money";
import type { AnalyticsGrouping } from "@subscript/shared";

export type AnalyticsRangePreset = "30d" | "90d" | "12m" | "ytd" | "custom";

export interface AnalyticsDateRange {
  from: string;
  to: string;
}

export interface AnalyticsFilterState extends AnalyticsDateRange {
  preset: AnalyticsRangePreset;
  grouping: AnalyticsGrouping;
  timezone: string;
}

export const ANALYTICS_RANGE_PRESETS: ReadonlyArray<{
  value: AnalyticsRangePreset;
  label: string;
}> = [
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "12m", label: "Last 12 months" },
  { value: "ytd", label: "Year to date" },
  { value: "custom", label: "Custom range" },
];

export function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function analyticsPresetRange(
  preset: Exclude<AnalyticsRangePreset, "custom">,
  today = new Date(),
): AnalyticsDateRange {
  const to = localIsoDate(today);

  switch (preset) {
    case "30d":
      return { from: localIsoDate(addDays(today, -29)), to };
    case "90d":
      return { from: localIsoDate(addDays(today, -89)), to };
    case "12m": {
      const start = new Date(today.getFullYear(), today.getMonth() - 11, 1);
      return { from: localIsoDate(start), to };
    }
    case "ytd":
      return {
        from: localIsoDate(new Date(today.getFullYear(), 0, 1)),
        to,
      };
  }
}

export function daysBetweenIso(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return 0;
  }

  return Math.round((end - start) / 86_400_000) + 1;
}

export function formatBps(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "\u2014";
  }

  return `${(value / 100).toFixed(1)}%`;
}

export function formatBpsSigned(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "\u2014";
  }

  const prefix = value > 0 ? "+" : value < 0 ? "\u2212" : "";
  return `${prefix}${(Math.abs(value) / 100).toFixed(1)}%`;
}

export function formatCompactMoney(
  amountMinor: number,
  currency: string,
): string {
  const digits = getCurrencyFractionDigits(currency);
  const amount = amountMinor / 10 ** digits;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount);
}

export function defaultAnalyticsFilters(
  today = new Date(),
): AnalyticsFilterState {
  return {
    ...analyticsPresetRange("12m", today),
    preset: "12m",
    grouping: "month",
    timezone: "UTC",
  };
}

export function getBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
