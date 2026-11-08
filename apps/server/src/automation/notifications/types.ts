import type { NotificationType } from "@subscript/shared";
import type { NotificationRecord } from "../types.js";

export interface NotificationTemplateData {
  organizationName: string;
  customerName: string;
  planName?: string | null;
  invoiceNumber?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  effectiveDate?: Date | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  retryAttempt?: number | null;
  maxAttempts?: number | null;
  statusLabel?: string | null;
  reason?: string | null;
}

export interface RenderedNotification {
  subject: string;
  text: string;
  html: string;
}

export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string | null;
}

export interface EmailSendResult {
  providerName: string;
  providerMessageId: string | null;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export interface NotificationEnqueueInput {
  organizationId: string;
  customerId: string | null;
  subscriptionId: string | null;
  invoiceId: string | null;
  type: NotificationType;
  dedupeKey: string;
  recipientEmail: string;
  data: NotificationTemplateData;
}

export interface NotificationDispatcher {
  dispatchNotification(notification: NotificationRecord): Promise<boolean>;
}

export type NotificationDeliveryOutcome =
  | "sent"
  | "skipped"
  | "failed"
  | "dead-lettered";
