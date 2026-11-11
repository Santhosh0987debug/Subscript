import { API_PATHS } from "@subscript/shared";
import type {
  AnalyticsChurnResponse,
  AnalyticsCustomersResponse,
  AnalyticsDetailParams,
  AnalyticsInvoicesResponse,
  AnalyticsMrrResponse,
  AnalyticsOverviewResponse,
  AnalyticsPlansResponse,
  AnalyticsRangeParams,
  AnalyticsRevenueResponse,
  AnalyticsSubscriptionGrowthResponse,
  ApiErrorCode,
  ApiErrorResponse,
  ApiFieldIssue,
  AutomationDispatchResponse,
  AutomationJobListParams,
  AutomationJobListResponse,
  AutomationJobResponse,
  AutomationNotificationListParams,
  AutomationNotificationListResponse,
  AutomationNotificationResponse,
  AutomationOverviewResponse,
  CancelSubscriptionRequest,
  CreateCustomerRequest,
  CreatePlanRequest,
  CreateSubscriptionRequest,
  CurrentOrganizationResponse,
  CustomerListParams,
  CustomerListResponse,
  CustomerMutationResponse,
  CustomerResponse,
  GenerateInvoiceRequest,
  GenerateInvoiceResponse,
  GatewayCheckoutSession,
  GatewayConfigResponse,
  GatewayRefundRequest,
  GatewayRefundResponse,
  HealthResponse,
  InvoiceListParams,
  InvoiceListResponse,
  InvoiceResponse,
  LoginRequest,
  PaymentActionResponse,
  PlanListParams,
  PlanListResponse,
  PlanResponse,
  RecordPaymentRequest,
  RegisterRequest,
  SessionResponse,
  SubscriptionListParams,
  SubscriptionListResponse,
  SubscriptionMutationResponse,
  SubscriptionResponse,
  UpdateCustomerRequest,
  UpdateOrganizationResponse,
  UpdatePlanRequest,
  VerifyGatewayPaymentRequest,
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

export async function listSubscriptions(
  params: SubscriptionListParams = {},
  signal?: AbortSignal,
): Promise<SubscriptionListResponse> {
  const query = buildQuery({
    query: params.query?.trim(),
    status: params.status,
    sort: params.sort,
    direction: params.direction,
    page: params.page,
    pageSize: params.pageSize,
  });

  return requestJson<SubscriptionListResponse>(
    `${API_PATHS.subscriptions}${query}`,
    { signal },
  );
}

export async function getSubscription(
  subscriptionId: string,
  signal?: AbortSignal,
): Promise<SubscriptionResponse> {
  return requestJson<SubscriptionResponse>(
    API_PATHS.subscription(subscriptionId),
    { signal },
  );
}

export async function createSubscription(
  input: CreateSubscriptionRequest,
): Promise<SubscriptionMutationResponse> {
  return requestJson<SubscriptionMutationResponse>(API_PATHS.subscriptions, {
    method: "POST",
    body: input,
  });
}

export async function pauseSubscription(
  subscriptionId: string,
): Promise<SubscriptionMutationResponse> {
  return requestJson<SubscriptionMutationResponse>(
    API_PATHS.subscriptionPause(subscriptionId),
    { method: "POST" },
  );
}

export async function resumeSubscription(
  subscriptionId: string,
): Promise<SubscriptionMutationResponse> {
  return requestJson<SubscriptionMutationResponse>(
    API_PATHS.subscriptionResume(subscriptionId),
    { method: "POST" },
  );
}

export async function cancelSubscription(
  subscriptionId: string,
  input: CancelSubscriptionRequest = {},
): Promise<SubscriptionMutationResponse> {
  return requestJson<SubscriptionMutationResponse>(
    API_PATHS.subscriptionCancel(subscriptionId),
    { method: "POST", body: input },
  );
}

export async function renewSubscription(
  subscriptionId: string,
): Promise<SubscriptionMutationResponse> {
  return requestJson<SubscriptionMutationResponse>(
    API_PATHS.subscriptionRenew(subscriptionId),
    { method: "POST" },
  );
}

export async function expireSubscription(
  subscriptionId: string,
): Promise<SubscriptionMutationResponse> {
  return requestJson<SubscriptionMutationResponse>(
    API_PATHS.subscriptionExpire(subscriptionId),
    { method: "POST" },
  );
}

export async function markSubscriptionPastDue(
  subscriptionId: string,
): Promise<SubscriptionMutationResponse> {
  return requestJson<SubscriptionMutationResponse>(
    API_PATHS.subscriptionMarkPastDue(subscriptionId),
    { method: "POST" },
  );
}

export async function generateSubscriptionInvoice(
  subscriptionId: string,
  input: GenerateInvoiceRequest,
): Promise<GenerateInvoiceResponse> {
  return requestJson<GenerateInvoiceResponse>(
    API_PATHS.subscriptionInvoices(subscriptionId),
    { method: "POST", body: input },
  );
}

export async function listInvoices(
  params: InvoiceListParams = {},
  signal?: AbortSignal,
): Promise<InvoiceListResponse> {
  const query = buildQuery({
    query: params.query?.trim(),
    status: params.status,
    subscriptionId: params.subscriptionId,
    customerId: params.customerId,
    sort: params.sort,
    direction: params.direction,
    page: params.page,
    pageSize: params.pageSize,
  });

  return requestJson<InvoiceListResponse>(`${API_PATHS.invoices}${query}`, {
    signal,
  });
}

export async function getInvoice(
  invoiceId: string,
  signal?: AbortSignal,
): Promise<InvoiceResponse> {
  return requestJson<InvoiceResponse>(API_PATHS.invoice(invoiceId), {
    signal,
  });
}

export async function issueInvoice(
  invoiceId: string,
): Promise<InvoiceResponse> {
  return requestJson<InvoiceResponse>(API_PATHS.invoiceIssue(invoiceId), {
    method: "POST",
  });
}

export async function voidInvoice(
  invoiceId: string,
): Promise<InvoiceResponse> {
  return requestJson<InvoiceResponse>(API_PATHS.invoiceVoid(invoiceId), {
    method: "POST",
  });
}

export async function markInvoiceUncollectible(
  invoiceId: string,
): Promise<InvoiceResponse> {
  return requestJson<InvoiceResponse>(
    API_PATHS.invoiceMarkUncollectible(invoiceId),
    { method: "POST" },
  );
}

export async function recordPayment(
  invoiceId: string,
  input: RecordPaymentRequest,
): Promise<PaymentActionResponse> {
  return requestJson<PaymentActionResponse>(
    API_PATHS.invoicePayments(invoiceId),
    { method: "POST", body: input },
  );
}

export async function succeedPayment(
  paymentId: string,
): Promise<PaymentActionResponse> {
  return requestJson<PaymentActionResponse>(API_PATHS.paymentSucceed(paymentId), {
    method: "POST",
  });
}

export async function failPayment(
  paymentId: string,
): Promise<PaymentActionResponse> {
  return requestJson<PaymentActionResponse>(API_PATHS.paymentFail(paymentId), {
    method: "POST",
  });
}

export async function refundPayment(
  paymentId: string,
): Promise<PaymentActionResponse> {
  return requestJson<PaymentActionResponse>(API_PATHS.paymentRefund(paymentId), {
    method: "POST",
  });
}

export async function getGatewayConfig(
  signal?: AbortSignal,
): Promise<GatewayConfigResponse> {
  return requestJson<GatewayConfigResponse>(API_PATHS.gatewayConfig, {
    signal,
  });
}

export async function startInvoiceCheckout(
  invoiceId: string,
): Promise<GatewayCheckoutSession> {
  return requestJson<GatewayCheckoutSession>(
    API_PATHS.invoiceCheckout(invoiceId),
    { method: "POST" },
  );
}

export async function verifyGatewayPayment(
  paymentId: string,
  input: VerifyGatewayPaymentRequest,
): Promise<PaymentActionResponse> {
  return requestJson<PaymentActionResponse>(
    API_PATHS.paymentGatewayVerify(paymentId),
    { method: "POST", body: input },
  );
}

export async function cancelGatewayCheckout(
  paymentId: string,
  orderId?: string | null,
): Promise<PaymentActionResponse> {
  return requestJson<PaymentActionResponse>(
    API_PATHS.paymentGatewayCancel(paymentId),
    {
      method: "POST",
      body: orderId ? { orderId } : {},
    },
  );
}

export async function refundGatewayPayment(
  paymentId: string,
  input: GatewayRefundRequest,
): Promise<GatewayRefundResponse> {
  return requestJson<GatewayRefundResponse>(
    API_PATHS.paymentGatewayRefund(paymentId),
    { method: "POST", body: input },
  );
}

export async function getAutomationOverview(
  signal?: AbortSignal,
): Promise<AutomationOverviewResponse> {
  return requestJson<AutomationOverviewResponse>(
    API_PATHS.automationOverview,
    { signal },
  );
}

export async function listAutomationJobs(
  params: AutomationJobListParams = {},
  signal?: AbortSignal,
): Promise<AutomationJobListResponse> {
  const query = buildQuery({
    status: params.status,
    type: params.type,
    page: params.page,
    pageSize: params.pageSize,
  });

  return requestJson<AutomationJobListResponse>(
    `${API_PATHS.automationJobs}${query}`,
    { signal },
  );
}

export async function retryAutomationJob(
  jobId: string,
): Promise<AutomationJobResponse> {
  return requestJson<AutomationJobResponse>(
    API_PATHS.automationJobRetry(jobId),
    { method: "POST" },
  );
}

export async function listAutomationNotifications(
  params: AutomationNotificationListParams = {},
  signal?: AbortSignal,
): Promise<AutomationNotificationListResponse> {
  const query = buildQuery({
    status: params.status,
    type: params.type,
    page: params.page,
    pageSize: params.pageSize,
  });

  return requestJson<AutomationNotificationListResponse>(
    `${API_PATHS.automationNotifications}${query}`,
    { signal },
  );
}

export async function retryAutomationNotification(
  notificationId: string,
): Promise<AutomationNotificationResponse> {
  return requestJson<AutomationNotificationResponse>(
    API_PATHS.automationNotificationRetry(notificationId),
    { method: "POST" },
  );
}

export async function dispatchAutomationOutbox(): Promise<AutomationDispatchResponse> {
  return requestJson<AutomationDispatchResponse>(
    API_PATHS.automationDispatch,
    { method: "POST" },
  );
}

function analyticsQuery(
  params: AnalyticsRangeParams | AnalyticsDetailParams,
): string {
  return buildQuery({
    from: params.from,
    to: params.to,
    timezone: params.timezone,
    grouping: params.grouping,
    page: "page" in params ? params.page : undefined,
    pageSize: "pageSize" in params ? params.pageSize : undefined,
  });
}

export async function getAnalyticsOverview(
  params: AnalyticsRangeParams = {},
  signal?: AbortSignal,
): Promise<AnalyticsOverviewResponse> {
  return requestJson<AnalyticsOverviewResponse>(
    `${API_PATHS.analyticsOverview}${analyticsQuery(params)}`,
    { signal },
  );
}

export async function getAnalyticsRevenue(
  params: AnalyticsRangeParams = {},
  signal?: AbortSignal,
): Promise<AnalyticsRevenueResponse> {
  return requestJson<AnalyticsRevenueResponse>(
    `${API_PATHS.analyticsRevenue}${analyticsQuery(params)}`,
    { signal },
  );
}

export async function getAnalyticsMrr(
  params: AnalyticsRangeParams = {},
  signal?: AbortSignal,
): Promise<AnalyticsMrrResponse> {
  return requestJson<AnalyticsMrrResponse>(
    `${API_PATHS.analyticsMrr}${analyticsQuery(params)}`,
    { signal },
  );
}

export async function getAnalyticsSubscriptions(
  params: AnalyticsRangeParams = {},
  signal?: AbortSignal,
): Promise<AnalyticsSubscriptionGrowthResponse> {
  return requestJson<AnalyticsSubscriptionGrowthResponse>(
    `${API_PATHS.analyticsSubscriptions}${analyticsQuery(params)}`,
    { signal },
  );
}

export async function getAnalyticsChurn(
  params: AnalyticsRangeParams = {},
  signal?: AbortSignal,
): Promise<AnalyticsChurnResponse> {
  return requestJson<AnalyticsChurnResponse>(
    `${API_PATHS.analyticsChurn}${analyticsQuery(params)}`,
    { signal },
  );
}

export async function getAnalyticsCustomers(
  params: AnalyticsDetailParams = {},
  signal?: AbortSignal,
): Promise<AnalyticsCustomersResponse> {
  return requestJson<AnalyticsCustomersResponse>(
    `${API_PATHS.analyticsCustomers}${analyticsQuery(params)}`,
    { signal },
  );
}

export async function getAnalyticsPlans(
  params: AnalyticsDetailParams = {},
  signal?: AbortSignal,
): Promise<AnalyticsPlansResponse> {
  return requestJson<AnalyticsPlansResponse>(
    `${API_PATHS.analyticsPlans}${analyticsQuery(params)}`,
    { signal },
  );
}

export async function getAnalyticsInvoices(
  params: AnalyticsRangeParams = {},
  signal?: AbortSignal,
): Promise<AnalyticsInvoicesResponse> {
  return requestJson<AnalyticsInvoicesResponse>(
    `${API_PATHS.analyticsInvoices}${analyticsQuery(params)}`,
    { signal },
  );
}

export interface AnalyticsCsvDownload {
  filename: string;
  text: string;
}

function filenameFromDisposition(
  disposition: string | null,
  fallback: string,
): string {
  if (!disposition) {
    return fallback;
  }

  const match = /filename="?(?<name>[^";]+)"?/i.exec(disposition);
  return match?.groups?.name ?? fallback;
}

export async function fetchAnalyticsCsv(
  path: string,
  params: AnalyticsRangeParams = {},
  fallbackFilename = "analytics.csv",
): Promise<AnalyticsCsvDownload> {
  const response = await fetch(
    `${API_BASE_URL}${path}${analyticsQuery(params)}`,
    {
      method: "GET",
      credentials: "include",
      headers: { Accept: "text/csv" },
    },
  );

  if (!response.ok) {
    return rejectWithApiError(response);
  }

  return {
    filename: filenameFromDisposition(
      response.headers.get("content-disposition"),
      fallbackFilename,
    ),
    text: await response.text(),
  };
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
