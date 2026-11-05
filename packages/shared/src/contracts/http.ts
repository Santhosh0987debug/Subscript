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
  customers: "/api/customers",
  customer: (customerId: string) =>
    `/api/customers/${encodeURIComponent(customerId)}`,
  customerArchive: (customerId: string) =>
    `/api/customers/${encodeURIComponent(customerId)}/archive`,
  customerRestore: (customerId: string) =>
    `/api/customers/${encodeURIComponent(customerId)}/restore`,
  plans: "/api/plans",
  plan: (planId: string) => `/api/plans/${encodeURIComponent(planId)}`,
  planArchive: (planId: string) =>
    `/api/plans/${encodeURIComponent(planId)}/archive`,
  planRestore: (planId: string) =>
    `/api/plans/${encodeURIComponent(planId)}/restore`,
  subscriptions: "/api/subscriptions",
  subscription: (subscriptionId: string) =>
    `/api/subscriptions/${encodeURIComponent(subscriptionId)}`,
  subscriptionPause: (subscriptionId: string) =>
    `/api/subscriptions/${encodeURIComponent(subscriptionId)}/pause`,
  subscriptionResume: (subscriptionId: string) =>
    `/api/subscriptions/${encodeURIComponent(subscriptionId)}/resume`,
  subscriptionCancel: (subscriptionId: string) =>
    `/api/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
  subscriptionRenew: (subscriptionId: string) =>
    `/api/subscriptions/${encodeURIComponent(subscriptionId)}/renew`,
  subscriptionExpire: (subscriptionId: string) =>
    `/api/subscriptions/${encodeURIComponent(subscriptionId)}/expire`,
  subscriptionMarkPastDue: (subscriptionId: string) =>
    `/api/subscriptions/${encodeURIComponent(subscriptionId)}/mark-past-due`,
  subscriptionInvoices: (subscriptionId: string) =>
    `/api/subscriptions/${encodeURIComponent(subscriptionId)}/invoices`,
  invoices: "/api/invoices",
  invoice: (invoiceId: string) =>
    `/api/invoices/${encodeURIComponent(invoiceId)}`,
  invoiceIssue: (invoiceId: string) =>
    `/api/invoices/${encodeURIComponent(invoiceId)}/issue`,
  invoiceVoid: (invoiceId: string) =>
    `/api/invoices/${encodeURIComponent(invoiceId)}/void`,
  invoiceMarkUncollectible: (invoiceId: string) =>
    `/api/invoices/${encodeURIComponent(invoiceId)}/mark-uncollectible`,
  invoicePayments: (invoiceId: string) =>
    `/api/invoices/${encodeURIComponent(invoiceId)}/payments`,
  invoiceCheckout: (invoiceId: string) =>
    `/api/invoices/${encodeURIComponent(invoiceId)}/checkout`,
  payment: (paymentId: string) =>
    `/api/payments/${encodeURIComponent(paymentId)}`,
  paymentSucceed: (paymentId: string) =>
    `/api/payments/${encodeURIComponent(paymentId)}/succeed`,
  paymentFail: (paymentId: string) =>
    `/api/payments/${encodeURIComponent(paymentId)}/fail`,
  paymentRefund: (paymentId: string) =>
    `/api/payments/${encodeURIComponent(paymentId)}/refund`,
  paymentGatewayVerify: (paymentId: string) =>
    `/api/payments/${encodeURIComponent(paymentId)}/gateway/verify`,
  paymentGatewayRefund: (paymentId: string) =>
    `/api/payments/${encodeURIComponent(paymentId)}/gateway/refund`,
  gatewayConfig: "/api/gateway/config",
  razorpayWebhook: "/api/webhooks/razorpay",
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
  | "BAD_GATEWAY"
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
