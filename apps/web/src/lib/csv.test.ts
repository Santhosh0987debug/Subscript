import { describe, expect, it } from "vitest";
import { toRevenueCsv } from "@/lib/csv";

describe("toRevenueCsv", () => {
  it("emits a header and formatted rows", () => {
    const csv = toRevenueCsv([
      { month: "Oct 2026", current: 84_290, previous: 36_900 },
    ]);
    const lines = csv.split("\r\n");

    expect(lines[0]).toBe(
      "Month,This year MRR (USD),Previous year MRR (USD)",
    );
    expect(lines[1]).toBe('"Oct 2026",84290.00,36900.00');
  });

  it("escapes commas and quotes in month labels", () => {
    const csv = toRevenueCsv([
      { month: 'Oct, "2026"', current: 1, previous: 1 },
    ]);

    expect(csv).toContain('"Oct, ""2026"""');
  });
});
