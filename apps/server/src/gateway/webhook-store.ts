export type GatewayWebhookEventStatus =
  | "RECEIVED"
  | "PROCESSED"
  | "IGNORED"
  | "FAILED";

export interface GatewayWebhookEventRecord {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  status: GatewayWebhookEventStatus;
  organizationId: string | null;
  paymentId: string | null;
  error: string | null;
  receivedAt: Date;
  processedAt: Date | null;
  updatedAt: Date;
}

export interface ClaimGatewayWebhookEventInput {
  provider: string;
  providerEventId: string;
  eventType: string;
  payload: unknown;
}

export interface ClaimGatewayWebhookEventResult {
  event: GatewayWebhookEventRecord;
  /**
   * False when another delivery of the same provider event id already exists.
   * `inProgress` is true only when that earlier delivery is still running and
   * is recent enough that the provider should retry later.
   */
  created: boolean;
  inProgress: boolean;
}

export interface MarkGatewayWebhookEventInput {
  status: Extract<GatewayWebhookEventStatus, "PROCESSED" | "IGNORED">;
  organizationId: string | null;
  paymentId: string | null;
}

export interface GatewayWebhookStore {
  claim(
    input: ClaimGatewayWebhookEventInput,
  ): Promise<ClaimGatewayWebhookEventResult>;
  markProcessed(
    eventId: string,
    input: MarkGatewayWebhookEventInput,
  ): Promise<void>;
  markFailed(eventId: string, message: string): Promise<void>;
}

export const WEBHOOK_IN_PROGRESS_WINDOW_MS = 2 * 60 * 1000;
