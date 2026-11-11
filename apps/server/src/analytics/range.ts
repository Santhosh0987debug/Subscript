import type {
  AnalyticsGrouping,
  AnalyticsRange,
} from "@subscript/shared";
import { AppError } from "../errors/app-error.js";

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

export interface AnalyticsBucket {
  start: Date;
  end: Date;
  label: string;
}

export interface ResolvedAnalyticsQuery {
  /** Inclusive calendar date in the reporting timezone. */
  fromDate: string;
  /** Inclusive calendar date in the reporting timezone. */
  toDate: string;
  /** Inclusive instant at local midnight of fromDate. */
  from: Date;
  /** Exclusive instant at local midnight after toDate. */
  toExclusive: Date;
  timezone: string;
  grouping: AnalyticsGrouping;
  buckets: AnalyticsBucket[];
  now: Date;
}

export interface AnalyticsQueryInput {
  from?: string | undefined;
  to?: string | undefined;
  timezone?: string | undefined;
  grouping?: AnalyticsGrouping | undefined;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const MAX_BUCKETS = 400;
const MAX_RANGE_DAYS = 5 * 366;

function invalid(field: string, message: string): AppError {
  return new AppError(400, "VALIDATION_ERROR", "The request query is invalid.", [
    { path: field, message },
  ]);
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

export function formatDateParts(parts: DateParts): string {
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

function parseDateParts(value: string, field: string): DateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());

  if (!match) {
    throw invalid(field, "Use a real calendar date in YYYY-MM-DD form.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    year < 1970 ||
    year > 9999 ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw invalid(field, "Use a real calendar date in YYYY-MM-DD form.");
  }

  return { year, month, day };
}

function addDays(parts: DateParts, days: number): DateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function addMonths(parts: DateParts, months: number): DateParts {
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1 + months, 1, 12),
  );

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: 1,
  };
}

function startOfMonth(parts: DateParts): DateParts {
  return { year: parts.year, month: parts.month, day: 1 };
}

function startOfIsoWeek(parts: DateParts): DateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const weekday = date.getUTCDay();
  const offset = (weekday + 6) % 7;

  return addDays(parts, -offset);
}

function daysBetween(left: DateParts, right: DateParts): number {
  const leftUtc = Date.UTC(left.year, left.month - 1, left.day);
  const rightUtc = Date.UTC(right.year, right.month - 1, right.day);

  return Math.round((rightUtc - leftUtc) / 86_400_000);
}

function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
    return true;
  } catch {
    return false;
  }
}

function timeZoneOffsetMs(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((entry) => entry.type === type);

    return part ? Number(part.value) : 0;
  };
  const wallClockUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
  const withoutMilliseconds = date.getTime() - date.getMilliseconds();

  return wallClockUtc - withoutMilliseconds;
}

/**
 * Converts a wall-clock local date at midnight into a UTC instant. The offset
 * is resolved twice so daylight-saving transitions are handled consistently.
 */
export function zonedMidnight(parts: DateParts, timezone: string): Date {
  const wallClockUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  let instant = wallClockUtc - timeZoneOffsetMs(new Date(wallClockUtc), timezone);

  for (let iteration = 0; iteration < 2; iteration += 1) {
    instant = wallClockUtc - timeZoneOffsetMs(new Date(instant), timezone);
  }

  return new Date(instant);
}

export function dateInTimeZone(date: Date, timezone: string): DateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((entry) => entry.type === type);

    return part ? Number(part.value) : 0;
  };

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
  };
}

function bucketLabel(parts: DateParts, grouping: AnalyticsGrouping): string {
  const month = MONTH_NAMES[parts.month - 1] ?? "Jan";

  switch (grouping) {
    case "day":
      return `${month} ${parts.day}`;
    case "week":
      return `Week of ${month} ${parts.day}`;
    case "month":
      return `${month} ${parts.year}`;
  }
}

function nextBucketStart(
  parts: DateParts,
  grouping: AnalyticsGrouping,
): DateParts {
  switch (grouping) {
    case "day":
      return addDays(parts, 1);
    case "week":
      return addDays(parts, 7);
    case "month":
      return addMonths(parts, 1);
  }
}

export function buildAnalyticsBuckets(
  from: DateParts,
  to: DateParts,
  timezone: string,
  grouping: AnalyticsGrouping,
): AnalyticsBucket[] {
  let cursor =
    grouping === "month"
      ? startOfMonth(from)
      : grouping === "week"
        ? startOfIsoWeek(from)
        : from;
  const buckets: AnalyticsBucket[] = [];

  while (daysBetween(cursor, to) >= 0) {
    const next = nextBucketStart(cursor, grouping);

    buckets.push({
      start: zonedMidnight(cursor, timezone),
      end: zonedMidnight(next, timezone),
      label: bucketLabel(cursor, grouping),
    });

    if (buckets.length > MAX_BUCKETS) {
      throw invalid(
        "grouping",
        `This range produces more than ${MAX_BUCKETS} data points. Choose a coarser grouping or a shorter range.`,
      );
    }

    cursor = next;
  }

  return buckets;
}

export function resolveAnalyticsQuery(
  input: AnalyticsQueryInput,
  now = new Date(),
): ResolvedAnalyticsQuery {
  const timezone = (input.timezone?.trim() || "UTC").trim();

  if (!isValidTimeZone(timezone)) {
    throw invalid("timezone", "Choose a valid IANA timezone, for example Europe/London.");
  }

  const grouping = input.grouping ?? "month";
  const today = dateInTimeZone(now, timezone);
  const toParts = input.to ? parseDateParts(input.to, "to") : today;
  const fromParts = input.from
    ? parseDateParts(input.from, "from")
    : startOfMonth(addMonths(toParts, -11));
  const rangeDays = daysBetween(fromParts, toParts);

  if (rangeDays < 0) {
    throw invalid("from", "The start date must be on or before the end date.");
  }

  if (rangeDays > MAX_RANGE_DAYS) {
    throw invalid("from", "Analytics ranges are limited to five years.");
  }

  const from = zonedMidnight(fromParts, timezone);
  const toExclusive = zonedMidnight(addDays(toParts, 1), timezone);
  const buckets = buildAnalyticsBuckets(
    fromParts,
    toParts,
    timezone,
    grouping,
  );

  return {
    fromDate: formatDateParts(fromParts),
    toDate: formatDateParts(toParts),
    from,
    toExclusive,
    timezone,
    grouping,
    buckets,
    now,
  };
}

export function toAnalyticsRange(query: ResolvedAnalyticsQuery): AnalyticsRange {
  return {
    from: query.fromDate,
    to: query.toDate,
    fromIso: query.from.toISOString(),
    toIso: query.toExclusive.toISOString(),
    timezone: query.timezone,
    grouping: query.grouping,
  };
}

export function findBucket(
  buckets: readonly AnalyticsBucket[],
  instant: Date,
): AnalyticsBucket | null {
  const time = instant.getTime();

  return (
    buckets.find(
      (bucket) => bucket.start.getTime() <= time && time < bucket.end.getTime(),
    ) ?? null
  );
}
