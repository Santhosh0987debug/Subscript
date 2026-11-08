import { randomUUID } from "node:crypto";
import type {
  BillingActor,
  InvoiceRecord,
  PaymentRecord,
} from "../../src/invoices/types.js";
import type {
  CreateSubscriptionInput,
  SubscriptionRecord,
} from "../../src/subscriptions/types.js";
import type { AutomationJobRecord } from "../../src/automation/types.js";
import type { TestApp } from "./test-app.js";

const DAY_MS = 86_400_000;

export const AUTOMATION_TEST_ACTOR: BillingActor = {
  actorId: null,
  actorName: "Automation Test",
};

export function automationOrganizationName(organizationId: string): string {
  return `Automation Test ${organizationId.slice(0, 8)}`;
}

export async function createAutomationSubscription(
  test: TestApp,
  organizationId: string,
  overrides: Partial<CreateSubscriptionInput> = {},
): Promise<SubscriptionRecord> {
  const now = Date.now();
  const currentPeriodStart = new Date(now - 30 * DAY_MS);
  const currentPeriodEnd = new Date(now + 5 * DAY_MS);
  const startedAt = overrides.startedAt ?? currentPeriodStart;

  return test.subscriptionStore.create({
    organizationId,
    customerId: randomUUID(),
    customerName: "Acme Industries",
    customerEmail: "billing@acme.test",
    planId: randomUUID(),
    planName: "Growth",
    planCode: `growth-${randomUUID().slice(0, 8)}`,
    quantity: 2,
    unitAmountMinor: 2_900,
    currency: "USD",
    interval: "MONTH",
    trialDays: 0,
    status: "ACTIVE",
    startedAt,
    trialEndsAt: null,
    currentPeriodStart,
    currentPeriodEnd,
    canceledAt: null,
    activity: {
      type: "CREATED",
      message: "Created by an automation test.",
      actorId: null,
      actorName: AUTOMATION_TEST_ACTOR.actorName,
    },
    trialActivity: null,
    ...overrides,
  });
}

export function seedAutomationSubscription(
  test: TestApp,
  subscription: SubscriptionRecord,
): void {
  test.automationCandidates.seedSubscription({
    organizationId: subscription.organizationId,
    organizationName: automationOrganizationName(subscription.organizationId),
    subscriptionId: subscription.id,
    customerId: subscription.customerId,
    customerName: subscription.customerName,
    customerEmail: subscription.customerEmail,
    planName: subscription.planName,
    status: subscription.status,
    quantity: subscription.quantity,
    unitAmountMinor: subscription.unitAmountMinor,
    currency: subscription.currency,
    interval: subscription.interval,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    trialEndsAt: subscription.trialEndsAt,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
  });
}

export async function createAutomationInvoice(
  test: TestApp,
  subscription: SubscriptionRecord,
  options: {
    issue?: boolean;
    periodStart?: Date;
    periodEnd?: Date;
  } = {},
): Promise<InvoiceRecord> {
  const generated = await test.invoiceStore.generate({
    organizationId: subscription.organizationId,
    subscriptionId: subscription.id,
    customerId: subscription.customerId,
    customerName: subscription.customerName,
    customerEmail: subscription.customerEmail,
    customerCompany: null,
    billingAddress: {
      line1: "1 Market Street",
      line2: "Suite 400",
      city: "San Francisco",
      region: "CA",
      postalCode: "94105",
      country: "United States",
    },
    periodStart: options.periodStart ?? subscription.currentPeriodStart,
    periodEnd: options.periodEnd ?? subscription.currentPeriodEnd,
    quantity: subscription.quantity,
    unitAmountMinor: subscription.unitAmountMinor,
    currency: subscription.currency,
    lineDescription: `${subscription.planName} billing period`,
    taxRateBps: 0,
    dueInDays: 7,
    actor: AUTOMATION_TEST_ACTOR,
  });

  if (options.issue === false) {
    return generated.invoice;
  }

  return test.invoiceStore.applyAction(
    subscription.organizationId,
    generated.invoice.id,
    "issue",
    AUTOMATION_TEST_ACTOR,
  );
}

export async function createFailedGatewayPayment(
  test: TestApp,
  subscription: SubscriptionRecord,
  invoice: InvoiceRecord,
): Promise<PaymentRecord> {
  const provider = "razorpay";
  const reservation = await test.invoiceStore.reserveGatewayCheckout({
    organizationId: subscription.organizationId,
    invoiceId: invoice.id,
    provider,
    actor: AUTOMATION_TEST_ACTOR,
    staleAfterMs: 0,
  });

  await test.invoiceStore.attachGatewayOrder({
    organizationId: subscription.organizationId,
    paymentId: reservation.payment.id,
    provider,
    gatewayOrderId: `order_${randomUUID()}`,
    gatewayStatus: "created",
    metadata: {},
  });

  return test.invoiceStore.failGatewayPayment({
    organizationId: subscription.organizationId,
    paymentId: reservation.payment.id,
    provider,
    gatewayStatus: "failed",
    message: "The test card was declined.",
    actor: AUTOMATION_TEST_ACTOR,
  });
}

export function seedFailedPayment(
  test: TestApp,
  subscription: SubscriptionRecord,
  invoice: InvoiceRecord,
  payment: PaymentRecord,
): void {
  test.automationCandidates.seedFailedPayment({
    organizationId: subscription.organizationId,
    organizationName: automationOrganizationName(subscription.organizationId),
    paymentId: payment.id,
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    subscriptionId: subscription.id,
    customerId: subscription.customerId,
    customerName: subscription.customerName,
    customerEmail: subscription.customerEmail,
    planName: subscription.planName,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    failedAt: payment.failedAt ?? new Date(),
  });
}

export async function listAutomationJobs(
  test: TestApp,
  organizationId: string,
): Promise<AutomationJobRecord[]> {
  const result = await test.automationStore.listJobs(organizationId, {
    status: "ALL",
    type: "ALL",
    page: 1,
    pageSize: 100,
  });

  return result.items;
}

export async function findAutomationJob(
  test: TestApp,
  organizationId: string,
  type: AutomationJobRecord["type"],
): Promise<AutomationJobRecord | undefined> {
  return (await listAutomationJobs(test, organizationId)).find(
    (job) => job.type === type,
  );
}
