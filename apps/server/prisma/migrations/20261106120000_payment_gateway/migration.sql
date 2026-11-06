-- CreateEnum
CREATE TYPE "PaymentRefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "GatewayWebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InvoiceActivityType" ADD VALUE 'PAYMENT_REFUND_REQUESTED';
ALTER TYPE "InvoiceActivityType" ADD VALUE 'PAYMENT_REFUND_FAILED';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "gatewayMetadata" JSONB,
ADD COLUMN     "gatewayOrderId" VARCHAR(160),
ADD COLUMN     "gatewayPaymentId" VARCHAR(160),
ADD COLUMN     "gatewayProvider" VARCHAR(40),
ADD COLUMN     "gatewayStatus" VARCHAR(80),
ADD COLUMN     "refundedAmountMinor" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "payment_refunds" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "providerRefundId" VARCHAR(160),
    "amountMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "PaymentRefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" VARCHAR(500),
    "metadata" JSONB,
    "processedAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_webhook_events" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "providerEventId" VARCHAR(160) NOT NULL,
    "eventType" VARCHAR(80) NOT NULL,
    "status" "GatewayWebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB NOT NULL,
    "organizationId" UUID,
    "paymentId" UUID,
    "error" TEXT,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "gateway_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_refunds_organizationId_paymentId_createdAt_idx" ON "payment_refunds"("organizationId", "paymentId", "createdAt");

-- CreateIndex
CREATE INDEX "payment_refunds_organizationId_invoiceId_createdAt_idx" ON "payment_refunds"("organizationId", "invoiceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_refunds_provider_providerRefundId_key" ON "payment_refunds"("provider", "providerRefundId");

-- CreateIndex
CREATE INDEX "gateway_webhook_events_provider_eventType_receivedAt_idx" ON "gateway_webhook_events"("provider", "eventType", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_webhook_events_provider_providerEventId_key" ON "gateway_webhook_events"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "payments_organizationId_gatewayPaymentId_idx" ON "payments"("organizationId", "gatewayPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_gatewayProvider_gatewayOrderId_key" ON "payments"("gatewayProvider", "gatewayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_gatewayProvider_gatewayPaymentId_key" ON "payments"("gatewayProvider", "gatewayPaymentId");

-- AddForeignKey
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
