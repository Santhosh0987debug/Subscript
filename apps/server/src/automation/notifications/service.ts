import { logger } from "../../lib/logger.js";
import { boundedExponentialDelay } from "../backoff.js";
import type {
  AutomationStore,
  NotificationRecord,
} from "../types.js";
import { renderNotification } from "./templates.js";
import type {
  EmailProvider,
  NotificationDeliveryOutcome,
  NotificationDispatcher,
  NotificationEnqueueInput,
} from "./types.js";

export interface NotificationServiceOptions {
  store: AutomationStore;
  provider: EmailProvider;
  from: string;
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  dispatcher?: NotificationDispatcher | null;
}

export interface NotificationService {
  enqueue(
    input: NotificationEnqueueInput,
  ): Promise<{ notification: NotificationRecord; created: boolean }>;
  deliver(notificationId: string): Promise<NotificationDeliveryOutcome>;
  dispatchPending(
    organizationId: string,
    now: Date,
    limit?: number,
  ): Promise<number>;
  retry(
    organizationId: string,
    notificationId: string,
    now: Date,
  ): Promise<NotificationRecord | null>;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 500);
}

function isRecipient(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function createNotificationService(
  options: NotificationServiceOptions,
): NotificationService {
  return {
    async enqueue(input) {
      const rendered = renderNotification(input.type, input.data);
      const result = await options.store.createNotification({
        organizationId: input.organizationId,
        customerId: input.customerId,
        subscriptionId: input.subscriptionId,
        invoiceId: input.invoiceId,
        type: input.type,
        dedupeKey: input.dedupeKey,
        recipientEmail: input.recipientEmail,
        subject: rendered.subject,
        bodyText: rendered.text,
        bodyHtml: rendered.html,
        maxAttempts: options.maxAttempts,
      });

      if (result.created && options.dispatcher) {
        try {
          await options.dispatcher.dispatchNotification(result.notification);
        } catch (error) {
          logger.warn("Notification queued but transport dispatch failed", {
            notificationId: result.notification.id,
            error: safeError(error),
          });
        }
      }

      return result;
    },

    async deliver(notificationId) {
      const notification = await options.store.claimNotification(
        notificationId,
        new Date(),
      );

      if (!notification) {
        return "skipped";
      }

      if (!isRecipient(notification.recipientEmail)) {
        await options.store.skipNotification(
          notification.id,
          "The recipient email address is invalid.",
          new Date(),
        );
        logger.warn("Notification skipped because the recipient is invalid", {
          notificationId: notification.id,
        });
        return "skipped";
      }

      try {
        const result = await options.provider.send({
          to: notification.recipientEmail,
          from: options.from,
          subject: notification.subject,
          text: notification.bodyText,
          html: notification.bodyHtml,
        });
        const sentAt = new Date();

        await options.store.completeNotification(
          notification.id,
          result.providerName,
          result.providerMessageId,
          sentAt,
        );
        logger.info("Notification delivered", {
          notificationId: notification.id,
          type: notification.type,
          provider: result.providerName,
        });

        return "sent";
      } catch (error) {
        const failedAt = new Date();
        const retryAt =
          notification.attempts < notification.maxAttempts
            ? new Date(
                failedAt.getTime() +
                  boundedExponentialDelay(
                    notification.attempts,
                    options.retryBaseMs,
                    options.retryMaxMs,
                  ),
              )
            : null;

        await options.store.failNotification(
          notification.id,
          { lastError: safeError(error), retryAt },
          failedAt,
        );
        logger.warn("Notification delivery failed", {
          notificationId: notification.id,
          attempts: notification.attempts,
          maxAttempts: notification.maxAttempts,
          willRetry: retryAt !== null,
          error: safeError(error),
        });

        return retryAt ? "failed" : "dead-lettered";
      }
    },

    async dispatchPending(organizationId, now, limit = 50) {
      if (!options.dispatcher) {
        return 0;
      }

      const notifications = await options.store.listDispatchableNotifications(
        organizationId,
        now,
        limit,
      );
      let queued = 0;

      for (const notification of notifications) {
        try {
          if (await options.dispatcher.dispatchNotification(notification)) {
            queued += 1;
          }
        } catch (error) {
          logger.warn("Notification dispatch failed; it will be retried", {
            notificationId: notification.id,
            error: safeError(error),
          });
        }
      }

      return queued;
    },

    async retry(organizationId, notificationId, now) {
      const notification = await options.store.retryNotification(
        organizationId,
        notificationId,
        now,
      );

      if (!notification) {
        return null;
      }

      if (options.dispatcher) {
        try {
          await options.dispatcher.dispatchNotification(notification);
        } catch (error) {
          logger.warn("Retried notification could not be dispatched yet", {
            notificationId: notification.id,
            error: safeError(error),
          });
        }
      }

      return notification;
    },
  };
}
