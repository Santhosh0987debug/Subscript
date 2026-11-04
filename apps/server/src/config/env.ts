import { z } from "zod";

const DEFAULT_DEVELOPMENT_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173",
] as const;

export type NodeEnvironment = "development" | "test" | "production";

export interface ServerEnv {
  nodeEnv: NodeEnvironment;
  port: number;
  databaseUrl: string | null;
  corsOrigins: string[];
  sessionTtlMs: number;
  bcryptCost: number;
  cookieSecure: boolean;
  trustProxy: boolean;
}

type EnvSource = Record<string, string | undefined>;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  DATABASE_URL: z.string().trim().optional(),
  CORS_ORIGINS: z.string().trim().optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  BCRYPT_COST: z.coerce.number().int().min(10).max(14).default(12),
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
});

export class EnvValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "postgresql:" || url.protocol === "postgres:";
  } catch {
    return false;
  }
}

function normalizeOrigin(value: string): string | null {
  if (value === "*") {
    return null;
  }

  try {
    const url = new URL(value);
    const hasUnsupportedParts =
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search.length > 0 ||
      url.hash.length > 0;

    return hasUnsupportedParts ? null : url.origin;
  } catch {
    return null;
  }
}

export function parseCorsOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Validates and normalizes process environment values.
 *
 * Throws EnvValidationError with readable issues instead of exiting the process,
 * which keeps the parser directly testable.
 */
export function parseEnv(source: EnvSource = process.env): ServerEnv {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const key = issue.path.join(".") || "environment";
      return `${key}: ${issue.message}`;
    });
    throw new EnvValidationError(issues);
  }

  const {
    NODE_ENV: nodeEnv,
    PORT: port,
    DATABASE_URL,
    CORS_ORIGINS,
    SESSION_TTL_DAYS: sessionTtlDays,
    BCRYPT_COST: bcryptCost,
    COOKIE_SECURE,
    TRUST_PROXY,
  } = parsed.data;
  const issues: string[] = [];
  const databaseUrl = DATABASE_URL && DATABASE_URL.length > 0 ? DATABASE_URL : null;
  const cookieSecure = COOKIE_SECURE ? COOKIE_SECURE === "true" : nodeEnv === "production";

  if (databaseUrl && !isPostgresUrl(databaseUrl)) {
    issues.push("DATABASE_URL: must use the postgresql:// or postgres:// protocol");
  }

  if (nodeEnv === "production" && !databaseUrl) {
    issues.push("DATABASE_URL: is required in production");
  }

  const rawOrigins = CORS_ORIGINS && CORS_ORIGINS.length > 0
    ? CORS_ORIGINS
    : nodeEnv === "production"
      ? ""
      : DEFAULT_DEVELOPMENT_ORIGINS.join(",");

  if (!rawOrigins) {
    issues.push("CORS_ORIGINS: is required in production");
  }

  const normalizedOrigins: string[] = [];

  for (const rawOrigin of parseCorsOrigins(rawOrigins)) {
    const origin = normalizeOrigin(rawOrigin);

    if (!origin) {
      issues.push(
        `CORS_ORIGINS: "${rawOrigin}" is not a valid http(s) origin (wildcards and paths are not allowed)`,
      );
      continue;
    }

    if (!normalizedOrigins.includes(origin)) {
      normalizedOrigins.push(origin);
    }
  }

  if (normalizedOrigins.length === 0 && rawOrigins) {
    issues.push("CORS_ORIGINS: must contain at least one allowed origin");
  }

  if (issues.length > 0) {
    throw new EnvValidationError(issues);
  }

  return {
    nodeEnv,
    port,
    databaseUrl,
    corsOrigins: normalizedOrigins,
    sessionTtlMs: sessionTtlDays * 24 * 60 * 60 * 1000,
    bcryptCost,
    cookieSecure,
    trustProxy: TRUST_PROXY === "true",
  };
}
