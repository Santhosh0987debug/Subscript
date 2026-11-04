/**
 * API paths shared by the API server and its clients.
 */
export const API_PATHS = {
  health: "/api/health",
  authRegister: "/api/auth/register",
  authLogin: "/api/auth/login",
  authLogout: "/api/auth/logout",
  authMe: "/api/auth/me",
  currentOrganization: "/api/organizations/current",
  switchOrganization: (organizationId: string) =>
    `/api/organizations/${encodeURIComponent(organizationId)}/switch`,
} as const;

/**
 * Canonical error codes returned by the API.
 */
export type ApiErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR"
  | "TOO_MANY_REQUESTS"
  | "SERVICE_UNAVAILABLE";

export interface ApiFieldIssue {
  path: string;
  message: string;
}

export interface ApiErrorPayload {
  code: ApiErrorCode;
  message: string;
  requestId: string;
  details?: ApiFieldIssue[];
}

export interface ApiErrorResponse {
  error: ApiErrorPayload;
}

export interface HealthResponse {
  status: "ok";
  service: "subscript-api";
  version: string;
  timestamp: string;
  uptimeSeconds: number;
}
