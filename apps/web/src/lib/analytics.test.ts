import { describe, expect, it } from "vitest";
import {
  analyticsPresetRange,
  daysBetweenIso,
  defaultAnalyticsFilters,
  formatBps,
  formatBpsSigned,
  formatCompactMoney,
} from "./analytics";

describe("analytics range helpers", () => {
  const today = new Date(2026, 10, 9);

  it("builds inclusive preset windows", () => {
    expect(analyticsPresetRange("30d", today)).toEqual({
      from: "2026-10-11",
      to: "2026-11-09",
    });
    expect(analyticsPresetRange("90d", today)).toEqual({
      from: "2026-08-12",
      to: "2026-11-09",
    });
    expect(analyticsPresetRange("12m", today)).toEqual({
      from: "2025-12-01",
      to: "2026-11-09",
    });
    expect(analyticsPresetRange("ytd", today)).toEqual({
      from: "2026-01-01",
      to: "2026-11-09",
    });
  });

  it("counts inclusive calendar days across month and year changes", () => {
    expect(daysBetweenIso("2026-01-01", "2026-01-01")).toBe(1);
    expect(daysBetweenIso("2026-01-31", "2026-02-01")).toBe(2);
    expect(daysBetweenIso("2025-12-31", "2026-01-01")).toBe(2);
    expect(daysBetweenIso("not-a-date", "2026-01-01")).toBe(0);
  });

  it("defaults to a monthly trailing year in UTC", () => {
    expect(defaultAnalyticsFilters(today)).toEqual({
      from: "2025-12-01",
      to: "2026-11-09",
      preset: "12m",
      grouping: "month",
      timezone: "UTC",
    });
  });
});

describe("analytics formatting helpers", () => {
  it("formats basis points and keeps null denominators explicit", () => {
    expect(formatBps(1_234)).toBe("12.3%");
    expect(formatBps(0)).toBe("0.0%");
    expect(formatBps(null)).toBe("\u2014");
  });

  it("formats signed basis points with a minus sign", () => {
    expect(formatBpsSigned(250)).toBe("+2.5%");
    expect(formatBpsSigned(0)).toBe("0.0%");
    expect(formatBpsSigned(-1_250)).toBe("\u221212.5%");
    expect(formatBpsSigned(null)).toBe("\u2014");
  });

  it("formats minor units with compact currency notation", () => {
    expect(formatCompactMoney(0, "USD")).toContain("$");
    expect(formatCompactMoney(125_000, "USD")).toContain("1.3");
    expect(formatCompactMoney(125_000, "JPY")).toContain("\u00a5");
  });
});
