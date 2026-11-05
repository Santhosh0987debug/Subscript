import type {
  Invoice,
  InvoiceActivity,
  InvoiceLineItem,
  InvoiceSummary,
  Payment,
  PaymentRefund,
} from "@subscript/shared";
import type {
  InvoiceActivityRecord,
  InvoiceRecord,
  PaymentRecord,
  PaymentRefundRecord,
} from "./types.js";

function money(amountMinor: number, currency: string) {
  return { amountMinor, currency };
}

export function toInvoiceSummary(invoice: InvoiceRecord): InvoiceSummary {
  return {
    id: invoice.id,
    organizationId: invoice.organizationId,
    customerId: invoice.customerId,
    customerName: invoice.customerName,
    subscriptionId: invoice.subscriptionId,
    number: invoice.number,
    status: invoice.status,
    subtotal: money(invoice.subtotalMinor, invoice.currency),
    tax: money(invoice.taxMinor, invoice.currency),
    total: money(invoice.totalMinor, invoice.currency),
    amountPaid: money(invoice.amountPaidMinor, invoice.currency),
    amountDue: money(
      Math.max(invoice.totalMinor - invoice.amountPaidMinor, 0),
      invoice.currency,
    ),
    taxRateBps: invoice.taxRateBps,
    periodStart: invoice.periodStart?.toISOString() ?? null,
    periodEnd: invoice.periodEnd?.toISOString() ?? null,
    issuedAt: invoice.issuedAt?.toISOString() ?? null,
    dueAt: invoice.dueAt?.toISOString() ?? null,
    paidAt: invoice.paidAt?.toISOString() ?? null,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
  };
}

export function toInvoiceLineItem(
  item: InvoiceRecord["lineItems"][number],
): InvoiceLineItem {
  return {
    id: item.id,
    description: item.description,
    quantity: item.quantity,
    unitAmountMinor: item.unitAmountMinor,
    totalMinor: item.totalMinor,
  };
}

export function toInvoiceActivity(
  activity: InvoiceActivityRecord,
): InvoiceActivity {
  return {
    id: activity.id,
    type: activity.type,
    message: activity.message,
    actorName: activity.actorName,
    createdAt: activity.createdAt.toISOString(),
  };
}

export function toPaymentRefund(refund: PaymentRefundRecord): PaymentRefund {
  return {
    id: refund.id,
    paymentId: refund.paymentId,
    provider: refund.provider,
    providerRefundId: refund.providerRefundId,
    amount: money(refund.amountMinor, refund.currency),
    status: refund.status,
    reason: refund.reason,
    processedAt: refund.processedAt?.toISOString() ?? null,
    failedAt: refund.failedAt?.toISOString() ?? null,
    createdAt: refund.createdAt.toISOString(),
    updatedAt: refund.updatedAt.toISOString(),
  };
}

export function toPayment(payment: PaymentRecord): Payment {
  return {
    id: payment.id,
    organizationId: payment.organizationId,
    invoiceId: payment.invoiceId,
    invoiceNumber: payment.invoiceNumber,
    subscriptionId: payment.subscriptionId,
    amount: money(payment.amountMinor, payment.currency),
    method: payment.method,
    status: payment.status,
    source: payment.source,
    reference: payment.reference,
    note: payment.note,
    gateway: payment.gatewayProvider
      ? {
          provider: payment.gatewayProvider,
          orderId: payment.gatewayOrderId,
          paymentId: payment.gatewayPaymentId,
          status: payment.gatewayStatus,
        }
      : null,
    refundedAmount: money(payment.refundedAmountMinor, payment.currency),
    refunds: payment.refunds.map(toPaymentRefund),
    paidAt: payment.paidAt?.toISOString() ?? null,
    failedAt: payment.failedAt?.toISOString() ?? null,
    refundedAt: payment.refundedAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}

export function toInvoice(invoice: InvoiceRecord): Invoice {
  return {
    ...toInvoiceSummary(invoice),
    customer: {
      name: invoice.customerName,
      email: invoice.customerEmail,
      company: invoice.customerCompany ?? "",
      billingAddress: { ...invoice.billingAddress },
    },
    lineItems: invoice.lineItems.map(toInvoiceLineItem),
    activities: invoice.activities.map(toInvoiceActivity),
    payments: invoice.payments.map(toPayment),
  };
}
