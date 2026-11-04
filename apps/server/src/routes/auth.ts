import { Router, type RequestHandler } from "express";
import type { SessionResponse } from "@subscript/shared";
import {
  clearSessionCookie,
  setSessionCookie,
  type SessionCookieOptions,
} from "../auth/cookies.js";
import type { AuthService } from "../auth/service.js";
import { loginSchema, registerSchema } from "../auth/validation.js";
import { parseBody } from "../lib/validation.js";
import { readSessionToken } from "../middleware/authenticate.js";
import { AppError } from "../errors/app-error.js";
import { API_PATHS } from "@subscript/shared";

export interface AuthRouterOptions {
  authService: AuthService;
  cookie: SessionCookieOptions;
  authenticate: RequestHandler;
  loginRateLimiter: RequestHandler;
  registerRateLimiter: RequestHandler;
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const router = Router();
  const cookieName = options.cookie.name;

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.post(API_PATHS.authRegister, options.registerRateLimiter, async (req, res) => {
    const payload = parseBody(registerSchema, req.body);
    const result = await options.authService.register(payload);

    setSessionCookie(res, result.token, options.cookie);
    res.status(201).json(result.session satisfies SessionResponse);
  });

  router.post(API_PATHS.authLogin, options.loginRateLimiter, async (req, res) => {
    const payload = parseBody(loginSchema, req.body);
    const result = await options.authService.login(payload);

    setSessionCookie(res, result.token, options.cookie);
    res.status(200).json(result.session satisfies SessionResponse);
  });

  router.post(API_PATHS.authLogout, async (req, res) => {
    const token = readSessionToken(req, cookieName);
    await options.authService.logout(token);
    clearSessionCookie(res, options.cookie);
    res.status(204).end();
  });

  router.get(API_PATHS.authMe, options.authenticate, (_req, res) => {
    const authenticated = res.locals.auth;

    if (!authenticated) {
      throw new AppError(401, "UNAUTHORIZED", "Sign in to continue.");
    }

    res.status(200).json(authenticated.session);
  });

  return router;
}
