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

export const TEST_ORIGIN = "http://localhost:5173";
export const TEST_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface TestApp {
  app: Express;
  authService: AuthService;
  store: MemoryAuthStore;
  customerStore: CustomerStore;
  planStore: MemoryPlanStore;
  sessionTtlMs: number;
}

export interface TestAppOptions {
  authRateLimit?: RateLimitOptions | false;
  cookieSecure?: boolean;
  sessionTtlMs?: number;
}

export function createTestApp(options: TestAppOptions = {}): TestApp {
  const store = createMemoryAuthStore();
  const customerStore = createMemoryCustomerStore();
  const planStore = createMemoryPlanStore();
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
    corsOrigins: [TEST_ORIGIN],
    cookieSecure: options.cookieSecure ?? false,
    sessionTtlMs,
    authRateLimit: options.authRateLimit ?? false,
  });

  return { app, authService, store, customerStore, planStore, sessionTtlMs };
}
