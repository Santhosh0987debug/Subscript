/**
 * HTTP paths shared by the API and its clients.
 */
export const API_PATHS = {
  health: "/api/health",
} as const;

/**
 * Canonical error codes returned by the API.
 */
export type ApiErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

export interface ApiErrorPayload {
  code: ApiErrorCode;
  message: string;
  requestId: string;
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
