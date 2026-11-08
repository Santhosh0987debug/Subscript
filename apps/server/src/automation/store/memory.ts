import { randomUUID } from "node:crypto";
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

function countJobs(items: Iterable<AutomationJobRecord>): AutomationJobCounts {
  const counts = emptyJobCounts();

  for (const job of items) {
    switch (job.status) {
      case "PENDING":
        counts.pending += 1;
        break;
      case "QUEUED":
        counts.queued += 1;
        break;
      case "RUNNING":
        counts.running += 1;
        break;
      case "SUCCEEDED":
        counts.succeeded += 1;
        break;
      case "FAILED":
        counts.failed += 1;
        break;
      case "DEAD_LETTER":
        counts.deadLetter += 1;
        break;
      case "CANCELED":
        counts.canceled += 1;
        break;
    }
  }

  return counts;
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

function countNotifications(
  items: Iterable<NotificationRecord>,
): AutomationNotificationCounts {
  const counts = emptyNotificationCounts();

  for (const notification of items) {
    switch (notification.status) {
      case "PENDING":
        counts.pending += 1;
        break;
      case "QUEUED":
        counts.queued += 1;
        break;
      case "SENDING":
        counts.sending += 1;
        break;
      case "SENT":
        counts.sent += 1;
        break;
      case "FAILED":
        counts.failed += 1;
        break;
      case "DEAD_LETTER":
        counts.deadLetter += 1;
        break;
      case "SKIPPED":
        counts.skipped += 1;
        break;
    }
  }

  return counts;
}

function cloneJob(job: AutomationJobRecord): AutomationJobRecord {
  return { ...job };
}

function cloneNotification(
  notification: NotificationRecord,
): NotificationRecord {
  return { ...notification };
}

export function createMemoryAutomationStore(): AutomationStore {
  const jobs = new Map<string, AutomationJobRecord>();
  const jobsByIdempotencyKey = new Map<string, string>();
  const notifications = new Map<string, NotificationRecord>();
  const notificationsByDedupeKey = new Map<string, string>();

  function scopedJob(
    organizationId: string,
    jobId: string,
  ): AutomationJobRecord | null {
    const job = jobs.get(jobId);

    return job?.organizationId === organizationId ? job : null;
  }

  function scopedNotification(
    organizationId: string,
    notificationId: string,
  ): NotificationRecord | null {
    const notification = notifications.get(notificationId);

    return notification?.organizationId === organizationId
      ? notification
      : null;
  }

  return {
    async createJob(
      input: CreateAutomationJobInput,
    ): Promise<{ job: AutomationJobRecord; created: boolean }> {
      const existingId = jobsByIdempotencyKey.get(input.idempotencyKey);

      if (existingId) {
        const existing = jobs.get(existingId);

        if (existing) {
          return { job: cloneJob(existing), created: false };
        }
      }

      const now = new Date();
      const job: AutomationJobRecord = {
        id: randomUUID(),
        organizationId: input.organizationId,
        type: input.type,
        queue: input.queue,
        status: "PENDING",
        idempotencyKey: input.idempotencyKey,
        targetType: input.targetType,
        targetId: input.targetId,
        runAt: input.runAt,
        attempts: 0,
        maxAttempts: input.maxAttempts,
        dispatchGeneration: 0,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        resultSummary: null,
        startedAt: null,
        finishedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      jobs.set(job.id, job);
      jobsByIdempotencyKey.set(job.idempotencyKey, job.id);

      return { job: cloneJob(job), created: true };
    },

    async findJobById(jobId) {
      const job = jobs.get(jobId);
      return job ? cloneJob(job) : null;
    },

    async findJob(organizationId, jobId) {
      const job = scopedJob(organizationId, jobId);
      return job ? cloneJob(job) : null;
    },

    async listJobs(
      organizationId: string,
      options: AutomationJobListOptions,
    ): Promise<AutomationJobListResult> {
      const filtered = [...jobs.values()]
        .filter(
          (job) =>
            job.organizationId === organizationId &&
            (options.status === "ALL" || job.status === options.status) &&
            (options.type === "ALL" || job.type === options.type),
        )
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() ||
            left.id.localeCompare(right.id),
        );
      const start = (options.page - 1) * options.pageSize;

      return {
        items: filtered
          .slice(start, start + options.pageSize)
          .map(cloneJob),
        total: filtered.length,
      };
    },

    async countJobs(organizationId) {
      return countJobs(
        [...jobs.values()].filter(
          (job) => job.organizationId === organizationId,
        ),
      );
    },

    async findLatestJob(organizationId, type, targetId) {
      const matching = [...jobs.values()]
        .filter(
          (job) =>
            job.organizationId === organizationId &&
            job.type === type &&
            job.targetId === targetId,
        )
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime(),
        );

      return matching[0] ? cloneJob(matching[0]) : null;
    },

    async listDispatchableJobs(organizationId, now, limit) {
      return [...jobs.values()]
        .filter(
          (job) =>
            job.organizationId === organizationId &&
            (job.status === "PENDING" || job.status === "FAILED") &&
            job.runAt.getTime() <= now.getTime(),
        )
        .sort(
          (left, right) =>
            left.runAt.getTime() - right.runAt.getTime() ||
            left.createdAt.getTime() - right.createdAt.getTime(),
        )
        .slice(0, limit)
        .map(cloneJob);
    },

    async markJobQueued(jobId, dispatchGeneration, queuedAt) {
      const job = jobs.get(jobId);

      if (
        !job ||
        job.dispatchGeneration !== dispatchGeneration ||
        (job.status !== "PENDING" && job.status !== "FAILED")
      ) {
        return;
      }

      job.status = "QUEUED";
      job.updatedAt = queuedAt;
    },

    async claimJob(jobId, workerId, now) {
      const job = jobs.get(jobId);

      if (
        !job ||
        (job.status !== "PENDING" &&
          job.status !== "QUEUED" &&
          job.status !== "FAILED") ||
        job.runAt.getTime() > now.getTime()
      ) {
        return null;
      }

      job.status = "RUNNING";
      job.attempts += 1;
      job.lockedAt = now;
      job.lockedBy = workerId;
      job.startedAt = now;
      job.updatedAt = now;

      return cloneJob(job);
    },

    async completeJob(jobId, summary, finishedAt) {
      const job = jobs.get(jobId);

      if (!job) {
        return;
      }

      job.status = "SUCCEEDED";
      job.resultSummary = summary;
      job.lastError = null;
      job.finishedAt = finishedAt;
      job.lockedAt = null;
      job.lockedBy = null;
      job.updatedAt = finishedAt;
    },

    async failJob(jobId, failure, finishedAt) {
      const job = jobs.get(jobId);

      if (!job) {
        return;
      }

      job.lastError = failure.lastError;
      job.lockedAt = null;
      job.lockedBy = null;
      job.updatedAt = finishedAt;

      if (failure.retryAt) {
        job.status = "FAILED";
        job.runAt = failure.retryAt;
      } else {
        job.status = "DEAD_LETTER";
        job.finishedAt = finishedAt;
      }
    },

    async retryJob(organizationId, jobId, now) {
      const job = scopedJob(organizationId, jobId);

      if (!job || (job.status !== "FAILED" && job.status !== "DEAD_LETTER")) {
        return null;
      }

      job.status = "PENDING";
      job.attempts = 0;
      job.runAt = now;
      job.dispatchGeneration += 1;
      job.lockedAt = null;
      job.lockedBy = null;
      job.lastError = null;
      job.resultSummary = null;
      job.startedAt = null;
      job.finishedAt = null;
      job.updatedAt = now;

      return cloneJob(job);
    },

    async recoverStaleJobs(staleBefore, queuedBefore, now) {
      let running = 0;
      let queued = 0;

      for (const job of jobs.values()) {
        if (
          job.status === "RUNNING" &&
          job.lockedAt !== null &&
          job.lockedAt.getTime() < staleBefore.getTime()
        ) {
          if (job.attempts >= job.maxAttempts) {
            job.status = "DEAD_LETTER";
            job.lastError =
              "The worker stopped before completing this job and the retry limit was reached.";
            job.finishedAt = now;
          } else {
            job.status = "PENDING";
            job.runAt = now;
            job.lastError = "Recovered after a worker stopped unexpectedly.";
          }

          job.lockedAt = null;
          job.lockedBy = null;
          job.updatedAt = now;
          running += 1;
          continue;
        }

        if (
          job.status === "QUEUED" &&
          job.updatedAt.getTime() < queuedBefore.getTime()
        ) {
          job.status = "PENDING";
          job.updatedAt = now;
          queued += 1;
        }
      }

      return { running, queued };
    },

    async createNotification(
      input: CreateNotificationInput,
    ): Promise<{ notification: NotificationRecord; created: boolean }> {
      const existingId = notificationsByDedupeKey.get(input.dedupeKey);

      if (existingId) {
        const existing = notifications.get(existingId);

        if (existing) {
          return {
            notification: cloneNotification(existing),
            created: false,
          };
        }
      }

      const now = new Date();
      const notification: NotificationRecord = {
        id: randomUUID(),
        organizationId: input.organizationId,
        customerId: input.customerId,
        subscriptionId: input.subscriptionId,
        invoiceId: input.invoiceId,
        type: input.type,
        status: "PENDING",
        dedupeKey: input.dedupeKey,
        recipientEmail: input.recipientEmail,
        subject: input.subject,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml,
        attempts: 0,
        maxAttempts: input.maxAttempts,
        nextAttemptAt: null,
        queuedAt: null,
        lastError: null,
        providerName: null,
        providerMessageId: null,
        sentAt: null,
        createdAt: now,
        updatedAt: now,
      };

      notifications.set(notification.id, notification);
      notificationsByDedupeKey.set(notification.dedupeKey, notification.id);

      return { notification: cloneNotification(notification), created: true };
    },

    async findNotificationById(notificationId) {
      const notification = notifications.get(notificationId);
      return notification ? cloneNotification(notification) : null;
    },

    async findNotification(organizationId, notificationId) {
      const notification = scopedNotification(organizationId, notificationId);
      return notification ? cloneNotification(notification) : null;
    },

    async listNotifications(
      organizationId: string,
      options: NotificationListOptions,
    ): Promise<NotificationListResult> {
      const filtered = [...notifications.values()]
        .filter(
          (notification) =>
            notification.organizationId === organizationId &&
            (options.status === "ALL" ||
              notification.status === options.status) &&
            (options.type === "ALL" || notification.type === options.type),
        )
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() ||
            left.id.localeCompare(right.id),
        );
      const start = (options.page - 1) * options.pageSize;

      return {
        items: filtered
          .slice(start, start + options.pageSize)
          .map(cloneNotification),
        total: filtered.length,
      };
    },

    async countNotifications(organizationId) {
      return countNotifications(
        [...notifications.values()].filter(
          (notification) => notification.organizationId === organizationId,
        ),
      );
    },

    async listDispatchableNotifications(organizationId, now, limit) {
      return [...notifications.values()]
        .filter(
          (notification) =>
            notification.organizationId === organizationId &&
            (notification.status === "PENDING" ||
              notification.status === "FAILED") &&
            (notification.nextAttemptAt === null ||
              notification.nextAttemptAt.getTime() <= now.getTime()),
        )
        .sort(
          (left, right) =>
            (left.nextAttemptAt?.getTime() ?? left.createdAt.getTime()) -
            (right.nextAttemptAt?.getTime() ?? right.createdAt.getTime()),
        )
        .slice(0, limit)
        .map(cloneNotification);
    },

    async markNotificationQueued(notificationId, queuedAt) {
      const notification = notifications.get(notificationId);

      if (
        !notification ||
        (notification.status !== "PENDING" &&
          notification.status !== "FAILED")
      ) {
        return;
      }

      notification.status = "QUEUED";
      notification.queuedAt = queuedAt;
      notification.updatedAt = queuedAt;
    },

    async claimNotification(notificationId, now) {
      const notification = notifications.get(notificationId);

      if (
        !notification ||
        (notification.status !== "PENDING" &&
          notification.status !== "QUEUED" &&
          notification.status !== "FAILED") ||
        (notification.nextAttemptAt !== null &&
          notification.nextAttemptAt.getTime() > now.getTime())
      ) {
        return null;
      }

      notification.status = "SENDING";
      notification.attempts += 1;
      notification.updatedAt = now;

      return cloneNotification(notification);
    },

    async completeNotification(
      notificationId,
      providerName,
      providerMessageId,
      sentAt,
    ) {
      const notification = notifications.get(notificationId);

      if (!notification) {
        return;
      }

      notification.status = "SENT";
      notification.providerName = providerName;
      notification.providerMessageId = providerMessageId;
      notification.sentAt = sentAt;
      notification.nextAttemptAt = null;
      notification.lastError = null;
      notification.updatedAt = sentAt;
    },

    async failNotification(
      notificationId,
      failure: NotificationDeliveryFailure,
      failedAt,
    ) {
      const notification = notifications.get(notificationId);

      if (!notification) {
        return;
      }

      notification.lastError = failure.lastError;
      notification.nextAttemptAt = failure.retryAt;
      notification.updatedAt = failedAt;
      notification.status = failure.retryAt ? "FAILED" : "DEAD_LETTER";

      if (!failure.retryAt) {
        notification.queuedAt = null;
      }
    },

    async skipNotification(notificationId, reason, skippedAt) {
      const notification = notifications.get(notificationId);

      if (!notification) {
        return;
      }

      notification.status = "SKIPPED";
      notification.lastError = reason;
      notification.updatedAt = skippedAt;
    },

    async retryNotification(organizationId, notificationId, now) {
      const notification = scopedNotification(organizationId, notificationId);

      if (
        !notification ||
        (notification.status !== "FAILED" &&
          notification.status !== "DEAD_LETTER")
      ) {
        return null;
      }

      notification.status = "PENDING";
      notification.attempts = 0;
      notification.nextAttemptAt = now;
      notification.queuedAt = null;
      notification.lastError = null;
      notification.updatedAt = now;

      return cloneNotification(notification);
    },

    async recoverStaleNotifications(staleBefore, queuedBefore, now) {
      let sending = 0;
      let queued = 0;

      for (const notification of notifications.values()) {
        if (
          notification.status === "SENDING" &&
          notification.updatedAt.getTime() < staleBefore.getTime()
        ) {
          if (notification.attempts >= notification.maxAttempts) {
            notification.status = "DEAD_LETTER";
            notification.lastError =
              "The worker stopped before delivering this notification and the retry limit was reached.";
            notification.nextAttemptAt = null;
          } else {
            notification.status = "FAILED";
            notification.nextAttemptAt = now;
            notification.lastError =
              "Recovered after a worker stopped unexpectedly.";
          }

          notification.updatedAt = now;
          sending += 1;
          continue;
        }

        if (
          notification.status === "QUEUED" &&
          notification.updatedAt.getTime() < queuedBefore.getTime()
        ) {
          notification.status = "PENDING";
          notification.updatedAt = now;
          queued += 1;
        }
      }

      return { sending, queued };
    },
  };
}
