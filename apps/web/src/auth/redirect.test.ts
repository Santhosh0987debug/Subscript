import { describe, expect, it } from "vitest";
import { getRedirectTarget } from "@/auth/redirect";

describe("getRedirectTarget", () => {
  it("accepts an internal destination", () => {
    expect(getRedirectTarget({ from: "/settings?tab=team" })).toBe(
      "/settings?tab=team",
    );
  });

  it("defaults to the overview", () => {
    expect(getRedirectTarget(undefined)).toBe("/");
    expect(getRedirectTarget({})).toBe("/");
    expect(getRedirectTarget({ from: 42 })).toBe("/");
  });

  it("rejects external and protocol-relative destinations", () => {
    expect(getRedirectTarget({ from: "https://attacker.example.com" })).toBe("/");
    expect(getRedirectTarget({ from: "//attacker.example.com" })).toBe("/");
  });

  it("never loops back to an auth page", () => {
    expect(getRedirectTarget({ from: "/login" })).toBe("/");
    expect(getRedirectTarget({ from: "/register" })).toBe("/");
  });
});
