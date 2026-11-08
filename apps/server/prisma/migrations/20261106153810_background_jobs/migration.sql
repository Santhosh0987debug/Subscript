-- CreateEnum
CREATE TYPE "AutomationJobType" AS ENUM ('RENEWAL_REMINDER', 'TRIAL_ENDING_REMINDER', 'TRIAL_ACTIVATION', 'RECURRING_INVOICE', 'CANCEL_AT_PERIOD_END', 'STATUS_SYNC', 'PAYMENT_RECOVERY', 'SUBSCRIPTION_EXPIRATION');

-- CreateEnum
CREATE TYPE "AutomationQueueName" AS ENUM ('BILLING', 'NOTIFICATIONS');

-- CreateEnum
CREATE TYPE "AutomationJobStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER', 'CANCELED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('RENEWAL_UPCOMING', 'TRIAL_ENDING', 'INVOICE_GENERATED', 'PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'SUBSCRIPTION_CANCELED', 'REFUND_UPDATED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'QUEUED', 'SENDING', 'SENT', 'FAILED', 'DEAD_LETTER', 'SKIPPED');

-- CreateTable
CREATE TABLE "automation_jobs" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "type" "AutomationJobType" NOT NULL,
    "queue" "AutomationQueueName" NOT NULL,
    "status" "AutomationJobStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" VARCHAR(240) NOT NULL,
    "targetType" VARCHAR(60) NOT NULL,
    "targetId" UUID,
    "runAt" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "dispatchGeneration" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMPTZ(3),
    "lockedBy" VARCHAR(120),
    "lastError" TEXT,
    "resultSummary" VARCHAR(500),
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "automation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "customerId" UUID,
    "subscriptionId" UUID,
    "invoiceId" UUID,
    "type" "NotificationType" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "dedupeKey" VARCHAR(240) NOT NULL,
    "recipientEmail" VARCHAR(320) NOT NULL,
    "subject" VARCHAR(240) NOT NULL,
    "bodyText" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMPTZ(3),
    "queuedAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "providerName" VARCHAR(40),
    "providerMessageId" VARCHAR(200),
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "automation_jobs_idempotencyKey_key" ON "automation_jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "automation_jobs_organizationId_status_runAt_idx" ON "automation_jobs"("organizationId", "status", "runAt");

-- CreateIndex
CREATE INDEX "automation_jobs_status_runAt_idx" ON "automation_jobs"("status", "runAt");

-- CreateIndex
CREATE INDEX "automation_jobs_queue_status_idx" ON "automation_jobs"("queue", "status");

-- CreateIndex
CREATE INDEX "automation_jobs_organizationId_type_targetId_createdAt_idx" ON "automation_jobs"("organizationId", "type", "targetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupeKey_key" ON "notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "notifications_organizationId_status_createdAt_idx" ON "notifications"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_status_nextAttemptAt_idx" ON "notifications"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "notifications_organizationId_type_createdAt_idx" ON "notifications"("organizationId", "type", "createdAt");

-- AddForeignKey
ALTER TABLE "automation_jobs" ADD CONSTRAINT "automation_jobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
