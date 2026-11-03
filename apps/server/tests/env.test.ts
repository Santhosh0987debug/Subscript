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
  });
});

describe("parseCorsOrigins", () => {
  it("trims blank entries", () => {
    expect(parseCorsOrigins(" , http://a.test ,, ")).toEqual([
      "http://a.test",
    ]);
  });
});
