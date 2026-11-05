-- Phase 4: subscription billing engine.
--
-- Money moves from Decimal major units to integer minor units so currencies
-- with zero or three decimal places are handled without a two-decimal
-- assumption. Existing values are converted once here.

-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'EXPIRED';

-- CreateEnum
CREATE TYPE "SubscriptionActivityType" AS ENUM ('CREATED', 'TRIAL_STARTED', 'ACTIVATED', 'PAST_DUE', 'PAUSED', 'RESUMED', 'CANCEL_SCHEDULED', 'CANCELED', 'RENEWED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InvoiceActivityType" AS ENUM ('CREATED', 'ISSUED', 'VOIDED', 'MARKED_UNCOLLECTIBLE', 'PAYMENT_RECORDED', 'PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'PAYMENT_REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD', 'CHECK', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('MANUAL', 'GATEWAY');

-- AlterTable
ALTER TABLE "subscriptions"
    ADD COLUMN "startedAt" TIMESTAMPTZ(3),
    ADD COLUMN "trialEndsAt" TIMESTAMPTZ(3),
    ADD COLUMN "pausedAt" TIMESTAMPTZ(3),
    ADD COLUMN "endedAt" TIMESTAMPTZ(3),
    ADD COLUMN "planName" VARCHAR(120),
    ADD COLUMN "planCode" VARCHAR(60),
    ADD COLUMN "unitAmountMinor" INTEGER,
    ADD COLUMN "currency" VARCHAR(3),
    ADD COLUMN "interval" "BillingInterval",
    ADD COLUMN "trialDays" INTEGER NOT NULL DEFAULT 0;

-- Backfill price snapshots from the plan that the subscription currently
-- references. Future plan edits never rewrite these columns.
UPDATE "subscriptions" AS s
SET
    "startedAt" = COALESCE(s."startedAt", s."createdAt"),
    "planName" = p."name",
    "planCode" = p."code",
    "unitAmountMinor" = p."amountMinor",
    "currency" = p."currency",
    "interval" = p."interval",
    "trialDays" = p."trialDays"
FROM "plans" AS p
WHERE p."id" = s."planId";

UPDATE "subscriptions"
SET
    "startedAt" = "createdAt",
    "planName" = 'Subscription',
    "planCode" = SUBSTRING("id"::text FROM 1 FOR 8),
    "unitAmountMinor" = 0,
    "currency" = 'USD',
    "interval" = 'MONTH'
WHERE "planName" IS NULL;

UPDATE "subscriptions"
SET "currentPeriodStart" = "startedAt"
WHERE "currentPeriodStart" IS NULL;

UPDATE "subscriptions"
SET "currentPeriodEnd" = CASE
    WHEN "interval" = 'YEAR' THEN "currentPeriodStart" + INTERVAL '1 year'
    ELSE "currentPeriodStart" + INTERVAL '1 month'
END
WHERE "currentPeriodEnd" IS NULL;

ALTER TABLE "subscriptions"
    ALTER COLUMN "startedAt" SET NOT NULL,
    ALTER COLUMN "currentPeriodStart" SET NOT NULL,
    ALTER COLUMN "currentPeriodEnd" SET NOT NULL,
    ALTER COLUMN "planName" SET NOT NULL,
    ALTER COLUMN "planCode" SET NOT NULL,
    ALTER COLUMN "unitAmountMinor" SET NOT NULL,
    ALTER COLUMN "currency" SET NOT NULL,
    ALTER COLUMN "interval" SET NOT NULL;

-- AlterTable
ALTER TABLE "invoices"
    ADD COLUMN "subtotalMinor" INTEGER,
    ADD COLUMN "taxMinor" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "totalMinor" INTEGER,
    ADD COLUMN "amountPaidMinor" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "taxRateBps" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "dueInDays" INTEGER NOT NULL DEFAULT 7,
    ADD COLUMN "periodStart" TIMESTAMPTZ(3),
    ADD COLUMN "periodEnd" TIMESTAMPTZ(3),
    ADD COLUMN "customerName" VARCHAR(160),
    ADD COLUMN "customerEmail" VARCHAR(320),
    ADD COLUMN "customerCompany" VARCHAR(160),
    ADD COLUMN "billingAddressLine1" VARCHAR(160),
    ADD COLUMN "billingAddressLine2" VARCHAR(160),
    ADD COLUMN "billingCity" VARCHAR(100),
    ADD COLUMN "billingRegion" VARCHAR(100),
    ADD COLUMN "billingPostalCode" VARCHAR(40),
    ADD COLUMN "billingCountry" VARCHAR(80),
    ADD COLUMN "voidedAt" TIMESTAMPTZ(3),
    ADD COLUMN "uncollectibleAt" TIMESTAMPTZ(3);

UPDATE "invoices"
SET
    "subtotalMinor" = ROUND("subtotal" * 100)::INTEGER,
    "taxMinor" = ROUND("tax" * 100)::INTEGER,
    "totalMinor" = ROUND("total" * 100)::INTEGER;

ALTER TABLE "invoices"
    ALTER COLUMN "subtotalMinor" SET NOT NULL,
    ALTER COLUMN "totalMinor" SET NOT NULL,
    ALTER COLUMN "issuedAt" DROP NOT NULL,
    ALTER COLUMN "issuedAt" DROP DEFAULT,
    ALTER COLUMN "dueAt" DROP NOT NULL,
    ALTER COLUMN "currency" DROP DEFAULT,
    DROP COLUMN "subtotal",
    DROP COLUMN "tax",
    DROP COLUMN "total";

UPDATE "invoices" AS i
SET
    "customerName" = c."name",
    "customerEmail" = c."email",
    "customerCompany" = c."company",
    "billingAddressLine1" = c."billingAddressLine1",
    "billingAddressLine2" = c."billingAddressLine2",
    "billingCity" = c."billingCity",
    "billingRegion" = c."billingRegion",
    "billingPostalCode" = c."billingPostalCode",
    "billingCountry" = c."billingCountry"
FROM "customers" AS c
WHERE c."id" = i."customerId";

UPDATE "invoices"
SET
    "customerName" = 'Customer',
    "customerEmail" = ''
WHERE "customerName" IS NULL;

ALTER TABLE "invoices"
    ALTER COLUMN "customerName" SET NOT NULL,
    ALTER COLUMN "customerEmail" SET NOT NULL;

-- CreateTable
CREATE TABLE "subscription_activities" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "type" "SubscriptionActivityType" NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "actorId" UUID,
    "actorName" VARCHAR(160),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_counters" (
    "organizationId" UUID NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "invoice_line_items" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitAmountMinor" INTEGER NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_activities" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "type" "InvoiceActivityType" NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "actorId" UUID,
    "actorName" VARCHAR(160),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "source" "PaymentSource" NOT NULL DEFAULT 'MANUAL',
    "reference" VARCHAR(160),
    "note" VARCHAR(500),
    "paidAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "refundedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscriptions_organizationId_customerId_idx" ON "subscriptions"("organizationId", "customerId");
CREATE INDEX "subscriptions_organizationId_currentPeriodEnd_idx" ON "subscriptions"("organizationId", "currentPeriodEnd");
CREATE INDEX "subscription_activities_organizationId_subscriptionId_creat_idx" ON "subscription_activities"("organizationId", "subscriptionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_subscriptionId_periodStart_periodEnd_key" ON "invoices"("subscriptionId", "periodStart", "periodEnd");
CREATE INDEX "invoices_organizationId_customerId_idx" ON "invoices"("organizationId", "customerId");
CREATE INDEX "invoices_organizationId_createdAt_idx" ON "invoices"("organizationId", "createdAt");
CREATE INDEX "invoices_organizationId_periodEnd_idx" ON "invoices"("organizationId", "periodEnd");
CREATE INDEX "invoices_subscriptionId_idx" ON "invoices"("subscriptionId");
CREATE INDEX "invoice_line_items_organizationId_invoiceId_idx" ON "invoice_line_items"("organizationId", "invoiceId");
CREATE INDEX "invoice_activities_organizationId_invoiceId_createdAt_idx" ON "invoice_activities"("organizationId", "invoiceId", "createdAt");
CREATE INDEX "payments_organizationId_invoiceId_createdAt_idx" ON "payments"("organizationId", "invoiceId", "createdAt");
CREATE INDEX "payments_organizationId_status_idx" ON "payments"("organizationId", "status");
CREATE INDEX "payments_invoiceId_idx" ON "payments"("invoiceId");

-- AddForeignKey
ALTER TABLE "subscription_activities" ADD CONSTRAINT "subscription_activities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscription_activities" ADD CONSTRAINT "subscription_activities_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_activities" ADD CONSTRAINT "invoice_activities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_activities" ADD CONSTRAINT "invoice_activities_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Financial invariants are enforced by the database as well as the service.
ALTER TABLE "subscriptions"
    ADD CONSTRAINT "subscriptions_quantity_check" CHECK ("quantity" > 0),
    ADD CONSTRAINT "subscriptions_unit_amount_check" CHECK ("unitAmountMinor" >= 0),
    ADD CONSTRAINT "subscriptions_period_check" CHECK ("currentPeriodEnd" > "currentPeriodStart");

ALTER TABLE "invoice_line_items"
    ADD CONSTRAINT "invoice_line_items_quantity_check" CHECK ("quantity" > 0),
    ADD CONSTRAINT "invoice_line_items_unit_amount_check" CHECK ("unitAmountMinor" >= 0),
    ADD CONSTRAINT "invoice_line_items_total_check" CHECK ("totalMinor" = "quantity" * "unitAmountMinor");

ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_amounts_check" CHECK ("subtotalMinor" >= 0 AND "taxMinor" >= 0 AND "totalMinor" = "subtotalMinor" + "taxMinor"),
    ADD CONSTRAINT "invoices_paid_check" CHECK ("amountPaidMinor" >= 0 AND "amountPaidMinor" <= "totalMinor"),
    ADD CONSTRAINT "invoices_tax_rate_check" CHECK ("taxRateBps" >= 0 AND "taxRateBps" <= 10000),
    ADD CONSTRAINT "invoices_period_check" CHECK (("periodStart" IS NULL AND "periodEnd" IS NULL) OR ("periodStart" IS NOT NULL AND "periodEnd" IS NOT NULL AND "periodEnd" > "periodStart"));

ALTER TABLE "payments"
    ADD CONSTRAINT "payments_amount_check" CHECK ("amountMinor" > 0);
