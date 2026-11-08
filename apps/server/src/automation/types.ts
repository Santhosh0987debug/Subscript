import type {
  AutomationJobCounts,
  AutomationJobStatus,
  AutomationJobStatusFilter,
  AutomationJobType,
  AutomationJobTypeFilter,
  AutomationNotificationCounts,
  AutomationQueueName,
  BillingInterval,
  NotificationStatus,
  NotificationStatusFilter,
  NotificationType,
  NotificationTypeFilter,
  SubscriptionStatus,
} from "@subscript/shared";

export interface AutomationJobRecord {
  id: string;
  organizationId: string;
  type: AutomationJobType;
  queue: AutomationQueueName;
  status: AutomationJobStatus;
  idempotencyKey: string;
  targetType: string;
  targetId: string | null;
  runAt: Date;
  attempts: number;
  maxAttempts: number;
  dispatchGeneration: number;
  lockedAt: Date | null;
  lockedBy: string | null;
  lastError: string | null;
  resultSummary: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAutomationJobInput {
  organizationId: string;
  type: AutomationJobType;
  queue: AutomationQueueName;
  idempotencyKey: string;
  targetType: string;
  targetId: string | null;
  runAt: Date;
  maxAttempts: number;
}

export interface AutomationJobListOptions {
  status: AutomationJobStatusFilter;
  type: AutomationJobTypeFilter;
  page: number;
  pageSize: number;
}

export interface AutomationJobListResult {
  items: AutomationJobRecord[];
  total: number;
}

export interface AutomationJobFailure {
  lastError: string;
  retryAt: Date | null;
}

export interface NotificationRecord {
  id: string;
  organizationId: string;
  customerId: string | null;
  subscriptionId: string | null;
  invoiceId: string | null;
  type: NotificationType;
  status: NotificationStatus;
  dedupeKey: string;
  recipientEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date | null;
  queuedAt: Date | null;
  lastError: string | null;
  providerName: string | null;
  providerMessageId: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateNotificationInput {
  organizationId: string;
  customerId: string | null;
  subscriptionId: string | null;
  invoiceId: string | null;
  type: NotificationType;
  dedupeKey: string;
  recipientEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  maxAttempts: number;
}

export interface NotificationListOptions {
  status: NotificationStatusFilter;
  type: NotificationTypeFilter;
  page: number;
  pageSize: number;
}

export interface NotificationListResult {
  items: NotificationRecord[];
  total: number;
}

export interface NotificationDeliveryFailure {
  lastError: string;
  retryAt: Date | null;
}

/**
 * Durable job and notification intent. The database row is the source of truth;
 * BullMQ job IDs are only transport handles and may be delivered more than once.
 */
export interface AutomationStore {
  createJob(
    input: CreateAutomationJobInput,
  ): Promise<{ job: AutomationJobRecord; created: boolean }>;
  findJobById(jobId: string): Promise<AutomationJobRecord | null>;
  findJob(
    organizationId: string,
    jobId: string,
  ): Promise<AutomationJobRecord | null>;
  listJobs(
    organizationId: string,
    options: AutomationJobListOptions,
  ): Promise<AutomationJobListResult>;
  countJobs(organizationId: string): Promise<AutomationJobCounts>;
  findLatestJob(
    organizationId: string,
    type: AutomationJobType,
    targetId: string,
  ): Promise<AutomationJobRecord | null>;
  listDispatchableJobs(
    organizationId: string,
    now: Date,
    limit: number,
  ): Promise<AutomationJobRecord[]>;
  markJobQueued(
    jobId: string,
    dispatchGeneration: number,
    queuedAt: Date,
  ): Promise<void>;
  claimJob(
    jobId: string,
    workerId: string,
    now: Date,
  ): Promise<AutomationJobRecord | null>;
  completeJob(
    jobId: string,
    summary: string,
    finishedAt: Date,
  ): Promise<void>;
  failJob(
    jobId: string,
    failure: AutomationJobFailure,
    finishedAt: Date,
  ): Promise<void>;
  retryJob(
    organizationId: string,
    jobId: string,
    now: Date,
  ): Promise<AutomationJobRecord | null>;
  recoverStaleJobs(
    staleBefore: Date,
    queuedBefore: Date,
    now: Date,
  ): Promise<{ running: number; queued: number }>;

  createNotification(
    input: CreateNotificationInput,
  ): Promise<{ notification: NotificationRecord; created: boolean }>;
  findNotificationById(
    notificationId: string,
  ): Promise<NotificationRecord | null>;
  findNotification(
    organizationId: string,
    notificationId: string,
  ): Promise<NotificationRecord | null>;
  listNotifications(
    organizationId: string,
    options: NotificationListOptions,
  ): Promise<NotificationListResult>;
  countNotifications(
    organizationId: string,
  ): Promise<AutomationNotificationCounts>;
  listDispatchableNotifications(
    organizationId: string,
    now: Date,
    limit: number,
  ): Promise<NotificationRecord[]>;
  markNotificationQueued(
    notificationId: string,
    queuedAt: Date,
  ): Promise<void>;
  claimNotification(
    notificationId: string,
    now: Date,
  ): Promise<NotificationRecord | null>;
  completeNotification(
    notificationId: string,
    providerName: string,
    providerMessageId: string | null,
    sentAt: Date,
  ): Promise<void>;
  failNotification(
    notificationId: string,
    failure: NotificationDeliveryFailure,
    failedAt: Date,
  ): Promise<void>;
  skipNotification(
    notificationId: string,
    reason: string,
    skippedAt: Date,
  ): Promise<void>;
  retryNotification(
    organizationId: string,
    notificationId: string,
    now: Date,
  ): Promise<NotificationRecord | null>;
  recoverStaleNotifications(
    staleBefore: Date,
    queuedBefore: Date,
    now: Date,
  ): Promise<{ sending: number; queued: number }>;
}

export interface AutomationSubscriptionCandidate {
  organizationId: string;
  organizationName: string;
  subscriptionId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  planName: string;
  status: SubscriptionStatus;
  quantity: number;
  unitAmountMinor: number;
  currency: string;
  interval: BillingInterval;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface AutomationPaymentFailureCandidate {
  organizationId: string;
  organizationName: string;
  paymentId: string;
  invoiceId: string;
  invoiceNumber: string;
  subscriptionId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  planName: string;
  amountMinor: number;
  currency: string;
  failedAt: Date;
}

export interface AutomationPaymentSucceededEvent {
  organizationId: string;
  organizationName: string;
  paymentId: string;
  invoiceId: string;
  invoiceNumber: string;
  subscriptionId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  planName: string;
  amountMinor: number;
  currency: string;
  paidAt: Date;
}

export interface AutomationRefundEvent {
  organizationId: string;
  organizationName: string;
  refundId: string;
  paymentId: string;
  invoiceId: string;
  invoiceNumber: string;
  subscriptionId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  amountMinor: number;
  currency: string;
  status: "SUCCEEDED" | "FAILED";
  reason: string | null;
  updatedAt: Date;
}

export interface AutomationJobDispatcher {
  dispatchJob(job: AutomationJobRecord): Promise<boolean>;
}

export interface AutomationCandidateSource {
  listOrganizationIds(): Promise<string[]>;
  getOrganizationName(organizationId: string): Promise<string | null>;
  listSubscriptionsForAutomation(
    organizationId: string,
  ): Promise<AutomationSubscriptionCandidate[]>;
  listFailedPayments(
    organizationId: string,
    since: Date,
  ): Promise<AutomationPaymentFailureCandidate[]>;
  listRecentSucceededPayments(
    organizationId: string,
    since: Date,
  ): Promise<AutomationPaymentSucceededEvent[]>;
  listRecentRefundUpdates(
    organizationId: string,
    since: Date,
  ): Promise<AutomationRefundEvent[]>;
}

export interface AutomationJobHandlerResult {
  summary: string;
  notificationCreated?: boolean;
}

export interface AutomationRunSummary {
  organizations: number;
  jobsCreated: number;
  jobsDispatched: number;
  notificationsCreated: number;
  notificationsDispatched: number;
  staleJobsRecovered: number;
  staleNotificationsRecovered: number;
}
