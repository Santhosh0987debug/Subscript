import type { Express } from "express";
import { createApp } from "../../src/app.js";
import type { AuthService } from "../../src/auth/service.js";
import { createAuthService } from "../../src/auth/service.js";
import {
  createMemoryAuthStore,
  type MemoryAuthStore,
} from "../../src/auth/store/memory.js";
import type { RateLimitOptions } from "../../src/middleware/rate-limit.js";

export const TEST_ORIGIN = "http://localhost:5173";
export const TEST_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface TestApp {
  app: Express;
  authService: AuthService;
  store: MemoryAuthStore;
  sessionTtlMs: number;
}

export interface TestAppOptions {
  authRateLimit?: RateLimitOptions | false;
  cookieSecure?: boolean;
  sessionTtlMs?: number;
}

export function createTestApp(options: TestAppOptions = {}): TestApp {
  const store = createMemoryAuthStore();
  const sessionTtlMs = options.sessionTtlMs ?? TEST_SESSION_TTL_MS;
  const authService = createAuthService({
    store,
    passwordCost: 4,
    sessionTtlMs,
  });
  const app = createApp({
    authService,
    corsOrigins: [TEST_ORIGIN],
    cookieSecure: options.cookieSecure ?? false,
    sessionTtlMs,
    authRateLimit: options.authRateLimit ?? false,
  });

  return { app, authService, store, sessionTtlMs };
}
