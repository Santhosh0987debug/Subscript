import type { CookieOptions, Response } from "express";
import { SESSION_COOKIE_NAME } from "./session-token.js";
export interface SessionCookieOptions {
  secure: boolean;
  ttlMs: number;
  name?: string;
}

function baseCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    priority: "high",
  };
}

export function setSessionCookie(
  res: Response,
  token: string,
  options: SessionCookieOptions,
): void {
  res.cookie(options.name ?? SESSION_COOKIE_NAME, token, {
    ...baseCookieOptions(options.secure),
    maxAge: options.ttlMs,
  });
}

export function clearSessionCookie(res: Response, options: SessionCookieOptions): void {
  res.clearCookie(options.name ?? SESSION_COOKIE_NAME, baseCookieOptions(options.secure));
}
