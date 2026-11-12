import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { logger } from "../lib/logger.js";

export interface PrismaClientOptions {
  poolMax?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  applicationName?: string;
}

/**
 * Prisma 7 talks to PostgreSQL through a driver adapter. Creation does not open
 * a connection; the bounded pool connects lazily on the first query.
 */
export function createPrismaClient(
  databaseUrl: string,
  options: PrismaClientOptions = {},
): PrismaClient {
  const statementTimeoutMs = options.statementTimeoutMs ?? 15_000;
  const adapter = new PrismaPg(
    {
      connectionString: databaseUrl,
      max: options.poolMax ?? 10,
      idleTimeoutMillis: options.idleTimeoutMs ?? 30_000,
      connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
      keepAlive: true,
      application_name: options.applicationName ?? "subscript",
      // Timestamps are absolute instants. Pin the session timezone so driver
      // adapters and raw SQL round-trip `timestamptz` values without shifting
      // them into the database server's local timezone. A statement timeout
      // prevents a wedged query from exhausting the pool.
      options: `-c timezone=UTC -c statement_timeout=${statementTimeoutMs}`,
    },
    {
      onPoolError: (error) => {
        logger.warn("PostgreSQL pool error", { error: error.message });
      },
      onConnectionError: (error) => {
        logger.warn("PostgreSQL connection error", { error: error.message });
      },
    },
  );

  return new PrismaClient({ adapter });
}
