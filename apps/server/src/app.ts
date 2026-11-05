import express, { type Express, type RequestHandler } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { API_PATHS } from "@subscript/shared";
import type { AuthService } from "./auth/service.js";
import { SESSION_COOKIE_NAME } from "./auth/session-token.js";
import type { CustomerStore } from "./customers/types.js";
import { createCustomersRouter } from "./customers/router.js";
import type { InvoiceStore } from "./invoices/types.js";
import { createInvoicesRouter } from "./invoices/router.js";
import type { PaymentGateway } from "./gateway/types.js";
import { createGatewayRouter } from "./gateway/router.js";
import { createGatewayService } from "./gateway/service.js";
import { createMemoryGatewayWebhookStore } from "./gateway/store/memory.js";
import type { GatewayWebhookStore } from "./gateway/webhook-store.js";
import { createRazorpayWebhookRouter } from "./gateway/webhook-router.js";
import { errorHandler } from "./middleware/error-handler.js";
import { createAuthenticate } from "./middleware/authenticate.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { createOriginGuard } from "./middleware/origin-guard.js";
import { requireOrganization } from "./middleware/organization.js";
import {
  createAuthRateLimiter,
  createRequestRateLimiter,
  DEFAULT_AUTH_RATE_LIMIT,
  DEFAULT_GATEWAY_RATE_LIMIT,
  DEFAULT_WEBHOOK_RATE_LIMIT,
  type RateLimitOptions,
} from "./middleware/rate-limit.js";
import { requireRole } from "./middleware/require-role.js";
import { requestId } from "./middleware/request-id.js";
import { createPlansRouter } from "./plans/router.js";
import type { PlanStore } from "./plans/types.js";
import type { SubscriptionStore } from "./subscriptions/types.js";
import { createSubscriptionsRouter } from "./subscriptions/router.js";
import { createAuthRouter } from "./routes/auth.js";
import { createOrganizationsRouter } from "./routes/organizations.js";
import { healthHandler } from "./routes/health.js";

const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173",
] as const;

const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AppOptions {
  authService: AuthService;
  customerStore: CustomerStore;
  planStore: PlanStore;
  subscriptionStore: SubscriptionStore;
  invoiceStore: InvoiceStore;
  gateway?: PaymentGateway | null;
  gatewayWebhookStore?: GatewayWebhookStore;
  corsOrigins?: readonly string[];
  cookieName?: string;
  cookieSecure?: boolean;
  sessionTtlMs?: number;
  authRateLimit?: RateLimitOptions | false;
  gatewayRateLimit?: RateLimitOptions | false;
  webhookRateLimit?: RateLimitOptions | false;
  trustProxy?: boolean;
}

export function createApp(options: AppOptions): Express {
  const app = express();
  const allowedOrigins = [...(options.corsOrigins ?? DEFAULT_CORS_ORIGINS)];
  const cookieName = options.cookieName ?? SESSION_COOKIE_NAME;
  const cookieSecure = options.cookieSecure ?? false;
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const authenticate = createAuthenticate({
    authService: options.authService,
    cookieName,
  });
  const allowAll: RequestHandler = (_req, _res, next) => next();
  const rateLimitOptions =
    options.authRateLimit === false
      ? false
      : (options.authRateLimit ?? DEFAULT_AUTH_RATE_LIMIT);
  const loginRateLimiter = rateLimitOptions
    ? createAuthRateLimiter(rateLimitOptions)
    : allowAll;
  const registerRateLimiter = rateLimitOptions
    ? createAuthRateLimiter(rateLimitOptions)
    : allowAll;
  const gatewayRateLimiter =
    options.gatewayRateLimit === false
      ? allowAll
      : createRequestRateLimiter(
          options.gatewayRateLimit ?? DEFAULT_GATEWAY_RATE_LIMIT,
          "Too many gateway requests. Wait a moment and try again.",
        );
  const webhookRateLimiter =
    options.webhookRateLimit === false
      ? allowAll
      : createRequestRateLimiter(
          options.webhookRateLimit ?? DEFAULT_WEBHOOK_RATE_LIMIT,
          "Too many webhook deliveries. Retry shortly.",
        );
  const gatewayWebhookStore =
    options.gatewayWebhookStore ?? createMemoryGatewayWebhookStore();
  const gatewayService = createGatewayService({
    gateway: options.gateway ?? null,
    invoiceStore: options.invoiceStore,
    webhookStore: gatewayWebhookStore,
  });
  const cookie = {
    name: cookieName,
    secure: cookieSecure,
    ttlMs: sessionTtlMs,
  };

  app.disable("x-powered-by");
  app.set("trust proxy", options.trustProxy ?? false);
  app.use(requestId);
  app.use(helmet());
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 600,
    }),
  );
  app.use(createOriginGuard(allowedOrigins));
  app.use(
    createRazorpayWebhookRouter({
      gatewayService,
      rateLimiter: webhookRateLimiter,
    }),
  );
  app.use(express.json({ limit: "64kb", strict: true }));
  app.use(cookieParser());

  app.get(API_PATHS.health, healthHandler);
  app.use(
    createGatewayRouter({
      gatewayService,
      invoiceStore: options.invoiceStore,
      authenticate,
      requireOrganization,
      requireAdmin: requireRole("OWNER", "ADMIN"),
      rateLimiter: gatewayRateLimiter,
    }),
  );

  app.use(
    createAuthRouter({
      authService: options.authService,
      cookie,
      authenticate,
      loginRateLimiter,
      registerRateLimiter,
    }),
  );

  app.use(
    createOrganizationsRouter({
      authService: options.authService,
      authenticate,
      requireOrganization,
      requireAdmin: requireRole("OWNER", "ADMIN"),
      cookieName,
    }),
  );

  app.use(
    createCustomersRouter({
      customerStore: options.customerStore,
      authenticate,
      requireOrganization,
      requireAdmin: requireRole("OWNER", "ADMIN"),
    }),
  );

  app.use(
    createPlansRouter({
      planStore: options.planStore,
      authenticate,
      requireOrganization,
      requireAdmin: requireRole("OWNER", "ADMIN"),
    }),
  );

  app.use(
    createSubscriptionsRouter({
      subscriptionStore: options.subscriptionStore,
      invoiceStore: options.invoiceStore,
      customerStore: options.customerStore,
      planStore: options.planStore,
      authenticate,
      requireOrganization,
      requireAdmin: requireRole("OWNER", "ADMIN"),
    }),
  );

  app.use(
    createInvoicesRouter({
      invoiceStore: options.invoiceStore,
      authenticate,
      requireOrganization,
      requireAdmin: requireRole("OWNER", "ADMIN"),
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
