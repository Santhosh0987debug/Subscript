import { API_PATHS } from "@subscript/shared";
import type { HealthResponse } from "@subscript/shared";

const API_BASE_URL = (
  import.meta.env.VITE_API_URL ?? "http://localhost:4000"
).replace(/\/+$/, "");

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    candidate.status === "ok" &&
    candidate.service === "subscript-api" &&
    typeof candidate.version === "string" &&
    typeof candidate.timestamp === "string" &&
    typeof candidate.uptimeSeconds === "number"
  );
}

export async function getApiHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}${API_PATHS.health}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}.`);
  }

  const payload: unknown = await response.json();

  if (!isHealthResponse(payload)) {
    throw new Error("Health check returned an unexpected payload.");
  }

  return payload;
}
