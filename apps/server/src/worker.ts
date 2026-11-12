import "dotenv/config";
import { hostname } from "node:os";
import { createPrismaAutomationCandidateSource } from "./automation/candidates/prisma.js";
import { createEmailProvider } from "./automation/notifications/provider.js";
import { createNotificationService } from "./automation/notifications/service.js";
import { createAutomationQueueClient } from "./automation/queue/client.js";
import { createAutomationWorkers } from "./automation/queue/worker.js";
import { createAutomationService } from "./automation/service.js";
import { createPrismaAutomationStore } from "./automation/store/prisma.js";
import { EnvValidationError, parseEnv, type ServerEnv } from "./config/env.js";
import { createPrismaCustomerStore } from "./customers/store/prisma.js";
import { createPrismaClient } from "./db/prisma.js";
import { createPrismaInvoiceStore } from "./invoices/store/prisma.js";
import { logger } from "./lib/logger.js";
import { createPrismaSubscriptionStore } from "./subscriptions/store/prisma.js";

const HEARTBEAT_INTERVAL_MS = 20_000;
const SWEEP_SCHEDULE_RETRY_MS = 60_000;

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 500);
}

function startWorker(): void {
  let env: ServerEnv;

  try {
    env = parseEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      logger.error("Environment validation failed", { issues: error.issues });
    } else {
      logger.error("Unable to read the worker environment", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    process.exitCode = 1;
    return;
  }

  if (!env.databaseUrl) {
    logger.error("DATABASE_URL is required for the automation worker.");
    process.exitCode = 1;
    return;
  }

  if (!env.redisUrl) {
    logger.error("REDIS_URL is required for the automation worker.");
    process.exitCode = 1;
    return;
  }

  const workerId = `${hostname()}:${process.pid}`;
  const prisma = createPrismaClient(env.databaseUrl, {
    ...env.database,
    applicationName: "subscript-worker",
  });
  const automationStore = createPrismaAutomationStore(prisma);
  const candidateSource = createPrismaAutomationCandidateSource(prisma);
  const subscriptionStore = createPrismaSubscriptionStore(prisma);
  const invoiceStore = createPrismaInvoiceStore(prisma);
  const customerStore = createPrismaCustomerStore(prisma);
  const queueClient = createAutomationQueueClient({
    redisUrl: env.redisUrl,
    prefix: env.automation.queuePrefix,
    store: automationStore,
  });
  const emailProvider = createEmailProvider(env.smtp);
  const notificationService = createNotificationService({
    store: automationStore,
    provider: emailProvider,
    from: env.emailFrom,
    maxAttempts: env.automation.notificationMaxAttempts,
    retryBaseMs: env.automation.notificationRetryBaseMs,
    retryMaxMs: env.automation.notificationRetryMaxMs,
    dispatcher: queueClient.dispatcher,
  });
  const automationService = createAutomationService({
    store: automationStore,
    candidates: candidateSource,
    subscriptions: subscriptionStore,
    invoices: invoiceStore,
    customers: customerStore,
    notifications: notificationService,
    dispatcher: queueClient.dispatcher,
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
  const workers = createAutomationWorkers({
    redisUrl: env.redisUrl,
    prefix: env.automation.queuePrefix,
    billingConcurrency: env.automation.billingConcurrency,
    notificationConcurrency: env.automation.notificationConcurrency,
    workerId,
    service: automationService,
    notifications: notificationService,
  });
  let shuttingDown = false;
  let scheduleInstalled = false;
  let heartbeatTimer: NodeJS.Timeout | undefined = undefined;
  let scheduleRetryTimer: NodeJS.Timeout | undefined = undefined;

  async function writeHeartbeat(): Promise<void> {
    try {
      await queueClient.writeWorkerHeartbeat(workerId, new Date());
    } catch (error) {
      logger.warn("Worker heartbeat could not be written", {
        error: safeError(error),
      });
    }
  }

  async function installSweepSchedule(): Promise<void> {
    if (shuttingDown || scheduleInstalled) {
      return;
    }

    try {
      await queueClient.ensureSweepSchedule(env.automation.sweepIntervalMs);
      scheduleInstalled = true;
      logger.info("Automation sweep schedule installed", {
        everyMs: env.automation.sweepIntervalMs,
      });
    } catch (error) {
      logger.warn("Automation sweep schedule is not available yet", {
        error: safeError(error),
      });
    }
  }

  async function runInitialSweep(): Promise<void> {
    try {
      await automationService.runSweep();
    } catch (error) {
      logger.warn("Initial automation sweep failed", {
        error: safeError(error),
      });
    }
  }

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info("Shutting down automation worker", { signal, workerId });

    const forceExitTimer = setTimeout(() => {
      logger.error("Automation worker shutdown timed out; exiting.");
      process.exit(1);
    }, env.http.shutdownTimeoutMs);
    forceExitTimer.unref();

    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }

    if (scheduleRetryTimer) {
      clearInterval(scheduleRetryTimer);
    }

    await Promise.allSettled([
      workers.close(),
      queueClient.close(),
      prisma.$disconnect(),
    ]);

    clearTimeout(forceExitTimer);
    process.exit(0);
  }

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection in automation worker", {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
    void shutdown("unhandledRejection");
  });
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception in automation worker", {
      error: error.message,
    });
    void shutdown("uncaughtException");
  });

  logger.info("Subscript automation worker started", {
    workerId,
    environment: env.nodeEnv,
    queuePrefix: env.automation.queuePrefix,
    billingConcurrency: env.automation.billingConcurrency,
    notificationConcurrency: env.automation.notificationConcurrency,
    sweepIntervalMs: env.automation.sweepIntervalMs,
    emailProvider: emailProvider.name,
  });

  void writeHeartbeat();
  heartbeatTimer = setInterval(() => {
    void writeHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  void installSweepSchedule();
  scheduleRetryTimer = setInterval(() => {
    void installSweepSchedule();
  }, SWEEP_SCHEDULE_RETRY_MS);
  scheduleRetryTimer.unref();

  void runInitialSweep();
}

startWorker();
