import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { createMemoryAutomationCandidateSource } from "./automation/candidates/memory.js";
import { createPrismaAutomationCandidateSource } from "./automation/candidates/prisma.js";
import { createEmailProvider } from "./automation/notifications/provider.js";
import { createNotificationService } from "./automation/notifications/service.js";
import {
  createAutomationQueueClient,
  createDisabledAutomationHealth,
} from "./automation/queue/client.js";
import { createAutomationService } from "./automation/service.js";
import { createMemoryAutomationStore } from "./automation/store/memory.js";
import { createPrismaAutomationStore } from "./automation/store/prisma.js";
import { createAuthService } from "./auth/service.js";
import { createMemoryAuthStore } from "./auth/store/memory.js";
import { createPrismaAuthStore } from "./auth/store/prisma.js";
import { EnvValidationError, parseEnv } from "./config/env.js";
import { createMemoryCustomerStore } from "./customers/store/memory.js";
import { createPrismaCustomerStore } from "./customers/store/prisma.js";
import { createPrismaClient } from "./db/prisma.js";
import { createRazorpayGateway } from "./gateway/razorpay.js";
import { createMemoryGatewayWebhookStore } from "./gateway/store/memory.js";
import { createPrismaGatewayWebhookStore } from "./gateway/store/prisma.js";
import { createMemoryInvoiceStore } from "./invoices/store/memory.js";
import { createPrismaInvoiceStore } from "./invoices/store/prisma.js";
import { logger } from "./lib/logger.js";
import { createMemoryPlanStore } from "./plans/store/memory.js";
import { createPrismaPlanStore } from "./plans/store/prisma.js";
import { createMemorySubscriptionStore } from "./subscriptions/store/memory.js";
import { createPrismaSubscriptionStore } from "./subscriptions/store/prisma.js";

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

  if (!prisma && env.nodeEnv === "production") {
    logger.error("DATABASE_URL is required in production.");
    process.exitCode = 1;
    return;
  }

  const authStore = prisma ? createPrismaAuthStore(prisma) : createMemoryAuthStore();
  const customerStore = prisma
    ? createPrismaCustomerStore(prisma)
    : createMemoryCustomerStore();
  const planStore = prisma
    ? createPrismaPlanStore(prisma)
    : createMemoryPlanStore();
  const subscriptionStore = prisma
    ? createPrismaSubscriptionStore(prisma)
    : createMemorySubscriptionStore();
  const invoiceStore = prisma
    ? createPrismaInvoiceStore(prisma)
    : createMemoryInvoiceStore();
  const gatewayWebhookStore = prisma
    ? createPrismaGatewayWebhookStore(prisma)
    : createMemoryGatewayWebhookStore();
  const gateway = env.razorpay
    ? createRazorpayGateway({
        keyId: env.razorpay.keyId,
        keySecret: env.razorpay.keySecret,
        webhookSecret: env.razorpay.webhookSecret,
      })
    : null;

  if (!prisma) {
    logger.warn(
      "DATABASE_URL is not set; using in-memory stores for local development. Data resets on restart.",
    );
  }

  const authService = createAuthService({
    store: authStore,
    passwordCost: env.bcryptCost,
    sessionTtlMs: env.sessionTtlMs,
  });

  const automationStore = prisma
    ? createPrismaAutomationStore(prisma)
    : createMemoryAutomationStore();
  const automationCandidates = prisma
    ? createPrismaAutomationCandidateSource(prisma)
    : createMemoryAutomationCandidateSource();
  const queueClient =
    prisma && env.redisUrl
      ? createAutomationQueueClient({
          redisUrl: env.redisUrl,
          prefix: env.automation.queuePrefix,
          store: automationStore,
        })
      : null;
  const emailProvider = createEmailProvider(env.smtp);
  const notificationService = createNotificationService({
    store: automationStore,
    provider: emailProvider,
    from: env.emailFrom,
    maxAttempts: env.automation.notificationMaxAttempts,
    retryBaseMs: env.automation.notificationRetryBaseMs,
    retryMaxMs: env.automation.notificationRetryMaxMs,
    dispatcher: queueClient?.dispatcher ?? null,
  });
  const automationService = createAutomationService({
    store: automationStore,
    candidates: automationCandidates,
    subscriptions: subscriptionStore,
    invoices: invoiceStore,
    customers: customerStore,
    notifications: notificationService,
    dispatcher: queueClient?.dispatcher ?? null,
    config: {
      renewalReminderWindowDays: env.automation.renewalReminderWindowDays,
      trialReminderWindowDays: env.automation.trialReminderWindowDays,
      invoiceDueInDays: env.automation.invoiceDueInDays,
      invoiceTaxRateBps: env.automation.invoiceTaxRateBps,
      jobMaxAttempts: env.automation.jobMaxAttempts,
      jobBackoffBaseMs: env.automation.jobBackoffBaseMs,
      jobBackoffMaxMs: env.automation.jobBackoffMaxMs,
      paymentRetryBaseMs: env.automation.paymentRetryBaseMs,
      paymentRetryMaxMs: env.automation.paymentRetryMaxMs,
      paymentRetryMaxAttempts: env.automation.paymentRetryMaxAttempts,
      paymentExhaustionAction: env.automation.paymentExhaustionAction,
      pastDueExpiryDays: env.automation.pastDueExpiryDays,
      workerStaleMs: env.automation.workerStaleMs,
    },
  });
  const automationHealth = async () => {
    if (queueClient) {
      return queueClient.readHealth();
    }

    return env.redisUrl
      ? createDisabledAutomationHealth(
          "Automation workers require DATABASE_URL and REDIS_URL.",
          true,
        )
      : createDisabledAutomationHealth();
  };

  if (env.redisUrl && !prisma) {
    logger.warn(
      "REDIS_URL is set but DATABASE_URL is not; background automation is disabled until PostgreSQL is configured.",
    );
  }

  const app = createApp({
    authService,
    customerStore,
    planStore,
    subscriptionStore,
    invoiceStore,
    gateway,
    gatewayWebhookStore,
    automation: {
      store: automationStore,
      service: automationService,
      notificationService,
      subscriptionStore,
      health: automationHealth,
      renewalWindowDays: env.automation.renewalReminderWindowDays,
    },
    corsOrigins: env.corsOrigins,
    cookieSecure: env.cookieSecure,
    sessionTtlMs: env.sessionTtlMs,
    trustProxy: env.trustProxy,
  });
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
        if (queueClient) {
          try {
            await queueClient.close();
          } catch (queueError) {
            logger.error("Failed to close the automation queue client", {
              error:
                queueError instanceof Error
                  ? queueError.message
                  : String(queueError),
            });
          }
        }

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
      authStore: prisma ? "postgresql" : "memory",
      automation: {
        enabled: queueClient !== null,
        queuePrefix: env.automation.queuePrefix,
        emailProvider: emailProvider.name,
      },
      gateway: gateway
        ? { enabled: true, testMode: gateway.testMode }
        : { enabled: false },
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
