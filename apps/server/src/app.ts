import express, { type Express, type RequestHandler } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { API_PATHS } from "@subscript/shared";
import type { AuthService } from "./auth/service.js";
import { SESSION_COOKIE_NAME } from "./auth/session-token.js";
import { errorHandler } from "./middleware/error-handler.js";
import { createAuthenticate } from "./middleware/authenticate.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { createOriginGuard } from "./middleware/origin-guard.js";
import { requireOrganization } from "./middleware/organization.js";
import {
  createAuthRateLimiter,
  DEFAULT_AUTH_RATE_LIMIT,
  type RateLimitOptions,
} from "./middleware/rate-limit.js";
import { requireRole } from "./middleware/require-role.js";
import { requestId } from "./middleware/request-id.js";
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
  corsOrigins?: readonly string[];
  cookieName?: string;
  cookieSecure?: boolean;
  sessionTtlMs?: number;
  authRateLimit?: RateLimitOptions | false;
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
  app.use(express.json({ limit: "64kb", strict: true }));
  app.use(cookieParser());

  app.get(API_PATHS.health, healthHandler);

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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
