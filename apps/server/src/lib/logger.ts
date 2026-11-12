type LogLevel = "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

const SENSITIVE_KEY =
  /(password|passwd|secret|token|authorization|cookie|session|api[-_]?key|private[-_]?key|card|cvv|cvc|iban|account[-_]?number)/i;

const EMAIL_PATTERN = /\b[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const RAZORPAY_KEY_PATTERN = /\brzp_(?:test|live)_[A-Za-z0-9]+/g;
const LONG_TOKEN_PATTERN = /\b[A-Za-z0-9_-]{48,}\b/g;

export function redactLogText(value: string): string {
  return value
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(RAZORPAY_KEY_PATTERN, "[redacted-razorpay-key]")
    .replace(LONG_TOKEN_PATTERN, "[redacted-token]");
}

function sanitize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 5) {
    return "[truncated]";
  }

  if (typeof value === "string") {
    return redactLogText(value).slice(0, 4_000);
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactLogText(value.message),
      ...(process.env.NODE_ENV === "production"
        ? {}
        : { stack: value.stack ? redactLogText(value.stack) : undefined }),
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitize(item, depth + 1, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[circular]";
    }

    seen.add(value);
    const clean: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      clean[key] = SENSITIVE_KEY.test(key)
        ? "[redacted]"
        : sanitize(entry, depth + 1, seen);
    }

    return clean;
  }

  return redactLogText(String(value));
}

export function safeErrorContext(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactLogText(error.message),
      ...(process.env.NODE_ENV === "production"
        ? {}
        : { stack: error.stack ? redactLogText(error.stack) : undefined }),
    };
  }

  return { value: redactLogText(String(error)) };
}

function write(level: LogLevel, message: string, context: LogContext = {}): void {
  const entry = {
    level,
    message: redactLogText(message),
    timestamp: new Date().toISOString(),
    ...(sanitize(context) as LogContext),
  };
  const line = JSON.stringify(entry);

  if (level === "error") {
    console.error(line);
    return;
  }

  console.log(line);
}

export const logger = {
  info(message: string, context?: LogContext): void {
    write("info", message, context);
  },
  warn(message: string, context?: LogContext): void {
    write("warn", message, context);
  },
  error(message: string, context?: LogContext): void {
    write("error", message, context);
  },
};
