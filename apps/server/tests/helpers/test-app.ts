import type { Express } from "express";
import { createApp } from "../../src/app.js";
import { createMemoryAutomationCandidateSource } from "../../src/automation/candidates/memory.js";
import { createNotificationService } from "../../src/automation/notifications/service.js";
import type {
  EmailProvider,
  EmailSendResult,
} from "../../src/automation/notifications/types.js";
import {
  createAutomationService,
  type AutomationService,
  type AutomationServiceConfig,
} from "../../src/automation/service.js";
import { createMemoryAutomationStore } from "../../src/automation/store/memory.js";
import type {
  AutomationJobDispatcher,
  AutomationStore,
} from "../../src/automation/types.js";
import type { NotificationDispatcher } from "../../src/automation/notifications/types.js";
import type { AuthService } from "../../src/auth/service.js";
import { createAuthService } from "../../src/auth/service.js";
import {
  createMemoryAuthStore,
  type MemoryAuthStore,
} from "../../src/auth/store/memory.js";
import { createDisabledAutomationHealth } from "../../src/automation/queue/client.js";
import { parseEnv } from "../../src/config/env.js";
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
import type { ReadinessOptions } from "../../src/routes/health.js";

export const TEST_ORIGIN = "http://localhost:5173";
export const TEST_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function createSilentEmailProvider(): EmailProvider {
  let sequence = 0;

  return {
    name: "test",
    async send(): Promise<EmailSendResult> {
      sequence += 1;
      return {
        providerName: "test",
        providerMessageId: `test-${sequence}`,
      };
    },
  };
}

export interface TestApp {
  app: Express;
  authService: AuthService;
  store: MemoryAuthStore;
  customerStore: CustomerStore;
  planStore: MemoryPlanStore;
  subscriptionStore: SubscriptionStore;
  invoiceStore: InvoiceStore;
  gatewayWebhookStore: GatewayWebhookStore;
  automationStore: AutomationStore;
  automationCandidates: ReturnType<typeof createMemoryAutomationCandidateSource>;
  automationService: AutomationService;
  notificationService: ReturnType<typeof createNotificationService>;
  emailProvider: EmailProvider;
  sessionTtlMs: number;
}

export interface TestAppOptions {
  authRateLimit?: RateLimitOptions | false;
  apiRateLimit?: RateLimitOptions | false;
  gatewayRateLimit?: RateLimitOptions | false;
  webhookRateLimit?: RateLimitOptions | false;
  cookieSecure?: boolean;
  cookieName?: string;
  sessionTtlMs?: number;
  gateway?: PaymentGateway | null;
  gatewayWebhookStore?: GatewayWebhookStore;
  automationConfig?: Partial<AutomationServiceConfig>;
  automationDispatcher?: AutomationJobDispatcher | null;
  notificationDispatcher?: NotificationDispatcher | null;
  emailProvider?: EmailProvider;
  logRequests?: boolean;
  metricsToken?: string | null;
  readiness?: ReadinessOptions;
}

export function createTestApp(options: TestAppOptions = {}): TestApp {
  const store = createMemoryAuthStore();
  const customerStore = createMemoryCustomerStore();
  const planStore = createMemoryPlanStore();
  const subscriptionStore = createMemorySubscriptionStore();
  const invoiceStore = createMemoryInvoiceStore();
  const gatewayWebhookStore =
    options.gatewayWebhookStore ?? createMemoryGatewayWebhookStore();
  const automationStore = createMemoryAutomationStore();
  const automationCandidates = createMemoryAutomationCandidateSource();
  const sessionTtlMs = options.sessionTtlMs ?? TEST_SESSION_TTL_MS;
  const authService = createAuthService({
    store,
    passwordCost: 4,
    sessionTtlMs,
  });
  const emailProvider =
    options.emailProvider ?? createSilentEmailProvider();
  const automationDefaults = parseEnv({ NODE_ENV: "test" }).automation;
  const notificationService = createNotificationService({
    store: automationStore,
    provider: emailProvider,
    from: "Subscript Test <test@subscript.local>",
    maxAttempts: automationDefaults.notificationMaxAttempts,
    retryBaseMs: automationDefaults.notificationRetryBaseMs,
    retryMaxMs: automationDefaults.notificationRetryMaxMs,
    dispatcher: options.notificationDispatcher ?? null,
  });
  const automationService = createAutomationService({
    store: automationStore,
    candidates: automationCandidates,
    subscriptions: subscriptionStore,
    invoices: invoiceStore,
    customers: customerStore,
    notifications: notificationService,
    dispatcher: options.automationDispatcher ?? null,
    config: {
      renewalReminderWindowDays:
        automationDefaults.renewalReminderWindowDays,
      trialReminderWindowDays: automationDefaults.trialReminderWindowDays,
      invoiceDueInDays: automationDefaults.invoiceDueInDays,
      invoiceTaxRateBps: automationDefaults.invoiceTaxRateBps,
      jobMaxAttempts: automationDefaults.jobMaxAttempts,
      jobBackoffBaseMs: automationDefaults.jobBackoffBaseMs,
      jobBackoffMaxMs: automationDefaults.jobBackoffMaxMs,
      paymentRetryBaseMs: automationDefaults.paymentRetryBaseMs,
      paymentRetryMaxMs: automationDefaults.paymentRetryMaxMs,
      paymentRetryMaxAttempts: automationDefaults.paymentRetryMaxAttempts,
      paymentExhaustionAction: automationDefaults.paymentExhaustionAction,
      pastDueExpiryDays: automationDefaults.pastDueExpiryDays,
      workerStaleMs: automationDefaults.workerStaleMs,
      ...options.automationConfig,
    },
  });
  const app = createApp({
    authService,
    customerStore,
    planStore,
    subscriptionStore,
    invoiceStore,
    gateway: options.gateway ?? null,
    gatewayWebhookStore,
    automation: {
      store: automationStore,
      service: automationService,
      notificationService,
      subscriptionStore,
      health: async () =>
        createDisabledAutomationHealth("Redis is not configured in tests."),
      renewalWindowDays: automationDefaults.renewalReminderWindowDays,
    },
    corsOrigins: [TEST_ORIGIN],
    ...(options.cookieName ? { cookieName: options.cookieName } : {}),
    cookieSecure: options.cookieSecure ?? false,
    sessionTtlMs,
    authRateLimit: options.authRateLimit ?? false,
    apiRateLimit: options.apiRateLimit ?? false,
    gatewayRateLimit: options.gatewayRateLimit ?? false,
    webhookRateLimit: options.webhookRateLimit ?? false,
    logRequests: options.logRequests ?? false,
    metricsToken: options.metricsToken ?? null,
    ...(options.readiness ? { readiness: options.readiness } : {}),
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
    automationStore,
    automationCandidates,
    automationService,
    notificationService,
    emailProvider,
    sessionTtlMs,
  };
}