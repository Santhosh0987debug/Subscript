import { describe, expect, it } from "vitest";
import {
  normalizeMrrMinor,
  percentageBps,
} from "../src/analytics/calc.js";
import {
  buildAnalyticsBuckets,
  resolveAnalyticsQuery,
  zonedMidnight,
} from "../src/analytics/range.js";
import { AppError } from "../src/errors/app-error.js";

function expectValidationError(run: () => unknown, path: string) {
  let caught: unknown;

  try {
    run();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(AppError);
  const error = caught as AppError;
  expect(error.statusCode).toBe(400);
  expect(error.code).toBe("VALIDATION_ERROR");
  expect(error.details?.some((issue) => issue.path === path)).toBe(true);
}

describe("analytics range resolution", () => {
  it("builds inclusive calendar ranges with exclusive end instants", () => {
    const query = resolveAnalyticsQuery(
      {
        from: "2026-01-01",
        to: "2026-03-31",
        timezone: "America/New_York",
        grouping: "month",
      },
      new Date("2026-06-01T00:00:00.000Z"),
    );

    expect(query.fromDate).toBe("2026-01-01");
    expect(query.toDate).toBe("2026-03-31");
    expect(query.from.toISOString()).toBe("2026-01-01T05:00:00.000Z");
    expect(query.toExclusive.toISOString()).toBe("2026-04-01T04:00:00.000Z");
    expect(query.buckets.map((bucket) => bucket.label)).toEqual([
      "Jan 2026",
      "Feb 2026",
      "Mar 2026",
    ]);
  });

  it("walks day buckets across a daylight-saving transition", () => {
    const buckets = buildAnalyticsBuckets(
      { year: 2026, month: 3, day: 7 },
      { year: 2026, month: 3, day: 9 },
      "America/New_York",
      "day",
    );

    expect(buckets.map((bucket) => bucket.start.toISOString())).toEqual([
      "2026-03-07T05:00:00.000Z",
      "2026-03-08T05:00:00.000Z",
      "2026-03-09T04:00:00.000Z",
    ]);
    expect(buckets.map((bucket) => bucket.end.toISOString())).toEqual([
      "2026-03-08T05:00:00.000Z",
      "2026-03-09T04:00:00.000Z",
      "2026-03-10T04:00:00.000Z",
    ]);
  });

  it("starts ISO week buckets on Monday", () => {
    const buckets = buildAnalyticsBuckets(
      { year: 2026, month: 1, day: 7 },
      { year: 2026, month: 1, day: 20 },
      "UTC",
      "week",
    );

    expect(buckets.map((bucket) => bucket.label)).toEqual([
      "Week of Jan 5",
      "Week of Jan 12",
      "Week of Jan 19",
    ]);
  });

  it("resolves today in the reporting timezone, not UTC", () => {
    const query = resolveAnalyticsQuery(
      { timezone: "America/Los_Angeles", grouping: "day" },
      new Date("2026-01-01T00:30:00.000Z"),
    );

    expect(query.toDate).toBe("2025-12-31");
    expect(query.fromDate).toBe("2025-01-01");
    expect(query.toExclusive.toISOString()).toBe("2026-01-01T08:00:00.000Z");
  });

  it("resolves local midnight across both sides of a DST change", () => {
    expect(
      zonedMidnight(
        { year: 2026, month: 3, day: 8 },
        "America/New_York",
      ).toISOString(),
    ).toBe("2026-03-08T05:00:00.000Z");
    expect(
      zonedMidnight(
        { year: 2026, month: 3, day: 9 },
        "America/New_York",
      ).toISOString(),
    ).toBe("2026-03-09T04:00:00.000Z");
    expect(
      zonedMidnight(
        { year: 2026, month: 10, day: 25 },
        "Europe/London",
      ).toISOString(),
    ).toBe("2026-10-24T23:00:00.000Z");
  });

  it("defaults to the last twelve calendar months", () => {
    const query = resolveAnalyticsQuery(
      { grouping: "month" },
      new Date("2026-11-09T12:00:00.000Z"),
    );

    expect(query.fromDate).toBe("2025-12-01");
    expect(query.toDate).toBe("2026-11-09");
    expect(query.buckets).toHaveLength(12);
    expect(query.buckets[0]?.label).toBe("Dec 2025");
    expect(query.buckets[11]?.label).toBe("Nov 2026");
  });

  it("rejects invalid dates, ranges, timezones, and oversized buckets", () => {
    expectValidationError(
      () =>
        resolveAnalyticsQuery({
          from: "2026-02-30",
          to: "2026-03-01",
        }),
      "from",
    );
    expectValidationError(
      () =>
        resolveAnalyticsQuery({
          from: "2026-03-02",
          to: "2026-03-01",
        }),
      "from",
    );
    expectValidationError(
      () =>
        resolveAnalyticsQuery({
          from: "2026-01-01",
          to: "2026-01-02",
          timezone: "Mars/Olympus_Mons",
        }),
      "timezone",
    );
    expectValidationError(
      () =>
        resolveAnalyticsQuery({
          from: "2020-01-01",
          to: "2026-01-01",
        }),
      "from",
    );
    expectValidationError(
      () =>
        resolveAnalyticsQuery({
          from: "2025-01-01",
          to: "2026-06-01",
          grouping: "day",
        }),
      "grouping",
    );
  });
});

describe("analytics formulas", () => {
  it("normalizes annual prices to monthly MRR with rounding", () => {
    expect(normalizeMrrMinor(2_900, 1, "MONTH")).toBe(2_900);
    expect(normalizeMrrMinor(2_900, 3, "MONTH")).toBe(8_700);
    expect(normalizeMrrMinor(120_000, 1, "YEAR")).toBe(10_000);
    expect(normalizeMrrMinor(100_000, 1, "YEAR")).toBe(8_333);
    expect(normalizeMrrMinor(10_000, 3, "YEAR")).toBe(2_500);
  });

  it("returns null percentages when there is no denominator", () => {
    expect(percentageBps(0, 0)).toBeNull();
    expect(percentageBps(10, 0)).toBeNull();
    expect(percentageBps(0, 10)).toBe(0);
    expect(percentageBps(5, 10)).toBe(5_000);
    expect(percentageBps(1, 3)).toBe(3_333);
  });
});
