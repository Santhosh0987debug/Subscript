import { API_PATHS } from "@subscript/shared";
import type {
  ApiErrorCode,
  ApiErrorResponse,
  ApiFieldIssue,
  CurrentOrganizationResponse,
  HealthResponse,
  LoginRequest,
  RegisterRequest,
  SessionResponse,
  UpdateOrganizationResponse,
} from "@subscript/shared";

const API_BASE_URL = (
  import.meta.env.VITE_API_URL ?? "http://localhost:4000"
).replace(/\/+$/, "");

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: ApiFieldIssue[];

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    details: ApiFieldIssue[] = [],
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  signal?: AbortSignal;
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const error = (value as Record<string, unknown>).error;

  return typeof error === "object" && error !== null && "message" in error;
}

async function rejectWithApiError(response: Response): Promise<never> {
  const payload: unknown = await response.json().catch(() => null);

  if (isApiErrorResponse(payload)) {
    throw new ApiClientError(
      response.status,
      payload.error.code,
      payload.error.message,
      payload.error.details ?? [],
    );
  }

  throw new ApiClientError(
    response.status,
    "INTERNAL_ERROR",
    "The request could not be completed.",
  );
}

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      credentials: "include",
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    throw new ApiClientError(
      0,
      "SERVICE_UNAVAILABLE",
      "Unable to reach the Subscript API. Check that the server is running.",
    );
  }

  if (!response.ok) {
    return rejectWithApiError(response);
  }

  return (await response.json()) as T;
}

export async function fetchSession(): Promise<SessionResponse | null> {
  try {
    return await requestJson<SessionResponse>(API_PATHS.authMe);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) {
      return null;
    }

    throw error;
  }
}

export async function registerAccount(input: RegisterRequest): Promise<SessionResponse> {
  return requestJson<SessionResponse>(API_PATHS.authRegister, {
    method: "POST",
    body: input,
  });
}

export async function loginAccount(input: LoginRequest): Promise<SessionResponse> {
  return requestJson<SessionResponse>(API_PATHS.authLogin, {
    method: "POST",
    body: input,
  });
}

export async function logoutAccount(): Promise<void> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${API_PATHS.authLogout}`, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ApiClientError(
      0,
      "SERVICE_UNAVAILABLE",
      "Unable to reach the Subscript API. Check that the server is running.",
    );
  }

  if (!response.ok) {
    await rejectWithApiError(response);
  }
}

export async function switchOrganization(
  organizationId: string,
): Promise<SessionResponse> {
  return requestJson<SessionResponse>(API_PATHS.switchOrganization(organizationId), {
    method: "POST",
  });
}

export async function getCurrentOrganization(): Promise<CurrentOrganizationResponse> {
  return requestJson<CurrentOrganizationResponse>(API_PATHS.currentOrganization);
}

export async function updateOrganizationName(
  name: string,
): Promise<UpdateOrganizationResponse> {
  return requestJson<UpdateOrganizationResponse>(API_PATHS.currentOrganization, {
    method: "PATCH",
    body: { name },
  });
}

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
