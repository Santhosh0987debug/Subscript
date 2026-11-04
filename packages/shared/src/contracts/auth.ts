import type { IsoDateString } from "../domain/subscription.js";

export const ORGANIZATION_ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  createdAt: IsoDateString;
}

export interface OrganizationMembershipSummary {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  joinedAt: IsoDateString;
  createdAt: IsoDateString;
}

/**
 * The authenticated session returned by register, login, and me.
 * The session token itself only ever travels in an HttpOnly cookie.
 */
export interface SessionResponse {
  user: AuthUser;
  organizations: OrganizationMembershipSummary[];
  activeOrganizationId: string | null;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  organizationName: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface OrganizationDetails {
  id: string;
  name: string;
  slug: string;
  createdAt: IsoDateString;
}

export interface OrganizationMemberSummary {
  userId: string;
  name: string;
  email: string;
  role: OrganizationRole;
  joinedAt: IsoDateString;
}

export interface CurrentOrganizationResponse {
  organization: OrganizationDetails;
  role: OrganizationRole;
  members: OrganizationMemberSummary[];
}

export interface UpdateOrganizationRequest {
  name: string;
}

export interface UpdateOrganizationResponse {
  organization: OrganizationDetails;
}
