-- CreateIndex
CREATE INDEX "invoices_organizationId_issuedAt_idx" ON "invoices"("organizationId", "issuedAt");

-- CreateIndex
CREATE INDEX "invoices_organizationId_dueAt_idx" ON "invoices"("organizationId", "dueAt");

-- CreateIndex
CREATE INDEX "payment_refunds_organizationId_processedAt_idx" ON "payment_refunds"("organizationId", "processedAt");

-- CreateIndex
CREATE INDEX "payments_organizationId_paidAt_idx" ON "payments"("organizationId", "paidAt");

-- CreateIndex
CREATE INDEX "payments_organizationId_refundedAt_idx" ON "payments"("organizationId", "refundedAt");

-- CreateIndex
CREATE INDEX "subscriptions_organizationId_startedAt_idx" ON "subscriptions"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "subscriptions_organizationId_endedAt_idx" ON "subscriptions"("organizationId", "endedAt");

-- CreateIndex
CREATE INDEX "subscriptions_organizationId_canceledAt_idx" ON "subscriptions"("organizationId", "canceledAt");
