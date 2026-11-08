import type {
  AutomationJob as AutomationJobModel,
  Notification as NotificationModel,
  Prisma,
  PrismaClient,
} from "../../generated/prisma/client.js";
import type {
  AutomationJobCounts,
  AutomationNotificationCounts,
} from "@subscript/shared";
import type {
  AutomationJobListOptions,
  AutomationJobListResult,
  AutomationJobRecord,
  AutomationStore,
  CreateAutomationJobInput,
  CreateNotificationInput,
  NotificationDeliveryFailure,
  NotificationListOptions,
  NotificationListResult,
  NotificationRecord,
} from "../types.js";

interface PrismaErrorDetails {
  code?: unknown;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as PrismaErrorDetails).code === "P2002"
  );
}

function mapJob(job: AutomationJobModel): AutomationJobRecord {
  return {
    id: job.id,
    organizationId: job.organizationId,
    type: job.type,
    queue: job.queue,
    status: job.status,
    idempotencyKey: job.idempotencyKey,
    targetType: job.targetType,
    targetId: job.targetId,
    runAt: job.runAt,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    dispatchGeneration: job.dispatchGeneration,
    lockedAt: job.lockedAt,
    lockedBy: job.lockedBy,
    lastError: job.lastError,
    resultSummary: job.resultSummary,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function mapNotification(notification: NotificationModel): NotificationRecord {
  return {
    id: notification.id,
    organizationId: notification.organizationId,
    customerId: notification.customerId,
    subscriptionId: notification.subscriptionId,
    invoiceId: notification.invoiceId,
    type: notification.type,
    status: notification.status,
    dedupeKey: notification.dedupeKey,
    recipientEmail: notification.recipientEmail,
    subject: notification.subject,
    bodyText: notification.bodyText,
    bodyHtml: notification.bodyHtml,
    attempts: notification.attempts,
    maxAttempts: notification.maxAttempts,
    nextAttemptAt: notification.nextAttemptAt,
    queuedAt: notification.queuedAt,
    lastError: notification.lastError,
    providerName: notification.providerName,
    providerMessageId: notification.providerMessageId,
    sentAt: notification.sentAt,
    createdAt: notification.createdAt,
    updatedAt: notification.updatedAt,
  };
}

function emptyJobCounts(): AutomationJobCounts {
  return {
    pending: 0,
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    deadLetter: 0,
    canceled: 0,
  };
}

function emptyNotificationCounts(): AutomationNotificationCounts {
  return {
    pending: 0,
    queued: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    deadLetter: 0,
    skipped: 0,
  };
}

function jobWhere(
  organizationId: string,
  options: AutomationJobListOptions,
): Prisma.AutomationJobWhereInput {
  return {
    organizationId,
    ...(options.status === "ALL" ? {} : { status: options.status }),
    ...(options.type === "ALL" ? {} : { type: options.type }),
  };
}

function notificationWhere(
  organizationId: string,
  options: NotificationListOptions,
): Prisma.NotificationWhereInput {
  return {
    organizationId,
    ...(options.status === "ALL" ? {} : { status: options.status }),
    ...(options.type === "ALL" ? {} : { type: options.type }),
  };
}

export function createPrismaAutomationStore(
  prisma: PrismaClient,
): AutomationStore {
  return {
    async createJob(input: CreateAutomationJobInput) {
      try {
        const job = await prisma.automationJob.create({
          data: {
            organizationId: input.organizationId,
            type: input.type,
            queue: input.queue,
            idempotencyKey: input.idempotencyKey,
            targetType: input.targetType,
            targetId: input.targetId,
            runAt: input.runAt,
            maxAttempts: input.maxAttempts,
          },
        });

        return { job: mapJob(job), created: true };
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }

        const existing = await prisma.automationJob.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });

        if (!existing) {
          throw error;
        }

        return { job: mapJob(existing), created: false };
      }
    },

    async findJobById(jobId) {
      const job = await prisma.automationJob.findUnique({ where: { id: jobId } });
      return job ? mapJob(job) : null;
    },

    async findJob(organizationId, jobId) {
      const job = await prisma.automationJob.findFirst({
        where: { id: jobId, organizationId },
      });
      return job ? mapJob(job) : null;
    },

    async listJobs(
      organizationId: string,
      options: AutomationJobListOptions,
    ): Promise<AutomationJobListResult> {
      const where = jobWhere(organizationId, options);
      const [items, total] = await prisma.$transaction([
        prisma.automationJob.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip: (options.page - 1) * options.pageSize,
          take: options.pageSize,
        }),
        prisma.automationJob.count({ where }),
      ]);

      return { items: items.map(mapJob), total };
    },

    async countJobs(organizationId) {
      const groups = await prisma.automationJob.groupBy({
        by: ["status"],
        where: { organizationId },
        _count: { _all: true },
      });
      const counts = emptyJobCounts();

      for (const group of groups) {
        switch (group.status) {
          case "PENDING":
            counts.pending = group._count._all;
            break;
          case "QUEUED":
            counts.queued = group._count._all;
            break;
          case "RUNNING":
            counts.running = group._count._all;
            break;
          case "SUCCEEDED":
            counts.succeeded = group._count._all;
            break;
          case "FAILED":
            counts.failed = group._count._all;
            break;
          case "DEAD_LETTER":
            counts.deadLetter = group._count._all;
            break;
          case "CANCELED":
            counts.canceled = group._count._all;
            break;
        }
      }

      return counts;
    },

    async findLatestJob(organizationId, type, targetId) {
      const job = await prisma.automationJob.findFirst({
        where: { organizationId, type, targetId },
        orderBy: [{ createdAt: "desc" }],
      });

      return job ? mapJob(job) : null;
    },

    async listDispatchableJobs(organizationId, now, limit) {
      const jobs = await prisma.automationJob.findMany({
        where: {
          organizationId,
          status: { in: ["PENDING", "FAILED"] },
          runAt: { lte: now },
        },
        orderBy: [{ runAt: "asc" }, { createdAt: "asc" }],
        take: limit,
      });

      return jobs.map(mapJob);
    },

    async markJobQueued(jobId, dispatchGeneration, queuedAt) {
      await prisma.automationJob.updateMany({
        where: {
          id: jobId,
          dispatchGeneration,
          status: { in: ["PENDING", "FAILED"] },
        },
        data: { status: "QUEUED", updatedAt: queuedAt },
      });
    },

    async claimJob(jobId, workerId, now) {
      const updated = await prisma.automationJob.updateMany({
        where: {
          id: jobId,
          status: { in: ["PENDING", "QUEUED", "FAILED"] },
          runAt: { lte: now },
        },
        data: {
          status: "RUNNING",
          attempts: { increment: 1 },
          lockedAt: now,
          lockedBy: workerId,
          startedAt: now,
          updatedAt: now,
        },
      });

      if (updated.count === 0) {
        return null;
      }

      const job = await prisma.automationJob.findUnique({ where: { id: jobId } });
      return job ? mapJob(job) : null;
    },

    async completeJob(jobId, summary, finishedAt) {
      await prisma.automationJob.updateMany({
        where: { id: jobId, status: "RUNNING" },
        data: {
          status: "SUCCEEDED",
          resultSummary: summary,
          lastError: null,
          finishedAt,
          lockedAt: null,
          lockedBy: null,
          updatedAt: finishedAt,
        },
      });
    },

    async failJob(jobId, failure, finishedAt) {
      await prisma.automationJob.updateMany({
        where: { id: jobId, status: "RUNNING" },
        data: failure.retryAt
          ? {
              status: "FAILED",
              lastError: failure.lastError,
              runAt: failure.retryAt,
              lockedAt: null,
              lockedBy: null,
              updatedAt: finishedAt,
            }
          : {
              status: "DEAD_LETTER",
              lastError: failure.lastError,
              finishedAt,
              lockedAt: null,
              lockedBy: null,
              updatedAt: finishedAt,
            },
      });
    },

    async retryJob(organizationId, jobId, now) {
      const updated = await prisma.automationJob.updateMany({
        where: {
          id: jobId,
          organizationId,
          status: { in: ["FAILED", "DEAD_LETTER"] },
        },
        data: {
          status: "PENDING",
          attempts: 0,
          runAt: now,
          dispatchGeneration: { increment: 1 },
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          resultSummary: null,
          startedAt: null,
          finishedAt: null,
          updatedAt: now,
        },
      });

      if (updated.count === 0) {
        return null;
      }

      const job = await prisma.automationJob.findFirst({
        where: { id: jobId, organizationId },
      });

      return job ? mapJob(job) : null;
    },

    async recoverStaleJobs(staleBefore, queuedBefore, now) {
      const stale = await prisma.automationJob.findMany({
        where: { status: "RUNNING", lockedAt: { lt: staleBefore } },
        select: { id: true, attempts: true, maxAttempts: true },
      });
      let running = 0;

      for (const job of stale) {
        const terminal = job.attempts >= job.maxAttempts;
        const updated = await prisma.automationJob.updateMany({
          where: { id: job.id, status: "RUNNING" },
          data: terminal
            ? {
                status: "DEAD_LETTER",
                lastError:
                  "The worker stopped before completing this job and the retry limit was reached.",
                finishedAt: now,
                lockedAt: null,
                lockedBy: null,
                updatedAt: now,
              }
            : {
                status: "PENDING",
                runAt: now,
                lastError: "Recovered after a worker stopped unexpectedly.",
                lockedAt: null,
                lockedBy: null,
                updatedAt: now,
              },
        });

        running += updated.count;
      }

      const queued = await prisma.automationJob.updateMany({
        where: { status: "QUEUED", updatedAt: { lt: queuedBefore } },
        data: { status: "PENDING", updatedAt: now },
      });

      return { running, queued: queued.count };
    },

    async createNotification(input: CreateNotificationInput) {
      try {
        const notification = await prisma.notification.create({
          data: {
            organizationId: input.organizationId,
            customerId: input.customerId,
            subscriptionId: input.subscriptionId,
            invoiceId: input.invoiceId,
            type: input.type,
            dedupeKey: input.dedupeKey,
            recipientEmail: input.recipientEmail,
            subject: input.subject,
            bodyText: input.bodyText,
            bodyHtml: input.bodyHtml,
            maxAttempts: input.maxAttempts,
          },
        });

        return {
          notification: mapNotification(notification),
          created: true,
        };
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }

        const existing = await prisma.notification.findUnique({
          where: { dedupeKey: input.dedupeKey },
        });

        if (!existing) {
          throw error;
        }

        return {
          notification: mapNotification(existing),
          created: false,
        };
      }
    },

    async findNotificationById(notificationId) {
      const notification = await prisma.notification.findUnique({
        where: { id: notificationId },
      });
      return notification ? mapNotification(notification) : null;
    },

    async findNotification(organizationId, notificationId) {
      const notification = await prisma.notification.findFirst({
        where: { id: notificationId, organizationId },
      });
      return notification ? mapNotification(notification) : null;
    },

    async listNotifications(
      organizationId: string,
      options: NotificationListOptions,
    ): Promise<NotificationListResult> {
      const where = notificationWhere(organizationId, options);
      const [items, total] = await prisma.$transaction([
        prisma.notification.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip: (options.page - 1) * options.pageSize,
          take: options.pageSize,
        }),
        prisma.notification.count({ where }),
      ]);

      return { items: items.map(mapNotification), total };
    },

    async countNotifications(organizationId) {
      const groups = await prisma.notification.groupBy({
        by: ["status"],
        where: { organizationId },
        _count: { _all: true },
      });
      const counts = emptyNotificationCounts();

      for (const group of groups) {
        switch (group.status) {
          case "PENDING":
            counts.pending = group._count._all;
            break;
          case "QUEUED":
            counts.queued = group._count._all;
            break;
          case "SENDING":
            counts.sending = group._count._all;
            break;
          case "SENT":
            counts.sent = group._count._all;
            break;
          case "FAILED":
            counts.failed = group._count._all;
            break;
          case "DEAD_LETTER":
            counts.deadLetter = group._count._all;
            break;
          case "SKIPPED":
            counts.skipped = group._count._all;
            break;
        }
      }

      return counts;
    },

    async listDispatchableNotifications(organizationId, now, limit) {
      const notifications = await prisma.notification.findMany({
        where: {
          organizationId,
          status: { in: ["PENDING", "FAILED"] },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
        take: limit,
      });

      return notifications.map(mapNotification);
    },

    async markNotificationQueued(notificationId, queuedAt) {
      await prisma.notification.updateMany({
        where: {
          id: notificationId,
          status: { in: ["PENDING", "FAILED"] },
        },
        data: { status: "QUEUED", queuedAt, updatedAt: queuedAt },
      });
    },

    async claimNotification(notificationId, now) {
      const updated = await prisma.notification.updateMany({
        where: {
          id: notificationId,
          status: { in: ["PENDING", "QUEUED", "FAILED"] },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        data: {
          status: "SENDING",
          attempts: { increment: 1 },
          updatedAt: now,
        },
      });

      if (updated.count === 0) {
        return null;
      }

      const notification = await prisma.notification.findUnique({
        where: { id: notificationId },
      });
      return notification ? mapNotification(notification) : null;
    },

    async completeNotification(
      notificationId,
      providerName,
      providerMessageId,
      sentAt,
    ) {
      await prisma.notification.updateMany({
        where: { id: notificationId, status: "SENDING" },
        data: {
          status: "SENT",
          providerName,
          providerMessageId,
          sentAt,
          nextAttemptAt: null,
          lastError: null,
          updatedAt: sentAt,
        },
      });
    },

    async failNotification(
      notificationId,
      failure: NotificationDeliveryFailure,
      failedAt,
    ) {
      await prisma.notification.updateMany({
        where: { id: notificationId, status: "SENDING" },
        data: failure.retryAt
          ? {
              status: "FAILED",
              lastError: failure.lastError,
              nextAttemptAt: failure.retryAt,
              updatedAt: failedAt,
            }
          : {
              status: "DEAD_LETTER",
              lastError: failure.lastError,
              nextAttemptAt: null,
              queuedAt: null,
              updatedAt: failedAt,
            },
      });
    },

    async skipNotification(notificationId, reason, skippedAt) {
      await prisma.notification.updateMany({
        where: { id: notificationId },
        data: {
          status: "SKIPPED",
          lastError: reason,
          nextAttemptAt: null,
          updatedAt: skippedAt,
        },
      });
    },

    async retryNotification(organizationId, notificationId, now) {
      const updated = await prisma.notification.updateMany({
        where: {
          id: notificationId,
          organizationId,
          status: { in: ["FAILED", "DEAD_LETTER"] },
        },
        data: {
          status: "PENDING",
          attempts: 0,
          nextAttemptAt: now,
          queuedAt: null,
          lastError: null,
          updatedAt: now,
        },
      });

      if (updated.count === 0) {
        return null;
      }

      const notification = await prisma.notification.findFirst({
        where: { id: notificationId, organizationId },
      });
      return notification ? mapNotification(notification) : null;
    },

    async recoverStaleNotifications(staleBefore, queuedBefore, now) {
      const stale = await prisma.notification.findMany({
        where: { status: "SENDING", updatedAt: { lt: staleBefore } },
        select: { id: true, attempts: true, maxAttempts: true },
      });
      let sending = 0;

      for (const notification of stale) {
        const terminal = notification.attempts >= notification.maxAttempts;
        const updated = await prisma.notification.updateMany({
          where: { id: notification.id, status: "SENDING" },
          data: terminal
            ? {
                status: "DEAD_LETTER",
                lastError:
                  "The worker stopped before delivering this notification and the retry limit was reached.",
                nextAttemptAt: null,
                updatedAt: now,
              }
            : {
                status: "FAILED",
                nextAttemptAt: now,
                lastError: "Recovered after a worker stopped unexpectedly.",
                updatedAt: now,
              },
        });

        sending += updated.count;
      }

      const queued = await prisma.notification.updateMany({
        where: { status: "QUEUED", updatedAt: { lt: queuedBefore } },
        data: { status: "PENDING", updatedAt: now },
      });

      return { sending, queued: queued.count };
    },
  };
}
