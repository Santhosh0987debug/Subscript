import { API_PATHS } from "@subscript/shared";
import type {
  ApiErrorCode,
  ApiErrorResponse,
  ApiFieldIssue,
  CreateCustomerRequest,
  CreatePlanRequest,
  CurrentOrganizationResponse,
  CustomerListParams,
  CustomerListResponse,
  CustomerMutationResponse,
  CustomerResponse,
  HealthResponse,
  LoginRequest,
  PlanListParams,
  PlanListResponse,
  PlanResponse,
  RegisterRequest,
  SessionResponse,
  UpdateCustomerRequest,
  UpdateOrganizationResponse,
  UpdatePlanRequest,
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
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal | undefined;
}

function buildQuery(
  params: Record<string, string | number | undefined>,
): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      searchParams.set(key, String(value));
    }
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
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

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();

  if (text.length === 0) {
    return undefined as T;
  }

  return JSON.parse(text) as T;
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

export async function listCustomers(
  params: CustomerListParams = {},
  signal?: AbortSignal,
): Promise<CustomerListResponse> {
  const query = buildQuery({
    query: params.query?.trim(),
    status: params.status,
    sort: params.sort,
    direction: params.direction,
    page: params.page,
    pageSize: params.pageSize,
  });

  return requestJson<CustomerListResponse>(`${API_PATHS.customers}${query}`, {
    signal,
  });
}

export async function getCustomer(
  customerId: string,
  signal?: AbortSignal,
): Promise<CustomerResponse> {
  return requestJson<CustomerResponse>(API_PATHS.customer(customerId), {
    signal,
  });
}

export async function createCustomer(
  input: CreateCustomerRequest,
): Promise<CustomerMutationResponse> {
  return requestJson<CustomerMutationResponse>(API_PATHS.customers, {
    method: "POST",
    body: input,
  });
}

export async function updateCustomer(
  customerId: string,
  input: UpdateCustomerRequest,
): Promise<CustomerMutationResponse> {
  return requestJson<CustomerMutationResponse>(
    API_PATHS.customer(customerId),
    {
      method: "PATCH",
      body: input,
    },
  );
}

export async function archiveCustomer(
  customerId: string,
): Promise<CustomerMutationResponse> {
  return requestJson<CustomerMutationResponse>(
    API_PATHS.customerArchive(customerId),
    { method: "POST" },
  );
}

export async function restoreCustomer(
  customerId: string,
): Promise<CustomerMutationResponse> {
  return requestJson<CustomerMutationResponse>(
    API_PATHS.customerRestore(customerId),
    { method: "POST" },
  );
}

export async function listPlans(
  params: PlanListParams = {},
  signal?: AbortSignal,
): Promise<PlanListResponse> {
  const query = buildQuery({
    query: params.query?.trim(),
    status: params.status,
    interval: params.interval,
    sort: params.sort,
    direction: params.direction,
    page: params.page,
    pageSize: params.pageSize,
  });

  return requestJson<PlanListResponse>(`${API_PATHS.plans}${query}`, {
    signal,
  });
}

export async function getPlan(
  planId: string,
  signal?: AbortSignal,
): Promise<PlanResponse> {
  return requestJson<PlanResponse>(API_PATHS.plan(planId), { signal });
}

export async function createPlan(
  input: CreatePlanRequest,
): Promise<PlanResponse> {
  return requestJson<PlanResponse>(API_PATHS.plans, {
    method: "POST",
    body: input,
  });
}

export async function updatePlan(
  planId: string,
  input: UpdatePlanRequest,
): Promise<PlanResponse> {
  return requestJson<PlanResponse>(API_PATHS.plan(planId), {
    method: "PATCH",
    body: input,
  });
}

export async function archivePlan(planId: string): Promise<PlanResponse> {
  return requestJson<PlanResponse>(API_PATHS.planArchive(planId), {
    method: "POST",
  });
}

export async function restorePlan(planId: string): Promise<PlanResponse> {
  return requestJson<PlanResponse>(API_PATHS.planRestore(planId), {
    method: "POST",
  });
}

export async function deletePlan(planId: string): Promise<void> {
  await requestJson<void>(API_PATHS.plan(planId), { method: "DELETE" });
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
