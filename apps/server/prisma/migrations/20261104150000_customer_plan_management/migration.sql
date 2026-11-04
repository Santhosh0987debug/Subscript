-- CreateEnum
CREATE TYPE "CustomerActivityType" AS ENUM ('CREATED', 'UPDATED', 'ARCHIVED', 'RESTORED');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- AlterTable
ALTER TABLE "customers"
    ADD COLUMN "phone" VARCHAR(40),
    ADD COLUMN "company" VARCHAR(160),
    ADD COLUMN "billingAddressLine1" VARCHAR(160),
    ADD COLUMN "billingAddressLine2" VARCHAR(160),
    ADD COLUMN "billingCity" VARCHAR(100),
    ADD COLUMN "billingRegion" VARCHAR(100),
    ADD COLUMN "billingPostalCode" VARCHAR(40),
    ADD COLUMN "billingCountry" VARCHAR(80),
    ADD COLUMN "notes" TEXT;

-- CreateTable
CREATE TABLE "customer_activities" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "type" "CustomerActivityType" NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "actorId" UUID,
    "actorName" VARCHAR(160),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_activities_pkey" PRIMARY KEY ("id")
);

-- AlterTable
-- Money is stored in integer minor units so currencies with 0 or 3 decimal
-- places are represented without a hardcoded two-decimal assumption. Existing
-- plan amounts were captured in major units and are converted once here.
ALTER TABLE "plans"
    ADD COLUMN "amountMinor" INTEGER,
    ADD COLUMN "trialDays" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE';

UPDATE "plans"
SET "amountMinor" = ROUND("amount" * 100)::INTEGER;

UPDATE "plans"
SET "status" = 'ARCHIVED'
WHERE "active" = false;

ALTER TABLE "plans"
    ALTER COLUMN "amountMinor" SET NOT NULL,
    DROP COLUMN "active",
    DROP COLUMN "amount";

-- CreateIndex
CREATE INDEX "customers_organizationId_name_idx" ON "customers"("organizationId", "name");

-- CreateIndex
CREATE INDEX "customers_organizationId_createdAt_idx" ON "customers"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_activities_organizationId_customerId_createdAt_idx" ON "customer_activities"("organizationId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "plans_organizationId_status_idx" ON "plans"("organizationId", "status");

-- CreateIndex
CREATE INDEX "plans_organizationId_name_idx" ON "plans"("organizationId", "name");

-- CreateIndex
CREATE INDEX "plans_organizationId_createdAt_idx" ON "plans"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "customer_activities" ADD CONSTRAINT "customer_activities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_activities" ADD CONSTRAINT "customer_activities_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
