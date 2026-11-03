import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { EnvValidationError, parseEnv } from "./config/env.js";
import { createPrismaClient } from "./db/prisma.js";
import { logger } from "./lib/logger.js";

function startServer(): void {
  let env;

  try {
    env = parseEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      logger.error("Environment validation failed", { issues: error.issues });
    } else {
      logger.error("Unable to read the server environment", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    process.exitCode = 1;
    return;
  }

  const prisma = env.databaseUrl ? createPrismaClient(env.databaseUrl) : null;

  if (!prisma) {
    logger.warn("DATABASE_URL is not set; database-backed features are disabled.");
  }

  const app = createApp({ corsOrigins: env.corsOrigins });
  const server = createServer(app);
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info("Shutting down", { signal });

    const forceExitTimer = setTimeout(() => {
      logger.error("Graceful shutdown timed out; exiting.");
      process.exit(1);
    }, 10_000);
    forceExitTimer.unref();

    server.close((serverError) => {
      clearTimeout(forceExitTimer);

      const finish = async (): Promise<void> => {
        if (prisma) {
          try {
            await prisma.$disconnect();
          } catch (disconnectError) {
            logger.error("Failed to disconnect the database client", {
              error:
                disconnectError instanceof Error
                  ? disconnectError.message
                  : String(disconnectError),
            });
          }
        }

        if (serverError) {
          logger.error("HTTP server closed with an error", {
            error: serverError.message,
          });
          process.exit(1);
        }

        process.exit(0);
      };

      void finish();
    });
  };

  server.on("error", (error) => {
    logger.error("HTTP server error", { error: error.message });
    process.exitCode = 1;
  });

  server.listen(env.port, () => {
    logger.info("Subscript API listening", {
      port: env.port,
      environment: env.nodeEnv,
      databaseConfigured: prisma !== null,
      corsOrigins: env.corsOrigins,
    });
  });

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
    shutdown("unhandledRejection");
  });
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception", { error: error.message });
    shutdown("uncaughtException");
  });
}

startServer();
