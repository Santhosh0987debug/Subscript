import type { Request, RequestHandler } from "express";
import type { AuthService } from "../auth/service.js";
import { SESSION_COOKIE_NAME } from "../auth/session-token.js";
import { AppError } from "../errors/app-error.js";

export interface AuthenticationOptions {
  authService: AuthService;
  cookieName?: string;
}

export function readSessionToken(req: Request, cookieName = SESSION_COOKIE_NAME): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const token = cookies?.[cookieName];

  return typeof token === "string" && token.length > 0 ? token : undefined;
}

export function createAuthenticate(options: AuthenticationOptions): RequestHandler {
  const cookieName = options.cookieName ?? SESSION_COOKIE_NAME;

  return async (req, res, next) => {
    try {
      const token = readSessionToken(req, cookieName);
      const authenticated = await options.authService.resolveSession(token);

      if (!authenticated) {
        throw new AppError(401, "UNAUTHORIZED", "Sign in to continue.");
      }

      res.locals.auth = authenticated;
      next();
    } catch (error) {
      next(error);
    }
  };
}
