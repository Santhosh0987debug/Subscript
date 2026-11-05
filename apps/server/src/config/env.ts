import { z } from "zod";

const DEFAULT_DEVELOPMENT_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173",
] as const;

export type NodeEnvironment = "development" | "test" | "production";

export interface RazorpayEnv {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  testMode: boolean;
}

export interface ServerEnv {
  nodeEnv: NodeEnvironment;
  port: number;
  databaseUrl: string | null;
  corsOrigins: string[];
  sessionTtlMs: number;
  bcryptCost: number;
  cookieSecure: boolean;
  trustProxy: boolean;
  razorpay: RazorpayEnv | null;
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
  RAZORPAY_KEY_ID: z.string().trim().optional(),
  RAZORPAY_KEY_SECRET: z.string().trim().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().trim().optional(),
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
    RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET,
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

  const razorpayValues = {
    keyId: RAZORPAY_KEY_ID && RAZORPAY_KEY_ID.length > 0 ? RAZORPAY_KEY_ID : null,
    keySecret:
      RAZORPAY_KEY_SECRET && RAZORPAY_KEY_SECRET.length > 0
        ? RAZORPAY_KEY_SECRET
        : null,
    webhookSecret:
      RAZORPAY_WEBHOOK_SECRET && RAZORPAY_WEBHOOK_SECRET.length > 0
        ? RAZORPAY_WEBHOOK_SECRET
        : null,
  };
  const configuredRazorpay = Object.values(razorpayValues).filter(
    (value) => value !== null,
  ).length;
  let razorpay: RazorpayEnv | null = null;

  if (configuredRazorpay > 0 && configuredRazorpay < 3) {
    issues.push(
      "RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET must be configured together",
    );
  } else if (configuredRazorpay === 3) {
    const keyId = razorpayValues.keyId ?? "";
    const keySecret = razorpayValues.keySecret ?? "";
    const webhookSecret = razorpayValues.webhookSecret ?? "";
    const isTestKey = keyId.startsWith("rzp_test_");
    const isLiveKey = keyId.startsWith("rzp_live_");

    if (!isTestKey && !isLiveKey) {
      issues.push(
        "RAZORPAY_KEY_ID: must start with rzp_test_ or rzp_live_",
      );
    }

    if (keyId.length > 120) {
      issues.push("RAZORPAY_KEY_ID: is too long");
    }

    if (keySecret.length < 8 || keySecret.length > 200) {
      issues.push("RAZORPAY_KEY_SECRET: must be between 8 and 200 characters");
    }

    if (webhookSecret.length < 8 || webhookSecret.length > 200) {
      issues.push(
        "RAZORPAY_WEBHOOK_SECRET: must be between 8 and 200 characters",
      );
    }

    if (isLiveKey && nodeEnv !== "production") {
      issues.push(
        "RAZORPAY_KEY_ID: live keys are only allowed when NODE_ENV=production; use a rzp_test_ key for development and tests",
      );
    }

    razorpay = {
      keyId,
      keySecret,
      webhookSecret,
      testMode: isTestKey,
    };
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
    razorpay,
  };
}
