import { randomUUID } from "node:crypto";
import type {
  AutomationHealth,
  AutomationQueueCounts,
  AutomationQueueName,
  AutomationWorkerStatus,
} from "@subscript/shared";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { logger } from "../../lib/logger.js";
import type {
  AutomationJobDispatcher,
  AutomationStore,
  NotificationRecord,
} from "../types.js";
import type { NotificationDispatcher } from "../notifications/types.js";
import type { AutomationJobRecord } from "../types.js";

export const BILLING_QUEUE_NAME = "billing";
export const NOTIFICATION_QUEUE_NAME = "notifications";
export const SYSTEM_SWEEP_JOB_NAME = "system-sweep";
export const AUTOMATION_JOB_NAME = "automation-job";
export const NOTIFICATION_JOB_NAME = "notification-delivery";

const HEARTBEAT_KEY_SUFFIX = "automation:worker:heartbeat";
const HEARTBEAT_TTL_SECONDS = 90;
const HEALTH_TIMEOUT_MS = 1_500;

export interface BillingJobData {
  jobId?: string;
}

export interface NotificationJobData {
  notificationId?: string;
}

export interface WorkerHeartbeat {
  workerId: string;
  seenAt: string;
  queues: AutomationQueueName[];
}

export interface RedisConnectionOptions {
  redisUrl: string;
  worker?: boolean;
}

export interface AutomationQueueClientOptions {
  redisUrl: string;
  prefix: string;
  store: AutomationStore;
}

export interface AutomationQueueClient {
  billing: Queue<BillingJobData>;
  notifications: Queue<NotificationJobData>;
  dispatcher: AutomationJobDispatcher & NotificationDispatcher;
  ensureSweepSchedule(everyMs: number): Promise<void>;
  writeWorkerHeartbeat(workerId: string, seenAt: Date): Promise<void>;
  readHealth(): Promise<AutomationHealth>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

function createRedisConnection(
  options: RedisConnectionOptions,
): Redis {
  const connection = new Redis(options.redisUrl, {
    maxRetriesPerRequest: options.worker ? null : 1,
    enableReadyCheck: false,
    lazyConnect: !options.worker,
    connectTimeout: 5_000,
    retryStrategy(times) {
      return Math.min(times * 250, 3_000);
    },
  });

  connection.on("error", (error) => {
    logger.warn("Redis connection error", {
      worker: options.worker === true,
      error: error.message,
    });
  });

  return connection;
}

export { createRedisConnection };

function emptyQueueCounts(): AutomationQueueCounts {
  return {
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
    paused: 0,
  };
}

function safeQueueError(): string {
  return "Redis connection is unavailable.";
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Queue health check timed out.")),
          timeoutMs,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function parseHeartbeat(raw: string | null): WorkerHeartbeat | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<WorkerHeartbeat>;

    if (
      typeof parsed.workerId === "string" &&
      typeof parsed.seenAt === "string"
    ) {
      return {
        workerId: parsed.workerId,
        seenAt: parsed.seenAt,
        queues: Array.isArray(parsed.queues)
          ? (parsed.queues as AutomationQueueName[])
          : [],
      };
    }
  } catch {
    return null;
  }

  return null;
}

function workerStatusFor(
  connected: boolean,
  workerCount: number,
  heartbeat: WorkerHeartbeat | null,
  now: Date,
): AutomationWorkerStatus {
  if (!connected) {
    return "unknown";
  }

  const seenAt = heartbeat ? new Date(heartbeat.seenAt) : null;
  const age = seenAt ? now.getTime() - seenAt.getTime() : Number.POSITIVE_INFINITY;

  if (age <= HEARTBEAT_TTL_SECONDS * 1_000) {
    return "online";
  }

  if (workerCount > 0) {
    return "online";
  }

  if (age <= 5 * 60 * 1_000) {
    return "degraded";
  }

  return "offline";
}

export function createAutomationQueueClient(
  options: AutomationQueueClientOptions,
): AutomationQueueClient {
  const prefix = options.prefix;
  const queueConnection = createRedisConnection({ redisUrl: options.redisUrl });
  const heartbeatConnection = createRedisConnection({
    redisUrl: options.redisUrl,
  });
  const billing = new Queue<BillingJobData>(BILLING_QUEUE_NAME, {
    connection: queueConnection,
    prefix,
    defaultJobOptions: {
      removeOnComplete: { count: 1_000 },
      removeOnFail: { count: 1_000 },
    },
  });
  const notifications = new Queue<NotificationJobData>(
    NOTIFICATION_QUEUE_NAME,
    {
      connection: queueConnection,
      prefix,
      defaultJobOptions: {
        removeOnComplete: { count: 1_000 },
        removeOnFail: { count: 1_000 },
      },
    },
  );
  const heartbeatKey = `${prefix}:${HEARTBEAT_KEY_SUFFIX}`;

  const dispatcher: AutomationJobDispatcher & NotificationDispatcher = {
    async dispatchJob(job: AutomationJobRecord): Promise<boolean> {
      if (job.status !== "PENDING" && job.status !== "FAILED") {
        return false;
      }

      const queuedAt = new Date();

      await billing.add(
        AUTOMATION_JOB_NAME,
        { jobId: job.id },
        {
          jobId: `${job.id}:${job.dispatchGeneration}:${queuedAt.getTime()}:${randomUUID().slice(0, 8)}`,
          attempts: 1,
          removeOnComplete: { count: 1_000 },
          removeOnFail: { count: 1_000 },
        },
      );
      await options.store.markJobQueued(
        job.id,
        job.dispatchGeneration,
        queuedAt,
      );

      return true;
    },

    async dispatchNotification(
      notification: NotificationRecord,
    ): Promise<boolean> {
      if (
        notification.status !== "PENDING" &&
        notification.status !== "FAILED"
      ) {
        return false;
      }

      const queuedAt = new Date();

      await notifications.add(
        NOTIFICATION_JOB_NAME,
        { notificationId: notification.id },
        {
          jobId: `${notification.id}:${queuedAt.getTime()}:${randomUUID().slice(0, 8)}`,
          attempts: 1,
          removeOnComplete: { count: 1_000 },
          removeOnFail: { count: 1_000 },
        },
      );
      await options.store.markNotificationQueued(notification.id, queuedAt);

      return true;
    },
  };

  async function readQueueHealth(
    name: AutomationQueueName,
    displayName: string,
    queue: Queue,
  ): Promise<{
    health: {
      name: AutomationQueueName;
      displayName: string;
      enabled: boolean;
      connected: boolean;
      workers: number;
      counts: AutomationQueueCounts;
      error: string | null;
    };
    connected: boolean;
    workers: number;
  }> {
    try {
      const [counts, workers] = await withTimeout(
        Promise.all([
          queue.getJobCounts(
            "waiting",
            "active",
            "completed",
            "failed",
            "delayed",
          ),
          queue.getWorkersCount(),
        ]),
        HEALTH_TIMEOUT_MS,
      );
      const normalized = emptyQueueCounts();

      for (const key of Object.keys(normalized) as Array<
        keyof AutomationQueueCounts
      >) {
        normalized[key] = Number(counts[key] ?? 0);
      }

      return {
        health: {
          name,
          displayName,
          enabled: true,
          connected: true,
          workers,
          counts: normalized,
          error: null,
        },
        connected: true,
        workers,
      };
    } catch {
      return {
        health: {
          name,
          displayName,
          enabled: true,
          connected: false,
          workers: 0,
          counts: emptyQueueCounts(),
          error: safeQueueError(),
        },
        connected: false,
        workers: 0,
      };
    }
  }

  return {
    billing,
    notifications,
    dispatcher,

    async ensureSweepSchedule(everyMs) {
      await billing.upsertJobScheduler(
        "automation-sweep",
        { every: everyMs },
        {
          name: SYSTEM_SWEEP_JOB_NAME,
          data: {},
          opts: {
            removeOnComplete: { count: 20 },
            removeOnFail: { count: 20 },
          },
        },
      );
    },

    async writeWorkerHeartbeat(workerId, seenAt) {
      const heartbeat: WorkerHeartbeat = {
        workerId,
        seenAt: seenAt.toISOString(),
        queues: ["BILLING", "NOTIFICATIONS"],
      };

      await heartbeatConnection.set(
        heartbeatKey,
        JSON.stringify(heartbeat),
        "EX",
        HEARTBEAT_TTL_SECONDS,
      );
    },

    async readHealth() {
      const now = new Date();
      const [billingHealth, notificationHealth] = await Promise.all([
        readQueueHealth("BILLING", "Billing jobs", billing),
        readQueueHealth(
          "NOTIFICATIONS",
          "Notification delivery",
          notifications,
        ),
      ]);
      const connected =
        billingHealth.connected || notificationHealth.connected;
      const workers =
        billingHealth.workers + notificationHealth.workers;
      let heartbeat: WorkerHeartbeat | null = null;

      if (connected) {
        try {
          heartbeat = parseHeartbeat(
            await withTimeout(
              heartbeatConnection.get(heartbeatKey),
              HEALTH_TIMEOUT_MS,
            ),
          );
        } catch {
          heartbeat = null;
        }
      }

      return {
        enabled: true,
        redisConfigured: true,
        workerStatus: workerStatusFor(connected, workers, heartbeat, now),
        lastWorkerSeenAt: heartbeat?.seenAt ?? null,
        queues: [billingHealth.health, notificationHealth.health],
        generatedAt: now.toISOString(),
      };
    },

    async ping() {
      const response = await withTimeout(
        heartbeatConnection.ping(),
        HEALTH_TIMEOUT_MS,
      );

      if (response !== "PONG") {
        throw new Error("Redis did not acknowledge the ping.");
      }
    },

    async close() {
      await Promise.allSettled([billing.close(), notifications.close()]);

      for (const connection of [queueConnection, heartbeatConnection]) {
        try {
          await connection.quit();
        } catch {
          connection.disconnect();
        }
      }
    },
  };
}

export function createDisabledAutomationHealth(
  reason = "REDIS_URL is not configured.",
  redisConfigured = false,
): AutomationHealth {
  return {
    enabled: false,
    redisConfigured,
    workerStatus: "unknown",
    lastWorkerSeenAt: null,
    queues: [
      {
        name: "BILLING",
        displayName: "Billing jobs",
        enabled: false,
        connected: false,
        workers: 0,
        counts: emptyQueueCounts(),
        error: reason,
      },
      {
        name: "NOTIFICATIONS",
        displayName: "Notification delivery",
        enabled: false,
        connected: false,
        workers: 0,
        counts: emptyQueueCounts(),
        error: reason,
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}
