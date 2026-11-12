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

export interface SmtpEnv {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  password: string | null;
}

export interface AutomationEnv {
  queuePrefix: string;
  billingConcurrency: number;
  notificationConcurrency: number;
  sweepIntervalMs: number;
  renewalReminderWindowDays: number;
  trialReminderWindowDays: number;
  invoiceDueInDays: number;
  invoiceTaxRateBps: number;
  jobMaxAttempts: number;
  jobBackoffBaseMs: number;
  jobBackoffMaxMs: number;
  paymentRetryBaseMs: number;
  paymentRetryMaxMs: number;
  paymentRetryMaxAttempts: number;
  paymentExhaustionAction: "MARK_PAST_DUE" | "CANCEL";
  pastDueExpiryDays: number;
  workerStaleMs: number;
  notificationMaxAttempts: number;
  notificationRetryBaseMs: number;
  notificationRetryMaxMs: number;
}

export interface DatabasePoolEnv {
  poolMax: number;
  idleTimeoutMs: number;
  connectionTimeoutMs: number;
  statementTimeoutMs: number;
}

export interface HttpServerEnv {
  requestTimeoutMs: number;
  headersTimeoutMs: number;
  keepAliveTimeoutMs: number;
  shutdownTimeoutMs: number;
}

export interface ServerEnv {
  nodeEnv: NodeEnvironment;
  port: number;
  databaseUrl: string | null;
  corsOrigins: string[];
  sessionTtlMs: number;
  bcryptCost: number;
  cookieSecure: boolean;
  cookieName: string;
  trustProxy: boolean;
  razorpay: RazorpayEnv | null;
  redisUrl: string | null;
  smtp: SmtpEnv | null;
  emailFrom: string;
  database: DatabasePoolEnv;
  http: HttpServerEnv;
  apiRateLimit: { windowMs: number; limit: number };
  metricsToken: string | null;
  logRequests: boolean;
  automation: AutomationEnv;
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
  SESSION_COOKIE_NAME: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional(),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  API_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).max(3_600).default(60),
  API_RATE_LIMIT_MAX: z.coerce.number().int().min(30).max(100_000).default(600),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(5_000),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
  HTTP_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(300_000).default(60_000),
  HTTP_HEADERS_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(300_000).default(65_000),
  HTTP_KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(5_000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  METRICS_TOKEN: z.string().trim().min(16).max(200).optional(),
  LOG_REQUESTS: z.enum(["true", "false"]).default("true"),
  RAZORPAY_KEY_ID: z.string().trim().optional(),
  RAZORPAY_KEY_SECRET: z.string().trim().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().trim().optional(),
  REDIS_URL: z.string().trim().optional(),
  AUTOMATION_QUEUE_PREFIX: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,40}$/)
    .default("subscript"),
  AUTOMATION_BILLING_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  AUTOMATION_NOTIFICATION_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  AUTOMATION_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(3_600).default(60),
  AUTOMATION_RENEWAL_REMINDER_WINDOW_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  AUTOMATION_TRIAL_REMINDER_WINDOW_DAYS: z.coerce.number().int().min(1).max(30).default(3),
  AUTOMATION_INVOICE_DUE_IN_DAYS: z.coerce.number().int().min(0).max(60).default(7),
  AUTOMATION_INVOICE_TAX_RATE_BPS: z.coerce.number().int().min(0).max(5_000).default(0),
  AUTOMATION_JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  AUTOMATION_JOB_BACKOFF_BASE_SECONDS: z.coerce.number().int().min(10).max(3_600).default(60),
  AUTOMATION_JOB_BACKOFF_MAX_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3_600),
  AUTOMATION_PAYMENT_RETRY_BASE_MINUTES: z.coerce.number().int().min(1).max(10_080).default(60),
  AUTOMATION_PAYMENT_RETRY_MAX_MINUTES: z.coerce.number().int().min(1).max(43_200).default(1_440),
  AUTOMATION_PAYMENT_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
  AUTOMATION_PAYMENT_EXHAUSTION_ACTION: z
    .enum(["MARK_PAST_DUE", "CANCEL"])
    .default("MARK_PAST_DUE"),
  AUTOMATION_PAST_DUE_EXPIRY_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  AUTOMATION_WORKER_STALE_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
  NOTIFICATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  NOTIFICATION_RETRY_BASE_SECONDS: z.coerce.number().int().min(10).max(3_600).default(60),
  NOTIFICATION_RETRY_MAX_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3_600),
  EMAIL_FROM: z.string().trim().optional(),
  SMTP_HOST: z.string().trim().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
  SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  SMTP_USER: z.string().trim().optional(),
  SMTP_PASSWORD: z.string().optional(),
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

function isRedisUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "redis:" || url.protocol === "rediss:";
  } catch {
    return false;
  }
}

function isEmailSender(value: string): boolean {
  if (value.length > 320 || /[\r\n]/.test(value)) {
    return false;
  }

  const bracketed = /<([^<>]+)>$/.exec(value);
  const address = (bracketed?.[1] ?? value).trim();

  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address);
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
    SESSION_COOKIE_NAME,
    TRUST_PROXY,
    API_RATE_LIMIT_WINDOW_SECONDS,
    API_RATE_LIMIT_MAX,
    DB_POOL_MAX,
    DB_IDLE_TIMEOUT_MS,
    DB_CONNECTION_TIMEOUT_MS,
    DB_STATEMENT_TIMEOUT_MS,
    HTTP_REQUEST_TIMEOUT_MS,
    HTTP_HEADERS_TIMEOUT_MS,
    HTTP_KEEP_ALIVE_TIMEOUT_MS,
    SHUTDOWN_TIMEOUT_MS,
    METRICS_TOKEN,
    LOG_REQUESTS,
    RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET,
    REDIS_URL,
    AUTOMATION_QUEUE_PREFIX,
    AUTOMATION_BILLING_CONCURRENCY,
    AUTOMATION_NOTIFICATION_CONCURRENCY,
    AUTOMATION_SWEEP_INTERVAL_SECONDS,
    AUTOMATION_RENEWAL_REMINDER_WINDOW_DAYS,
    AUTOMATION_TRIAL_REMINDER_WINDOW_DAYS,
    AUTOMATION_INVOICE_DUE_IN_DAYS,
    AUTOMATION_INVOICE_TAX_RATE_BPS,
    AUTOMATION_JOB_MAX_ATTEMPTS,
    AUTOMATION_JOB_BACKOFF_BASE_SECONDS,
    AUTOMATION_JOB_BACKOFF_MAX_SECONDS,
    AUTOMATION_PAYMENT_RETRY_BASE_MINUTES,
    AUTOMATION_PAYMENT_RETRY_MAX_MINUTES,
    AUTOMATION_PAYMENT_RETRY_MAX_ATTEMPTS,
    AUTOMATION_PAYMENT_EXHAUSTION_ACTION,
    AUTOMATION_PAST_DUE_EXPIRY_DAYS,
    AUTOMATION_WORKER_STALE_SECONDS,
    NOTIFICATION_MAX_ATTEMPTS,
    NOTIFICATION_RETRY_BASE_SECONDS,
    NOTIFICATION_RETRY_MAX_SECONDS,
    EMAIL_FROM,
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_USER,
    SMTP_PASSWORD,
  } = parsed.data;
  const issues: string[] = [];
  const databaseUrl = DATABASE_URL && DATABASE_URL.length > 0 ? DATABASE_URL : null;
  const cookieSecure = COOKIE_SECURE ? COOKIE_SECURE === "true" : nodeEnv === "production";
  const defaultCookieName =
    nodeEnv === "production" && cookieSecure
      ? "__Host-subscript_session"
      : "subscript_session";
  const cookieName = SESSION_COOKIE_NAME ?? defaultCookieName;

  if (nodeEnv === "production" && !cookieSecure) {
    issues.push(
      "COOKIE_SECURE: must be true in production; serve the API over HTTPS",
    );
  }

  if (cookieName.startsWith("__Host-") && !cookieSecure) {
    issues.push(
      "SESSION_COOKIE_NAME: __Host- cookies require COOKIE_SECURE=true",
    );
  }

  if (cookieName.startsWith("__Secure-") && !cookieSecure) {
    issues.push(
      "SESSION_COOKIE_NAME: __Secure- cookies require COOKIE_SECURE=true",
    );
  }

  if (HTTP_HEADERS_TIMEOUT_MS <= HTTP_KEEP_ALIVE_TIMEOUT_MS) {
    issues.push(
      "HTTP_HEADERS_TIMEOUT_MS: must be greater than HTTP_KEEP_ALIVE_TIMEOUT_MS",
    );
  }

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

    if (nodeEnv === "production" && new URL(origin).protocol !== "https:") {
      issues.push(
        `CORS_ORIGINS: "${rawOrigin}" must use https in production`,
      );
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

  const redisUrl = REDIS_URL && REDIS_URL.length > 0 ? REDIS_URL : null;

  if (redisUrl && !isRedisUrl(redisUrl)) {
    issues.push("REDIS_URL: must use the redis:// or rediss:// protocol");
  }

  const emailFrom =
    EMAIL_FROM && EMAIL_FROM.length > 0
      ? EMAIL_FROM
      : "Subscript <no-reply@subscript.local>";

  if (!isEmailSender(emailFrom)) {
    issues.push("EMAIL_FROM: must be a valid sender address, optionally with a display name");
  }

  let smtp: SmtpEnv | null = null;
  const smtpUser = SMTP_USER && SMTP_USER.length > 0 ? SMTP_USER : null;
  const smtpPassword =
    SMTP_PASSWORD && SMTP_PASSWORD.length > 0 ? SMTP_PASSWORD : null;

  if (SMTP_HOST && SMTP_HOST.length > 0) {
    if ((smtpUser === null) !== (smtpPassword === null)) {
      issues.push("SMTP_USER and SMTP_PASSWORD must be configured together");
    }

    smtp = {
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE === "true",
      user: smtpUser,
      password: smtpPassword,
    };
  } else if (smtpUser || smtpPassword) {
    issues.push("SMTP_HOST: is required when SMTP credentials are configured");
  }

  if (
    AUTOMATION_JOB_BACKOFF_MAX_SECONDS <
    AUTOMATION_JOB_BACKOFF_BASE_SECONDS
  ) {
    issues.push(
      "AUTOMATION_JOB_BACKOFF_MAX_SECONDS: must be greater than or equal to AUTOMATION_JOB_BACKOFF_BASE_SECONDS",
    );
  }

  if (
    AUTOMATION_PAYMENT_RETRY_MAX_MINUTES <
    AUTOMATION_PAYMENT_RETRY_BASE_MINUTES
  ) {
    issues.push(
      "AUTOMATION_PAYMENT_RETRY_MAX_MINUTES: must be greater than or equal to AUTOMATION_PAYMENT_RETRY_BASE_MINUTES",
    );
  }

  if (NOTIFICATION_RETRY_MAX_SECONDS < NOTIFICATION_RETRY_BASE_SECONDS) {
    issues.push(
      "NOTIFICATION_RETRY_MAX_SECONDS: must be greater than or equal to NOTIFICATION_RETRY_BASE_SECONDS",
    );
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
    cookieName,
    trustProxy: TRUST_PROXY === "true",
    razorpay,
    redisUrl,
    smtp,
    emailFrom,
    database: {
      poolMax: DB_POOL_MAX,
      idleTimeoutMs: DB_IDLE_TIMEOUT_MS,
      connectionTimeoutMs: DB_CONNECTION_TIMEOUT_MS,
      statementTimeoutMs: DB_STATEMENT_TIMEOUT_MS,
    },
    http: {
      requestTimeoutMs: HTTP_REQUEST_TIMEOUT_MS,
      headersTimeoutMs: HTTP_HEADERS_TIMEOUT_MS,
      keepAliveTimeoutMs: HTTP_KEEP_ALIVE_TIMEOUT_MS,
      shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
    },
    apiRateLimit: {
      windowMs: API_RATE_LIMIT_WINDOW_SECONDS * 1_000,
      limit: API_RATE_LIMIT_MAX,
    },
    metricsToken:
      METRICS_TOKEN && METRICS_TOKEN.length > 0 ? METRICS_TOKEN : null,
    logRequests: LOG_REQUESTS === "true",
    automation: {
      queuePrefix: AUTOMATION_QUEUE_PREFIX,
      billingConcurrency: AUTOMATION_BILLING_CONCURRENCY,
      notificationConcurrency: AUTOMATION_NOTIFICATION_CONCURRENCY,
      sweepIntervalMs: AUTOMATION_SWEEP_INTERVAL_SECONDS * 1_000,
      renewalReminderWindowDays: AUTOMATION_RENEWAL_REMINDER_WINDOW_DAYS,
      trialReminderWindowDays: AUTOMATION_TRIAL_REMINDER_WINDOW_DAYS,
      invoiceDueInDays: AUTOMATION_INVOICE_DUE_IN_DAYS,
      invoiceTaxRateBps: AUTOMATION_INVOICE_TAX_RATE_BPS,
      jobMaxAttempts: AUTOMATION_JOB_MAX_ATTEMPTS,
      jobBackoffBaseMs: AUTOMATION_JOB_BACKOFF_BASE_SECONDS * 1_000,
      jobBackoffMaxMs: AUTOMATION_JOB_BACKOFF_MAX_SECONDS * 1_000,
      paymentRetryBaseMs: AUTOMATION_PAYMENT_RETRY_BASE_MINUTES * 60_000,
      paymentRetryMaxMs: AUTOMATION_PAYMENT_RETRY_MAX_MINUTES * 60_000,
      paymentRetryMaxAttempts: AUTOMATION_PAYMENT_RETRY_MAX_ATTEMPTS,
      paymentExhaustionAction: AUTOMATION_PAYMENT_EXHAUSTION_ACTION,
      pastDueExpiryDays: AUTOMATION_PAST_DUE_EXPIRY_DAYS,
      workerStaleMs: AUTOMATION_WORKER_STALE_SECONDS * 1_000,
      notificationMaxAttempts: NOTIFICATION_MAX_ATTEMPTS,
      notificationRetryBaseMs: NOTIFICATION_RETRY_BASE_SECONDS * 1_000,
      notificationRetryMaxMs: NOTIFICATION_RETRY_MAX_SECONDS * 1_000,
    },
  };
}
