import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

/**
 * Prisma 7 talks to PostgreSQL through a driver adapter. Creation does not open
 * a connection; the pool connects lazily on the first query.
 */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    // Timestamps are absolute instants. Pin the session timezone so driver
    // adapters and raw SQL round-trip `timestamptz` values without shifting
    // them into the database server's local timezone.
    options: "-c timezone=UTC",
  });
  return new PrismaClient({ adapter });
}
