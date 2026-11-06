import { describe, expect, it } from "vitest";
import { EnvValidationError, parseCorsOrigins, parseEnv } from "../src/config/env.js";

const productionDatabaseUrl =
  "postgresql://app:secret@db.example.com:5432/subscript?schema=public";

describe("parseEnv", () => {
  it("uses safe development defaults without a database", () => {
    const env = parseEnv({});

    expect(env.nodeEnv).toBe("development");
    expect(env.port).toBe(4000);
    expect(env.databaseUrl).toBeNull();
    expect(env.corsOrigins).toEqual([
      "http://localhost:5173",
      "http://localhost:4173",
    ]);
    expect(env.sessionTtlMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(env.bcryptCost).toBe(12);
    expect(env.cookieSecure).toBe(false);
    expect(env.trustProxy).toBe(false);
  });

  it("accepts auth and cookie overrides", () => {
    const env = parseEnv({
      SESSION_TTL_DAYS: "14",
      BCRYPT_COST: "11",
      COOKIE_SECURE: "true",
      TRUST_PROXY: "true",
    });

    expect(env.sessionTtlMs).toBe(14 * 24 * 60 * 60 * 1000);
    expect(env.bcryptCost).toBe(11);
    expect(env.cookieSecure).toBe(true);
    expect(env.trustProxy).toBe(true);
  });

  it("rejects out-of-range auth settings", () => {
    expect(() => parseEnv({ SESSION_TTL_DAYS: "0" })).toThrow(EnvValidationError);
    expect(() => parseEnv({ BCRYPT_COST: "4" })).toThrow(EnvValidationError);
  });

  it("coerces and validates the port", () => {
    const env = parseEnv({ PORT: "8080" });

    expect(env.port).toBe(8080);
  });

  it("rejects invalid ports with readable issues", () => {
    expect(() => parseEnv({ PORT: "70000" })).toThrow(EnvValidationError);

    try {
      parseEnv({ PORT: "70000" });
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues).toContain(
        "PORT: Too big: expected number to be <=65535",
      );
    }
  });

  it("normalizes comma-separated origins and removes duplicates", () => {
    const env = parseEnv({
      CORS_ORIGINS:
        "http://localhost:5173/, https://app.subscript.dev,http://localhost:5173",
    });

    expect(env.corsOrigins).toEqual([
      "http://localhost:5173",
      "https://app.subscript.dev",
    ]);
  });

  it("rejects wildcard and malformed origins", () => {
    expect(() => parseEnv({ CORS_ORIGINS: "*" })).toThrow(EnvValidationError);
    expect(() =>
      parseEnv({ CORS_ORIGINS: "https://app.example.com/dashboard" }),
    ).toThrow(EnvValidationError);
  });

  it("requires a PostgreSQL connection string when provided", () => {
    expect(() =>
      parseEnv({ DATABASE_URL: "mysql://localhost:3306/subscript" }),
    ).toThrow(EnvValidationError);
  });

  it("requires a database URL and CORS origins in production", () => {
    expect(() => parseEnv({ NODE_ENV: "production" })).toThrow(
      EnvValidationError,
    );
  });

  it("accepts a complete production environment", () => {
    const env = parseEnv({
      NODE_ENV: "production",
      DATABASE_URL: productionDatabaseUrl,
      CORS_ORIGINS: "https://app.subscript.dev",
    });

    expect(env.nodeEnv).toBe("production");
    expect(env.databaseUrl).toBe(productionDatabaseUrl);
    expect(env.corsOrigins).toEqual(["https://app.subscript.dev"]);
    expect(env.cookieSecure).toBe(true);
  });

  it("leaves Razorpay disabled when no credentials are present", () => {
    expect(parseEnv({}).razorpay).toBeNull();
  });

  it("requires all Razorpay values together", () => {
    expect(() =>
      parseEnv({
        RAZORPAY_KEY_ID: "rzp_test_abc123",
      }),
    ).toThrow(EnvValidationError);
    expect(() =>
      parseEnv({
        RAZORPAY_KEY_ID: "rzp_test_abc123",
        RAZORPAY_KEY_SECRET: "secret-value",
        RAZORPAY_WEBHOOK_SECRET: "",
      }),
    ).toThrow(EnvValidationError);
  });

  it("accepts test-mode Razorpay credentials in development", () => {
    const env = parseEnv({
      RAZORPAY_KEY_ID: "rzp_test_abc123",
      RAZORPAY_KEY_SECRET: "test-secret-value",
      RAZORPAY_WEBHOOK_SECRET: "webhook-secret-value",
    });

    expect(env.razorpay).toEqual({
      keyId: "rzp_test_abc123",
      keySecret: "test-secret-value",
      webhookSecret: "webhook-secret-value",
      testMode: true,
    });
  });

  it("rejects live Razorpay keys outside production", () => {
    expect(() =>
      parseEnv({
        RAZORPAY_KEY_ID: "rzp_live_abc123",
        RAZORPAY_KEY_SECRET: "live-secret-value",
        RAZORPAY_WEBHOOK_SECRET: "webhook-secret-value",
      }),
    ).toThrow(EnvValidationError);

    const production = parseEnv({
      NODE_ENV: "production",
      DATABASE_URL: productionDatabaseUrl,
      CORS_ORIGINS: "https://app.subscript.dev",
      RAZORPAY_KEY_ID: "rzp_live_abc123",
      RAZORPAY_KEY_SECRET: "live-secret-value",
      RAZORPAY_WEBHOOK_SECRET: "webhook-secret-value",
    });
    expect(production.razorpay?.testMode).toBe(false);
  });

  it("rejects malformed Razorpay keys and short secrets", () => {
    expect(() =>
      parseEnv({
        RAZORPAY_KEY_ID: "pk_test_abc123",
        RAZORPAY_KEY_SECRET: "test-secret-value",
        RAZORPAY_WEBHOOK_SECRET: "webhook-secret-value",
      }),
    ).toThrow(EnvValidationError);
    expect(() =>
      parseEnv({
        RAZORPAY_KEY_ID: "rzp_test_abc123",
        RAZORPAY_KEY_SECRET: "short",
        RAZORPAY_WEBHOOK_SECRET: "webhook-secret-value",
      }),
    ).toThrow(EnvValidationError);
    expect(() =>
      parseEnv({
        RAZORPAY_KEY_ID: "rzp_test_abc123",
        RAZORPAY_KEY_SECRET: "test-secret-value",
        RAZORPAY_WEBHOOK_SECRET: "short",
      }),
    ).toThrow(EnvValidationError);
  });
});

describe("parseCorsOrigins", () => {
  it("trims blank entries", () => {
    expect(parseCorsOrigins(" , http://a.test ,, ")).toEqual([
      "http://a.test",
    ]);
  });
});
