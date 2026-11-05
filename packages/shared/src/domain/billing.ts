import type { BillingInterval } from "./subscription.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Normalizes a date to UTC midnight. Billing periods are calendar based, so
 * comparing instants across time zones would otherwise drift by a day.
 */
export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * Parses a strict `YYYY-MM-DD` calendar date into a UTC midnight instant.
 * Returns null for impossible dates such as 2026-02-30.
 */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

export function formatIsoDate(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/** Adds whole calendar days in UTC without daylight-saving drift. */
export function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * Advances a billing date by one interval. Month-end dates clamp to the last
 * valid day of the target month (Jan 31 -> Feb 28/29), and leap-day annual
 * renewals clamp to Feb 28.
 */
export function addBillingInterval(
  date: Date,
  interval: BillingInterval,
): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const targetYear = interval === "YEAR" ? year + 1 : year;
  const targetMonth = interval === "YEAR" ? month : month + 1;
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  const targetDay = Math.min(day, lastDayOfTargetMonth);

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      targetDay,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

/**
 * Tax is configured in basis points (1/100th of a percent). The result is
 * rounded to the nearest minor unit so 8.25% on 10,000 cents is 825 cents.
 */
export function calculateTaxMinor(
  subtotalMinor: number,
  taxRateBps: number,
): number {
  return Math.round((subtotalMinor * taxRateBps) / 10_000);
}

export interface InvoiceTotals {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export function calculateInvoiceTotals(
  subtotalMinor: number,
  taxRateBps: number,
): InvoiceTotals {
  const taxMinor = calculateTaxMinor(subtotalMinor, taxRateBps);

  return {
    subtotalMinor,
    taxMinor,
    totalMinor: subtotalMinor + taxMinor,
  };
}
