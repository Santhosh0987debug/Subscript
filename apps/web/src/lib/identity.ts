import type { OrganizationRole } from "@subscript/shared";

export const organizationRoleLabels: Record<OrganizationRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
};

export function getOrganizationRoleLabel(role: OrganizationRole): string {
  return organizationRoleLabels[role];
}

export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];

  if (!first) {
    return "?";
  }

  const last = words.length > 1 ? words[words.length - 1] : undefined;

  if (!last || last === first) {
    return first.slice(0, 2).toUpperCase();
  }

  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

export function getFirstName(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean)[0] ?? "there";
}

export function formatWorkspaceDate(isoDate: string): string {
  const date = new Date(isoDate);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
