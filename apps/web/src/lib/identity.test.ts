import { describe, expect, it } from "vitest";
import {
  formatWorkspaceDate,
  getFirstName,
  getInitials,
  getOrganizationRoleLabel,
} from "@/lib/identity";

describe("getInitials", () => {
  it("uses the first and last name", () => {
    expect(getInitials("Alex Morgan")).toBe("AM");
    expect(getInitials("  Ada   Lovelace  Byron ")).toBe("AB");
  });

  it("uses two letters for a single name", () => {
    expect(getInitials("Subscript")).toBe("SU");
  });

  it("handles missing names", () => {
    expect(getInitials("   ")).toBe("?");
  });
});

describe("getFirstName", () => {
  it("returns the first word", () => {
    expect(getFirstName("Alex Morgan")).toBe("Alex");
  });

  it("falls back when the name is empty", () => {
    expect(getFirstName("  ")).toBe("there");
  });
});

describe("getOrganizationRoleLabel", () => {
  it("maps every role to a display label", () => {
    expect(getOrganizationRoleLabel("OWNER")).toBe("Owner");
    expect(getOrganizationRoleLabel("ADMIN")).toBe("Admin");
    expect(getOrganizationRoleLabel("MEMBER")).toBe("Member");
  });
});

describe("formatWorkspaceDate", () => {
  it("formats ISO timestamps", () => {
    expect(formatWorkspaceDate("2026-11-03T12:00:00.000Z")).toMatch(/Nov 3, 2026/);
  });

  it("handles unparseable timestamps", () => {
    expect(formatWorkspaceDate("not-a-date")).toBe("Unknown");
  });
});
