import type {
  AnalyticsRevenueReportRow,
  AnalyticsSubscriptionReportRow,
} from "./types.js";

function currencyFractionDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

export function formatMinorAsDecimal(
  amountMinor: number,
  currency: string,
): string {
  const digits = currencyFractionDigits(currency);
  const negative = amountMinor < 0;
  const absolute = Math.abs(amountMinor);

  if (digits === 0) {
    return `${negative ? "-" : ""}${absolute}`;
  }

  const factor = 10 ** digits;
  const whole = Math.floor(absolute / factor);
  const fraction = String(absolute % factor).padStart(digits, "0");

  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function escapeText(value: string): string {
  // Prefix spreadsheet formulas (including ones hidden behind leading
  // whitespace) with an apostrophe so CSV readers treat them as text.
  const guarded = /^\s*[=+\-@\t\r]/.test(value) ? `'${value}` : value;

  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replaceAll('"', '""')}"`;
  }

  return guarded;
}

function cell(value: string | number | null): string {
  if (value === null) {
    return "";
  }

  return typeof value === "number" ? String(value) : escapeText(value);
}

function toCsv(rows: readonly (readonly (string | number | null)[])[]): string {
  return `${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

function percent(bps: number | null): string {
  return bps === null ? "" : (bps / 100).toFixed(2);
}

export function buildRevenueCsv(
  rows: readonly AnalyticsRevenueReportRow[],
): string {
  return toCsv([
    [
      "Period start",
      "Period end",
      "Period",
      "Currency",
      "Invoiced",
      "Gross collected",
      "Refunds",
      "Net collected",
      "Outstanding",
      "New subscriptions",
      "Canceled subscriptions",
    ],
    ...rows.map((row) => [
      row.bucketStart,
      row.bucketEnd,
      row.label,
      row.currency,
      formatMinorAsDecimal(row.invoicedMinor, row.currency),
      formatMinorAsDecimal(row.grossCollectedMinor, row.currency),
      formatMinorAsDecimal(row.refundedMinor, row.currency),
      formatMinorAsDecimal(row.netCollectedMinor, row.currency),
      formatMinorAsDecimal(row.outstandingMinor, row.currency),
      row.newSubscriptions,
      row.canceledSubscriptions,
    ]),
  ]);
}

export function buildSubscriptionCsv(
  rows: readonly AnalyticsSubscriptionReportRow[],
): string {
  return toCsv([
    [
      "Report from",
      "Report to",
      "Plan",
      "Plan code",
      "Interval",
      "Currency",
      "Active subscriptions",
      "New subscriptions",
      "Canceled subscriptions",
      "MRR",
      "ARR",
      "Net collected",
      "Outstanding",
      "Churn rate (%)",
    ],
    ...rows.map((row) => [
      row.reportFrom,
      row.reportTo,
      row.planName,
      row.planCode,
      row.interval,
      row.currency,
      row.activeSubscriptions,
      row.newSubscriptions,
      row.canceledSubscriptions,
      formatMinorAsDecimal(row.mrrMinor, row.currency),
      formatMinorAsDecimal(row.arrMinor, row.currency),
      formatMinorAsDecimal(row.netCollectedMinor, row.currency),
      formatMinorAsDecimal(row.outstandingMinor, row.currency),
      percent(row.churnRateBps),
    ]),
  ]);
}
