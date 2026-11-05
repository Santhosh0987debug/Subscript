import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import {
  WEBHOOK_IN_PROGRESS_WINDOW_MS,
  type ClaimGatewayWebhookEventInput,
  type GatewayWebhookEventRecord,
  type GatewayWebhookStore,
  type MarkGatewayWebhookEventInput,
} from "../webhook-store.js";

type WebhookEventRow = {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  status: string;
  organizationId: string | null;
  paymentId: string | null;
  error: string | null;
  receivedAt: Date;
  processedAt: Date | null;
  updatedAt: Date;
};

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function mapEvent(row: WebhookEventRow): GatewayWebhookEventRecord {
  return {
    id: row.id,
    provider: row.provider,
    providerEventId: row.providerEventId,
    eventType: row.eventType,
    status: row.status as GatewayWebhookEventRecord["status"],
    organizationId: row.organizationId,
    paymentId: row.paymentId,
    error: row.error,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt,
    updatedAt: row.updatedAt,
  };
}

export function createPrismaGatewayWebhookStore(
  prisma: PrismaClient,
): GatewayWebhookStore {
  async function findExisting(
    provider: string,
    providerEventId: string,
  ): Promise<WebhookEventRow | null> {
    return prisma.gatewayWebhookEvent.findFirst({
      where: { provider, providerEventId },
    });
  }

  return {
    async claim(input: ClaimGatewayWebhookEventInput) {
      const now = new Date();

      try {
        const created = await prisma.gatewayWebhookEvent.create({
          data: {
            provider: input.provider,
            providerEventId: input.providerEventId,
            eventType: input.eventType,
            payload: input.payload as Prisma.InputJsonValue,
          },
        });

        return {
          event: mapEvent(created),
          created: true,
          inProgress: false,
        };
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }

      const existing = await findExisting(
        input.provider,
        input.providerEventId,
      );

      if (!existing) {
        throw new Error("The webhook event row could not be read.");
      }

      if (existing.status === "PROCESSED" || existing.status === "IGNORED") {
        return {
          event: mapEvent(existing),
          created: false,
          inProgress: false,
        };
      }

      if (existing.status === "RECEIVED") {
        const age = now.getTime() - existing.updatedAt.getTime();

        if (age < WEBHOOK_IN_PROGRESS_WINDOW_MS) {
          return {
            event: mapEvent(existing),
            created: false,
            inProgress: true,
          };
        }
      }

      const retried = await prisma.gatewayWebhookEvent.update({
        where: { id: existing.id },
        data: {
          status: "RECEIVED",
          error: null,
          processedAt: null,
        },
      });

      return {
        event: mapEvent(retried),
        created: false,
        inProgress: false,
      };
    },

    async markProcessed(eventId: string, input: MarkGatewayWebhookEventInput) {
      await prisma.gatewayWebhookEvent.update({
        where: { id: eventId },
        data: {
          status: input.status,
          organizationId: input.organizationId,
          paymentId: input.paymentId,
          error: null,
          processedAt: new Date(),
        },
      });
    },

    async markFailed(eventId: string, message: string) {
      await prisma.gatewayWebhookEvent.update({
        where: { id: eventId },
        data: {
          status: "FAILED",
          error: message.slice(0, 2000),
          processedAt: new Date(),
        },
      });
    },
  };
}
