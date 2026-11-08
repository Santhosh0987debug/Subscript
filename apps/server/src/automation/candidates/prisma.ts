import type { PrismaClient } from "../../generated/prisma/client.js";
import type {
  AutomationCandidateSource,
  AutomationPaymentFailureCandidate,
  AutomationPaymentSucceededEvent,
  AutomationRefundEvent,
  AutomationSubscriptionCandidate,
} from "../types.js";

const invoiceContextInclude = {
  subscription: { select: { planName: true } },
  organization: { select: { name: true } },
} as const;

export function createPrismaAutomationCandidateSource(
  prisma: PrismaClient,
): AutomationCandidateSource {
  return {
    async listOrganizationIds() {
      const organizations = await prisma.organization.findMany({
        where: { subscriptions: { some: {} } },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });

      return organizations.map((organization) => organization.id);
    },

    async getOrganizationName(organizationId) {
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      });

      return organization?.name ?? null;
    },

    async listSubscriptionsForAutomation(
      organizationId,
    ): Promise<AutomationSubscriptionCandidate[]> {
      const subscriptions = await prisma.subscription.findMany({
        where: {
          organizationId,
          status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "PAUSED"] },
        },
        include: {
          customer: { select: { name: true, email: true } },
          organization: { select: { name: true } },
        },
        orderBy: [{ currentPeriodEnd: "asc" }, { id: "asc" }],
      });

      return subscriptions.map((subscription) => ({
        organizationId: subscription.organizationId,
        organizationName: subscription.organization.name,
        subscriptionId: subscription.id,
        customerId: subscription.customerId,
        customerName: subscription.customer.name,
        customerEmail: subscription.customer.email,
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
      }));
    },

    async listFailedPayments(
      organizationId,
      since,
    ): Promise<AutomationPaymentFailureCandidate[]> {
      const payments = await prisma.payment.findMany({
        where: {
          organizationId,
          status: "FAILED",
          failedAt: { gte: since },
          invoice: { status: "OPEN", subscriptionId: { not: null } },
        },
        include: {
          invoice: { include: invoiceContextInclude },
        },
        orderBy: [{ failedAt: "asc" }, { id: "asc" }],
      });

      return payments.map((payment) => ({
        organizationId: payment.organizationId,
        organizationName: payment.invoice.organization.name,
        paymentId: payment.id,
        invoiceId: payment.invoiceId,
        invoiceNumber: payment.invoice.number,
        subscriptionId: payment.invoice.subscriptionId ?? "",
        customerId: payment.invoice.customerId,
        customerName: payment.invoice.customerName,
        customerEmail: payment.invoice.customerEmail,
        planName: payment.invoice.subscription?.planName ?? "Subscription",
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        failedAt: payment.failedAt ?? payment.updatedAt,
      }));
    },

    async listRecentSucceededPayments(
      organizationId,
      since,
    ): Promise<AutomationPaymentSucceededEvent[]> {
      const payments = await prisma.payment.findMany({
        where: {
          organizationId,
          status: "SUCCEEDED",
          paidAt: { gte: since },
          invoice: { subscriptionId: { not: null } },
        },
        include: {
          invoice: { include: invoiceContextInclude },
        },
        orderBy: [{ paidAt: "asc" }, { id: "asc" }],
      });

      return payments.map((payment) => ({
        organizationId: payment.organizationId,
        organizationName: payment.invoice.organization.name,
        paymentId: payment.id,
        invoiceId: payment.invoiceId,
        invoiceNumber: payment.invoice.number,
        subscriptionId: payment.invoice.subscriptionId ?? "",
        customerId: payment.invoice.customerId,
        customerName: payment.invoice.customerName,
        customerEmail: payment.invoice.customerEmail,
        planName: payment.invoice.subscription?.planName ?? "Subscription",
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        paidAt: payment.paidAt ?? payment.updatedAt,
      }));
    },

    async listRecentRefundUpdates(
      organizationId,
      since,
    ): Promise<AutomationRefundEvent[]> {
      const refunds = await prisma.paymentRefund.findMany({
        where: {
          organizationId,
          status: { in: ["SUCCEEDED", "FAILED"] },
          updatedAt: { gte: since },
          invoice: { subscriptionId: { not: null } },
        },
        include: {
          invoice: {
            include: {
              subscription: { select: { planName: true } },
              organization: { select: { name: true } },
            },
          },
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      });

      return refunds.map((refund) => ({
        organizationId: refund.organizationId,
        organizationName: refund.invoice.organization.name,
        refundId: refund.id,
        paymentId: refund.paymentId,
        invoiceId: refund.invoiceId,
        invoiceNumber: refund.invoice.number,
        subscriptionId: refund.invoice.subscriptionId ?? "",
        customerId: refund.invoice.customerId,
        customerName: refund.invoice.customerName,
        customerEmail: refund.invoice.customerEmail,
        amountMinor: refund.amountMinor,
        currency: refund.currency,
        status: refund.status === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
        reason: refund.reason,
        updatedAt: refund.updatedAt,
      }));
    },
  };
}
