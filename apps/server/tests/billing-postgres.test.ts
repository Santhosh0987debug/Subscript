import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { OverpaymentError, PaymentStateConflictError } from "../src/billing/errors.js";
import { createPrismaClient } from "../src/db/prisma.js";
import { createPrismaInvoiceStore } from "../src/invoices/store/prisma.js";
import type { GenerateInvoiceInput } from "../src/invoices/types.js";

/**
 * Real-PostgreSQL checks for the transaction and uniqueness paths that the
 * in-memory store cannot prove. Enabled only when TEST_DATABASE_URL points at
 * a disposable database; never run this against a shared application database.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("billing PostgreSQL store", () => {
  const prisma = createPrismaClient(databaseUrl ?? "");
  const invoiceStore = createPrismaInvoiceStore(prisma);
  const organizationIds: string[] = [];

  afterAll(async () => {
    for (const organizationId of organizationIds) {
      await prisma.payment.deleteMany({ where: { organizationId } });
      await prisma.invoice.deleteMany({ where: { organizationId } });
      await prisma.subscription.deleteMany({ where: { organizationId } });
      await prisma.customer.deleteMany({ where: { organizationId } });
      await prisma.plan.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }

    await prisma.$disconnect();
  });

  async function createFixtures() {
    const organizationId = randomUUID();
    const customerId = randomUUID();
    const planId = randomUUID();
    const subscriptionId = randomUUID();
    const periodStart = new Date("2026-01-01T00:00:00.000Z");
    const periodEnd = new Date("2026-02-01T00:00:00.000Z");

    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "PostgreSQL Test Workspace",
        slug: `pg-${organizationId}`,
        defaultCurrency: "USD",
      },
    });
    await prisma.customer.create({
      data: {
        id: customerId,
        organizationId,
        name: "PostgreSQL Customer",
        email: `pg-${customerId}@example.test`,
      },
    });
    await prisma.plan.create({
      data: {
        id: planId,
        organizationId,
        name: "PostgreSQL Plan",
        code: `pg-${planId}`,
        amountMinor: 2_900,
        currency: "USD",
        interval: "MONTH",
        trialDays: 0,
      },
    });
    await prisma.subscription.create({
      data: {
        id: subscriptionId,
        organizationId,
        customerId,
        planId,
        status: "ACTIVE",
        quantity: 1,
        startedAt: periodStart,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        planName: "PostgreSQL Plan",
        planCode: `pg-${planId}`,
        unitAmountMinor: 2_900,
        currency: "USD",
        interval: "MONTH",
        trialDays: 0,
      },
    });
    organizationIds.push(organizationId);

    return {
      organizationId,
      customerId,
      subscriptionId,
      periodStart,
      periodEnd,
    };
  }

  function invoiceInput(
    fixtures: Awaited<ReturnType<typeof createFixtures>>,
  ): GenerateInvoiceInput {
    return {
      organizationId: fixtures.organizationId,
      subscriptionId: fixtures.subscriptionId,
      customerId: fixtures.customerId,
      customerName: "PostgreSQL Customer",
      customerEmail: "pg@example.test",
      customerCompany: null,
      billingAddress: {
        line1: "1 Database Way",
        line2: "",
        city: "Postgres",
        region: "CA",
        postalCode: "94105",
        country: "United States",
      },
      periodStart: fixtures.periodStart,
      periodEnd: fixtures.periodEnd,
      quantity: 1,
      unitAmountMinor: 2_900,
      currency: "USD",
      lineDescription: "PostgreSQL Plan",
      taxRateBps: 0,
      dueInDays: 7,
      actor: { actorId: null, actorName: "PostgreSQL test" },
    };
  }

  it("generates exactly one invoice for concurrent duplicate requests", async () => {
    const fixtures = await createFixtures();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        invoiceStore.generate(invoiceInput(fixtures)),
      ),
    );

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.invoice.id)).size).toBe(1);
    expect(results[0]?.invoice.number).toBe("INV-000001");

    const invoices = await prisma.invoice.findMany({
      where: { organizationId: fixtures.organizationId },
    });
    expect(invoices).toHaveLength(1);
  });

  it("serializes concurrent payments so the balance never overpays", async () => {
    const fixtures = await createFixtures();
    const generated = await invoiceStore.generate(invoiceInput(fixtures));
    const invoice = await invoiceStore.applyAction(
      fixtures.organizationId,
      generated.invoice.id,
      "issue",
      { actorId: null, actorName: "PostgreSQL test" },
    );

    expect(invoice.status).toBe("OPEN");

    const attempts = await Promise.allSettled([
      invoiceStore.recordPayment({
        organizationId: fixtures.organizationId,
        invoiceId: invoice.id,
        amountMinor: 2_000,
        method: "CARD",
        reference: null,
        note: null,
        status: "SUCCEEDED",
        actor: { actorId: null, actorName: "PostgreSQL test" },
      }),
      invoiceStore.recordPayment({
        organizationId: fixtures.organizationId,
        invoiceId: invoice.id,
        amountMinor: 2_000,
        method: "CARD",
        reference: null,
        note: null,
        status: "SUCCEEDED",
        actor: { actorId: null, actorName: "PostgreSQL test" },
      }),
    ]);

    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    const rejected = attempts.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(OverpaymentError);

    const refreshed = await invoiceStore.findById(
      fixtures.organizationId,
      invoice.id,
    );
    expect(refreshed?.amountPaidMinor).toBe(2_000);
    expect(refreshed?.status).toBe("OPEN");
  });

  it("serializes concurrent confirmations of pending payments", async () => {
    const fixtures = await createFixtures();
    const generated = await invoiceStore.generate(invoiceInput(fixtures));
    const invoice = await invoiceStore.applyAction(
      fixtures.organizationId,
      generated.invoice.id,
      "issue",
      { actorId: null, actorName: "PostgreSQL test" },
    );
    const actor = { actorId: null, actorName: "PostgreSQL test" };
    const first = await invoiceStore.recordPayment({
      organizationId: fixtures.organizationId,
      invoiceId: invoice.id,
      amountMinor: 2_000,
      method: "BANK_TRANSFER",
      reference: null,
      note: null,
      status: "PENDING",
      actor,
    });
    const second = await invoiceStore.recordPayment({
      organizationId: fixtures.organizationId,
      invoiceId: invoice.id,
      amountMinor: 2_000,
      method: "BANK_TRANSFER",
      reference: null,
      note: null,
      status: "PENDING",
      actor,
    });

    const confirmations = await Promise.allSettled([
      invoiceStore.transitionPayment({
        organizationId: fixtures.organizationId,
        paymentId: first.payment.id,
        action: "succeed",
        actor,
      }),
      invoiceStore.transitionPayment({
        organizationId: fixtures.organizationId,
        paymentId: second.payment.id,
        action: "succeed",
        actor,
      }),
    ]);

    expect(
      confirmations.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = confirmations.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(OverpaymentError);

    const refreshed = await invoiceStore.findById(
      fixtures.organizationId,
      invoice.id,
    );
    expect(refreshed?.amountPaidMinor).toBe(2_000);
    expect(refreshed?.status).toBe("OPEN");
  });

  it("keeps invoice and payment queries organization scoped", async () => {
    const fixtures = await createFixtures();
    const other = await createFixtures();
    const generated = await invoiceStore.generate(invoiceInput(fixtures));

    expect(
      await invoiceStore.findById(other.organizationId, generated.invoice.id),
    ).toBeNull();
    expect(
      await invoiceStore.list(other.organizationId, {
        search: null,
        status: "ALL",
        subscriptionId: null,
        customerId: null,
        sort: "createdAt",
        direction: "desc",
        page: 1,
        pageSize: 10,
      }),
    ).toMatchObject({ total: 0 });

    await expect(
      invoiceStore.recordPayment({
        organizationId: other.organizationId,
        invoiceId: generated.invoice.id,
        amountMinor: 100,
        method: "CASH",
        reference: null,
        note: null,
        status: "SUCCEEDED",
        actor: { actorId: null, actorName: "PostgreSQL test" },
      }),
    ).rejects.toBeInstanceOf(PaymentStateConflictError);
  });
});
