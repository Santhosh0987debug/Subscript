import { Worker } from "bullmq";
import { logger } from "../../lib/logger.js";
import type { NotificationService } from "../notifications/service.js";
import type { AutomationService } from "../service.js";
import {
  AUTOMATION_JOB_NAME,
  BILLING_QUEUE_NAME,
  createRedisConnection,
  NOTIFICATION_JOB_NAME,
  NOTIFICATION_QUEUE_NAME,
  SYSTEM_SWEEP_JOB_NAME,
  type BillingJobData,
  type NotificationJobData,
} from "./client.js";

export interface AutomationWorkersOptions {
  redisUrl: string;
  prefix: string;
  billingConcurrency: number;
  notificationConcurrency: number;
  workerId: string;
  service: AutomationService;
  notifications: NotificationService;
}

export interface AutomationWorkers {
  billing: Worker<BillingJobData>;
  notifications: Worker<NotificationJobData>;
  close(): Promise<void>;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 500);
}

export function createAutomationWorkers(
  options: AutomationWorkersOptions,
): AutomationWorkers {
  const billingConnection = createRedisConnection({
    redisUrl: options.redisUrl,
    worker: true,
  });
  const notificationConnection = createRedisConnection({
    redisUrl: options.redisUrl,
    worker: true,
  });

  const billing = new Worker<BillingJobData>(
    BILLING_QUEUE_NAME,
    async (job) => {
      if (job.name === SYSTEM_SWEEP_JOB_NAME) {
        return options.service.runSweep();
      }

      if (job.name !== AUTOMATION_JOB_NAME) {
        throw new Error(`Unknown billing job type: ${job.name}`);
      }

      const jobId = job.data.jobId;

      if (!jobId) {
        throw new Error("Billing job delivery did not include a job ID.");
      }

      return options.service.processJob(jobId, options.workerId);
    },
    {
      connection: billingConnection,
      prefix: options.prefix,
      concurrency: options.billingConcurrency,
      lockDuration: 60_000,
      stalledInterval: 30_000,
      maxStalledCount: 2,
    },
  );

  const notifications = new Worker<NotificationJobData>(
    NOTIFICATION_QUEUE_NAME,
    async (job) => {
      if (job.name !== NOTIFICATION_JOB_NAME) {
        throw new Error(`Unknown notification job type: ${job.name}`);
      }

      const notificationId = job.data.notificationId;

      if (!notificationId) {
        throw new Error(
          "Notification delivery did not include a notification ID.",
        );
      }

      return options.notifications.deliver(notificationId);
    },
    {
      connection: notificationConnection,
      prefix: options.prefix,
      concurrency: options.notificationConcurrency,
      lockDuration: 60_000,
      stalledInterval: 30_000,
      maxStalledCount: 2,
    },
  );

  for (const worker of [billing, notifications]) {
    worker.on("completed", (job) => {
      logger.info("Queue job completed", {
        queue: worker.name,
        jobId: job.id,
        jobName: job.name,
        workerId: options.workerId,
      });
    });
    worker.on("failed", (job, error) => {
      logger.warn("Queue job failed", {
        queue: worker.name,
        jobId: job?.id ?? null,
        jobName: job?.name ?? null,
        workerId: options.workerId,
        error: safeError(error),
      });
    });
    worker.on("stalled", (jobId) => {
      logger.warn("Queue job stalled", {
        queue: worker.name,
        jobId,
        workerId: options.workerId,
      });
    });
    worker.on("error", (error) => {
      logger.warn("Queue worker error", {
        queue: worker.name,
        workerId: options.workerId,
        error: safeError(error),
      });
    });
  }

  return {
    billing,
    notifications,
    async close() {
      await Promise.allSettled([billing.close(), notifications.close()]);

      for (const connection of [billingConnection, notificationConnection]) {
        try {
          await connection.quit();
        } catch {
          connection.disconnect();
        }
      }
    },
  };
}
