import type { Express } from "express";
import { createApp } from "../../src/app.js";
import type { AuthService } from "../../src/auth/service.js";
import { createAuthService } from "../../src/auth/service.js";
import {
  createMemoryAuthStore,
  type MemoryAuthStore,
} from "../../src/auth/store/memory.js";
import {
  createMemoryCustomerStore,
} from "../../src/customers/store/memory.js";
import type { CustomerStore } from "../../src/customers/types.js";
import type { RateLimitOptions } from "../../src/middleware/rate-limit.js";
import type { MemoryPlanStore } from "../../src/plans/store/memory.js";
import { createMemoryPlanStore } from "../../src/plans/store/memory.js";
import { createMemorySubscriptionStore } from "../../src/subscriptions/store/memory.js";
import type { SubscriptionStore } from "../../src/subscriptions/types.js";
import { createMemoryInvoiceStore } from "../../src/invoices/store/memory.js";
import type { InvoiceStore } from "../../src/invoices/types.js";
import type { PaymentGateway } from "../../src/gateway/types.js";
import type { GatewayWebhookStore } from "../../src/gateway/webhook-store.js";
import {
  createMemoryGatewayWebhookStore,
} from "../../src/gateway/store/memory.js";

export const TEST_ORIGIN = "http://localhost:5173";
export const TEST_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface TestApp {
  app: Express;
  authService: AuthService;
  store: MemoryAuthStore;
  customerStore: CustomerStore;
  planStore: MemoryPlanStore;
  subscriptionStore: SubscriptionStore;
  invoiceStore: InvoiceStore;
  gatewayWebhookStore: GatewayWebhookStore;
  sessionTtlMs: number;
}

export interface TestAppOptions {
  authRateLimit?: RateLimitOptions | false;
  gatewayRateLimit?: RateLimitOptions | false;
  webhookRateLimit?: RateLimitOptions | false;
  cookieSecure?: boolean;
  sessionTtlMs?: number;
  gateway?: PaymentGateway | null;
  gatewayWebhookStore?: GatewayWebhookStore;
}

export function createTestApp(options: TestAppOptions = {}): TestApp {
  const store = createMemoryAuthStore();
  const customerStore = createMemoryCustomerStore();
  const planStore = createMemoryPlanStore();
  const subscriptionStore = createMemorySubscriptionStore();
  const invoiceStore = createMemoryInvoiceStore();
  const gatewayWebhookStore =
    options.gatewayWebhookStore ?? createMemoryGatewayWebhookStore();
  const sessionTtlMs = options.sessionTtlMs ?? TEST_SESSION_TTL_MS;
  const authService = createAuthService({
    store,
    passwordCost: 4,
    sessionTtlMs,
  });
  const app = createApp({
    authService,
    customerStore,
    planStore,
    subscriptionStore,
    invoiceStore,
    gateway: options.gateway ?? null,
    gatewayWebhookStore,
    corsOrigins: [TEST_ORIGIN],
    cookieSecure: options.cookieSecure ?? false,
    sessionTtlMs,
    authRateLimit: options.authRateLimit ?? false,
    gatewayRateLimit: options.gatewayRateLimit ?? false,
    webhookRateLimit: options.webhookRateLimit ?? false,
  });

  return {
    app,
    authService,
    store,
    customerStore,
    planStore,
    subscriptionStore,
    invoiceStore,
    gatewayWebhookStore,
    sessionTtlMs,
  };
}
