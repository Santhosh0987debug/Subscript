import { describe, expect, it } from "vitest";
import {
  formatChange,
  formatChartCurrency,
  formatCompactCurrency,
  formatCurrency,
  formatMetricValue,
  formatNumber,
  formatPercent,
  formatSignedCurrency,
} from "@/lib/format";

describe("currency formatting", () => {
  it("formats full USD values without fractional cents", () => {
    expect(formatCurrency(84_290)).toBe("$84,290");
    expect(formatCurrency(0)).toBe("$0");
  });

  it("formats compact values for headline metrics", () => {
    expect(formatCompactCurrency(1_011_480)).toBe("$1.01M");
    expect(formatCompactCurrency(6_400)).toBe("$6.4K");
  });

  it("uses a typographic minus sign for signed values", () => {
    expect(formatSignedCurrency(9_310)).toBe("+$9,310");
    expect(formatSignedCurrency(-9_310)).toBe("\u2212$9,310");
  });
});

describe("metric formatting", () => {
  it("formats each supported metric type", () => {
    expect(formatMetricValue(84_290, "currency")).toBe("$84,290");
    expect(formatMetricValue(1_011_480, "compactCurrency")).toBe("$1.01M");
    expect(formatMetricValue(1_284, "number")).toBe("1,284");
    expect(formatMetricValue(2.4, "percent")).toBe("2.4%");
  });

  it("formats changes including percentage point decreases", () => {
    expect(formatChange(12.4, "%")).toBe("+12.4%");
    expect(formatChange(-0.6, " pts")).toBe("\u22120.6 pts");
    expect(formatChange(0, "%")).toBe("0.0%");
  });

  it("formats chart axes in compact USD", () => {
    expect(formatChartCurrency(0)).toBe("$0");
    expect(formatChartCurrency(25_000)).toBe("$25k");
    expect(formatChartCurrency(100_000)).toBe("$100k");
    expect(formatChartCurrency(1_000_000)).toBe("$1.0m");
  });

  it("formats percentages and whole numbers", () => {
    expect(formatPercent(108.2)).toBe("108.2%");
    expect(formatNumber(1_284)).toBe("1,284");
  });
});
