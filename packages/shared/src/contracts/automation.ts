import type {
  IsoDateString,
  Money,
  SubscriptionStatus,
} from "../domain/subscription.js";

export const AUTOMATION_JOB_TYPES = [
  "RENEWAL_REMINDER",
  "TRIAL_ENDING_REMINDER",
  "TRIAL_ACTIVATION",
  "RECURRING_INVOICE",
  "CANCEL_AT_PERIOD_END",
  "STATUS_SYNC",
  "PAYMENT_RECOVERY",
  "SUBSCRIPTION_EXPIRATION",
] as const;
export type AutomationJobType = (typeof AUTOMATION_JOB_TYPES)[number];

export const AUTOMATION_JOB_TYPE_FILTERS = ["ALL", ...AUTOMATION_JOB_TYPES] as const;
export type AutomationJobTypeFilter =
  (typeof AUTOMATION_JOB_TYPE_FILTERS)[number];

export const AUTOMATION_JOB_STATUSES = [
  "PENDING",
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "DEAD_LETTER",
  "CANCELED",
] as const;
export type AutomationJobStatus = (typeof AUTOMATION_JOB_STATUSES)[number];

export const AUTOMATION_JOB_STATUS_FILTERS = [
  "ALL",
  ...AUTOMATION_JOB_STATUSES,
] as const;
export type AutomationJobStatusFilter =
  (typeof AUTOMATION_JOB_STATUS_FILTERS)[number];

export const AUTOMATION_QUEUE_NAMES = ["BILLING", "NOTIFICATIONS"] as const;
export type AutomationQueueName = (typeof AUTOMATION_QUEUE_NAMES)[number];

export const NOTIFICATION_TYPES = [
  "RENEWAL_UPCOMING",
  "TRIAL_ENDING",
  "INVOICE_GENERATED",
  "PAYMENT_SUCCEEDED",
  "PAYMENT_FAILED",
  "SUBSCRIPTION_CANCELED",
  "REFUND_UPDATED",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_FILTERS = ["ALL", ...NOTIFICATION_TYPES] as const;
export type NotificationTypeFilter = (typeof NOTIFICATION_TYPE_FILTERS)[number];

export const NOTIFICATION_STATUSES = [
  "PENDING",
  "QUEUED",
  "SENDING",
  "SENT",
  "FAILED",
  "DEAD_LETTER",
  "SKIPPED",
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const NOTIFICATION_STATUS_FILTERS = [
  "ALL",
  ...NOTIFICATION_STATUSES,
] as const;
export type NotificationStatusFilter =
  (typeof NOTIFICATION_STATUS_FILTERS)[number];

export interface AutomationJob {
  id: string;
  type: AutomationJobType;
  queue: AutomationQueueName;
  status: AutomationJobStatus;
  targetType: string;
  targetId: string | null;
  runAt: IsoDateString;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  resultSummary: string | null;
  startedAt: IsoDateString | null;
  finishedAt: IsoDateString | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface AutomationJobCounts {
  pending: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  deadLetter: number;
  canceled: number;
}

export interface AutomationJobListParams {
  status?: AutomationJobStatusFilter;
  type?: AutomationJobTypeFilter;
  page?: number;
  pageSize?: number;
}

export interface AutomationJobListResponse {
  jobs: AutomationJob[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  counts: AutomationJobCounts;
}

export interface AutomationJobResponse {
  job: AutomationJob;
}

export interface AutomationNotification {
  id: string;
  type: NotificationType;
  status: NotificationStatus;
  recipientEmail: string;
  subject: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  nextAttemptAt: IsoDateString | null;
  sentAt: IsoDateString | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface AutomationNotificationCounts {
  pending: number;
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  deadLetter: number;
  skipped: number;
}

export interface AutomationNotificationListParams {
  status?: NotificationStatusFilter;
  type?: NotificationTypeFilter;
  page?: number;
  pageSize?: number;
}

export interface AutomationNotificationListResponse {
  notifications: AutomationNotification[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  counts: AutomationNotificationCounts;
}

export interface AutomationNotificationResponse {
  notification: AutomationNotification;
}

export interface AutomationRenewal {
  subscriptionId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  planName: string;
  status: SubscriptionStatus;
  renewalDate: IsoDateString;
  amount: Money;
  cancelAtPeriodEnd: boolean;
}

export interface AutomationQueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

export interface AutomationQueueHealth {
  name: AutomationQueueName;
  displayName: string;
  enabled: boolean;
  connected: boolean;
  workers: number;
  counts: AutomationQueueCounts;
  error: string | null;
}

export type AutomationWorkerStatus =
  | "online"
  | "degraded"
  | "offline"
  | "unknown";

export interface AutomationHealth {
  enabled: boolean;
  redisConfigured: boolean;
  workerStatus: AutomationWorkerStatus;
  lastWorkerSeenAt: IsoDateString | null;
  queues: AutomationQueueHealth[];
  generatedAt: IsoDateString;
}

export interface AutomationSummary {
  pendingJobs: number;
  runningJobs: number;
  failedJobs: number;
  deadLetterJobs: number;
  pendingNotifications: number;
  failedNotifications: number;
}

export interface AutomationOverviewResponse {
  health: AutomationHealth;
  summary: AutomationSummary;
  upcomingRenewals: AutomationRenewal[];
  renewalWindowDays: number;
}

export interface AutomationDispatchResponse {
  queuedJobs: number;
  queuedNotifications: number;
}

export function isAutomationJobStatus(
  value: string,
): value is AutomationJobStatus {
  return (AUTOMATION_JOB_STATUS_FILTERS as readonly string[]).includes(value);
}

export function isAutomationJobType(
  value: string,
): value is AutomationJobType {
  return (AUTOMATION_JOB_TYPE_FILTERS as readonly string[]).includes(value);
}
