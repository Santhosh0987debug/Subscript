import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE_NAME = "subscript_session";
export const MAX_SESSION_TOKEN_LENGTH = 512;

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Produces a readable, collision-resistant slug. Organization names are not
 * unique, so a short random suffix keeps the public identifier stable.
 */
export function createOrganizationSlug(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `${base || "workspace"}-${randomBytes(3).toString("hex")}`;
}
