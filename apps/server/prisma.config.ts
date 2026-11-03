import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * A local placeholder is used only for schema-only commands (validate/generate)
 * when no environment is configured. Runtime env validation still requires a
 * real DATABASE_URL in production.
 */
const schemaOnlyDatabaseUrl =
  "postgresql://localhost:5432/subscript?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? schemaOnlyDatabaseUrl,
  },
});
