import { randomUUID } from "node:crypto";
import {
  WEBHOOK_IN_PROGRESS_WINDOW_MS,
  type ClaimGatewayWebhookEventInput,
  type ClaimGatewayWebhookEventResult,
  type GatewayWebhookEventRecord,
  type GatewayWebhookStore,
  type MarkGatewayWebhookEventInput,
} from "../webhook-store.js";

export function createMemoryGatewayWebhookStore(): GatewayWebhookStore {
  const events = new Map<string, GatewayWebhookEventRecord>();

  function findByProviderEventId(
    provider: string,
    providerEventId: string,
  ): GatewayWebhookEventRecord | null {
    return (
      [...events.values()].find(
        (event) =>
          event.provider === provider &&
          event.providerEventId === providerEventId,
      ) ?? null
    );
  }

  return {
    async claim(input: ClaimGatewayWebhookEventInput) {
      const existing = findByProviderEventId(
        input.provider,
        input.providerEventId,
      );
      const now = new Date();

      if (existing) {
        if (existing.status === "PROCESSED" || existing.status === "IGNORED") {
          return {
            event: existing,
            created: false,
            inProgress: false,
          } satisfies ClaimGatewayWebhookEventResult;
        }

        if (existing.status === "RECEIVED") {
          const age = now.getTime() - existing.updatedAt.getTime();

          if (age < WEBHOOK_IN_PROGRESS_WINDOW_MS) {
            return {
              event: existing,
              created: false,
              inProgress: true,
            } satisfies ClaimGatewayWebhookEventResult;
          }
        }

        existing.status = "RECEIVED";
        existing.error = null;
        existing.processedAt = null;
        existing.updatedAt = now;

        return {
          event: existing,
          created: false,
          inProgress: false,
        } satisfies ClaimGatewayWebhookEventResult;
      }

      const event: GatewayWebhookEventRecord = {
        id: randomUUID(),
        provider: input.provider,
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        status: "RECEIVED",
        organizationId: null,
        paymentId: null,
        error: null,
        receivedAt: now,
        processedAt: null,
        updatedAt: now,
      };

      events.set(event.id, event);

      return {
        event,
        created: true,
        inProgress: false,
      } satisfies ClaimGatewayWebhookEventResult;
    },

    async markProcessed(
      eventId: string,
      input: MarkGatewayWebhookEventInput,
    ) {
      const event = events.get(eventId);

      if (!event) {
        return;
      }

      const now = new Date();

      event.status = input.status;
      event.organizationId = input.organizationId;
      event.paymentId = input.paymentId;
      event.error = null;
      event.processedAt = now;
      event.updatedAt = now;
    },

    async markFailed(eventId: string, message: string) {
      const event = events.get(eventId);

      if (!event) {
        return;
      }

      const now = new Date();

      event.status = "FAILED";
      event.error = message.slice(0, 2000);
      event.processedAt = now;
      event.updatedAt = now;
    },
  };
}
