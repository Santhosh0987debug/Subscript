import { describe, expect, it } from "vitest";
import {
  buildAreaPath,
  buildSmoothPath,
  clamp,
  niceCeiling,
} from "@/lib/chart";

describe("chart geometry", () => {
  it("returns an empty path for no points", () => {
    expect(buildSmoothPath([])).toBe("");
  });

  it("draws a move command for a single point", () => {
    expect(buildSmoothPath([{ x: 1, y: 2 }])).toBe("M 1 2");
  });

  it("draws a smooth cubic path through multiple points", () => {
    const path = buildSmoothPath([
      { x: 0, y: 30 },
      { x: 20, y: 10 },
      { x: 40, y: 20 },
    ]);

    expect(path.startsWith("M 0 30")).toBe(true);
    expect(path.match(/C /g)).toHaveLength(2);
    expect(path).not.toContain("NaN");
  });

  it("closes an area path at the baseline", () => {
    const path = buildAreaPath(
      [
        { x: 0, y: 20 },
        { x: 10, y: 10 },
      ],
      40,
    );

    expect(path.endsWith("L 0 40 Z")).toBe(true);
  });
});

describe("chart helpers", () => {
  it("clamps values", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it("rounds axis ceilings to clean values", () => {
    expect(niceCeiling(84_290)).toBe(100_000);
    expect(niceCeiling(49)).toBe(50);
    expect(niceCeiling(0)).toBe(1);
  });
});
