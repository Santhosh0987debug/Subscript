import { describe, expect, it } from "vitest";
import {
  overviewData,
  planMixTotalMrr,
  upcomingRenewalTotal,
} from "@/data/overview";

describe("preview overview data", () => {
  it("contains the four required headline metrics", () => {
    expect(overviewData.metrics.map((metric) => metric.id)).toEqual([
      "mrr",
      "arr",
      "active-subscriptions",
      "net-churn",
    ]);
  });

  it("keeps MRR consistent across the metrics and revenue series", () => {
    const latestPoint = overviewData.revenue.at(-1);
    const mrrMetric = overviewData.metrics.find((metric) => metric.id === "mrr");
    const arrMetric = overviewData.metrics.find((metric) => metric.id === "arr");

    expect(mrrMetric?.value).toBe(latestPoint?.current);
    expect(arrMetric?.value).toBe((latestPoint?.current ?? 0) * 12);
  });

  it("derives plan mix totals that match MRR and subscription counts", () => {
    const latestMrr = overviewData.revenue.at(-1)?.current;

    expect(planMixTotalMrr).toBe(latestMrr);
    expect(
      overviewData.planMix.reduce((total, plan) => total + plan.subscribers, 0),
    ).toBe(
      overviewData.metrics.find((metric) => metric.id === "active-subscriptions")
        ?.value,
    );
  });

  it("shows year-over-year growth in every revenue month", () => {
    for (const point of overviewData.revenue) {
      expect(point.current).toBeGreaterThan(point.previous);
    }
  });

  it("models improving net churn against the previous month", () => {
    const churn = overviewData.metrics.find((metric) => metric.id === "net-churn");
    const sparkline = churn?.sparkline ?? [];
    const latest = sparkline.at(-1);
    const previous = sparkline.at(-2);

    expect(churn?.change).toBeLessThan(0);
    expect(churn?.sentiment).toBe("positive");
    expect(latest).toBeLessThan(previous ?? Number.POSITIVE_INFINITY);
  });

  it("provides both growth and risk activity and a renewal total", () => {
    expect(overviewData.activity.some((item) => item.group === "growth")).toBe(true);
    expect(overviewData.activity.some((item) => item.group === "risk")).toBe(true);
    expect(upcomingRenewalTotal).toBeGreaterThan(0);
  });
});
