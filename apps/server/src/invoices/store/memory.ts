import { randomUUID } from "node:crypto";
import type {
  InvoiceSortField,
} from "@subscript/shared";
import { calculateInvoiceTotals } from "@subscript/shared";
import {
  BillingError,
  InvoiceStateConflictError,
  OverpaymentError,
  PaymentStateConflictError,
} from "../../billing/errors.js";
import {
  invoiceStatusForBalance,
  resolveInvoiceAction,
  resolvePaymentTransition,
} from "../../billing/lifecycle.js";
import type {
  BillingActor,
  GenerateInvoiceInput,
  InvoiceListOptions,
  InvoiceListResult,
  InvoiceRecord,
  InvoiceStore,
  PaymentMutationResult,
  PaymentRecord,
  PaymentTransitionInput,
} from "../types.js";

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}

function compareInvoices(
  left: InvoiceRecord,
  right: InvoiceRecord,
  sort: InvoiceSortField,
): number {
  switch (sort) {
    case "number":
      return compareText(left.number, right.number);
    case "customer":
      return compareText(left.customerName, right.customerName);
    case "status":
      return compareText(left.status, right.status);
    case "total":
      return left.totalMinor - right.totalMinor;
    case "dueAt":
      return (left.dueAt?.getTime() ?? 0) - (right.dueAt?.getTime() ?? 0);
    case "createdAt":
      return left.createdAt.getTime() - right.createdAt.getTime();
  }
}

function matchesSearch(invoice: InvoiceRecord, search: string): boolean {
  return [
    invoice.number,
    invoice.customerName,
    invoice.customerEmail,
  ]
    .join(" ")
    .toLowerCase()
    .includes(search);
}

function nextInvoiceNumber(counter: number): string {
  return `INV-${String(counter).padStart(6, "0")}`;
}

function activity(
  invoice: InvoiceRecord,
  type: InvoiceRecord["activities"][number]["type"],
  message: string,
  actor: BillingActor,
): void {
  invoice.activities.unshift({
    id: randomUUID(),
    type,
    message,
    actorName: actor.actorName,
    createdAt: new Date(),
  });
}

export function createMemoryInvoiceStore(): InvoiceStore {
  const invoices = new Map<string, InvoiceRecord>();
  const payments = new Map<string, PaymentRecord>();
  const counters = new Map<string, number>();

  function findScoped(
    organizationId: string,
    invoiceId: string,
  ): InvoiceRecord | null {
    const invoice = invoices.get(invoiceId);

    return invoice?.organizationId === organizationId ? invoice : null;
  }

  function findPaymentScoped(
    organizationId: string,
    paymentId: string,
  ): PaymentRecord | null {
    const payment = payments.get(paymentId);

    return payment?.organizationId === organizationId ? payment : null;
  }

  function findByPeriod(
    organizationId: string,
    subscriptionId: string,
    periodStart: Date,
    periodEnd: Date,
  ): InvoiceRecord | null {
    return (
      [...invoices.values()].find(
        (invoice) =>
          invoice.organizationId === organizationId &&
          invoice.subscriptionId === subscriptionId &&
          invoice.periodStart?.getTime() === periodStart.getTime() &&
          invoice.periodEnd?.getTime() === periodEnd.getTime(),
      ) ?? null
    );
  }

  return {
    async list(
      organizationId,
      options: InvoiceListOptions,
    ): Promise<InvoiceListResult> {
      const search = options.search?.toLowerCase() ?? null;
      const filtered = [...invoices.values()].filter(
        (invoice) =>
          invoice.organizationId === organizationId &&
          (options.status === "ALL" || invoice.status === options.status) &&
          (!options.subscriptionId ||
            invoice.subscriptionId === options.subscriptionId) &&
          (!options.customerId || invoice.customerId === options.customerId) &&
          (!search || matchesSearch(invoice, search)),
      );
      const direction = options.direction === "asc" ? 1 : -1;

      filtered.sort(
        (left, right) =>
          compareInvoices(left, right, options.sort) * direction ||
          left.id.localeCompare(right.id),
      );

      const start = (options.page - 1) * options.pageSize;

      return {
        items: filtered.slice(start, start + options.pageSize),
        total: filtered.length,
      };
    },

    async findById(organizationId, invoiceId) {
      return findScoped(organizationId, invoiceId);
    },

    async findPaymentById(organizationId, paymentId) {
      return findPaymentScoped(organizationId, paymentId);
    },

    async listBySubscription(organizationId, subscriptionId) {
      return [...invoices.values()]
        .filter(
          (invoice) =>
            invoice.organizationId === organizationId &&
            invoice.subscriptionId === subscriptionId,
        )
        .sort(
          (left, right) =>
            (right.periodStart?.getTime() ?? 0) -
              (left.periodStart?.getTime() ?? 0) ||
            right.createdAt.getTime() - left.createdAt.getTime(),
        );
    },

    async generate(input: GenerateInvoiceInput) {
      const existing = findByPeriod(
        input.organizationId,
        input.subscriptionId,
        input.periodStart,
        input.periodEnd,
      );

      if (existing) {
        return { invoice: existing, created: false };
      }

      if (input.periodEnd.getTime() <= input.periodStart.getTime()) {
        throw new BillingError("The billing period end must follow its start.");
      }

      const subtotalMinor = input.quantity * input.unitAmountMinor;

      if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor < 0) {
        throw new BillingError("The invoice subtotal is outside the supported range.");
      }

      const totals = calculateInvoiceTotals(subtotalMinor, input.taxRateBps);
      const counter = counters.get(input.organizationId) ?? 1;
      counters.set(input.organizationId, counter + 1);
      const now = new Date();
      const invoiceId = randomUUID();

      const invoice: InvoiceRecord = {
        id: invoiceId,
        organizationId: input.organizationId,
        customerId: input.customerId,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerCompany: input.customerCompany,
        billingAddress: { ...input.billingAddress },
        subscriptionId: input.subscriptionId,
        number: nextInvoiceNumber(counter),
        status: "DRAFT",
        currency: input.currency,
        subtotalMinor: totals.subtotalMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        amountPaidMinor: 0,
        taxRateBps: input.taxRateBps,
        dueInDays: input.dueInDays,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        issuedAt: null,
        dueAt: null,
        paidAt: null,
        voidedAt: null,
        uncollectibleAt: null,
        lineItems: [
          {
            id: randomUUID(),
            description: input.lineDescription,
            quantity: input.quantity,
            unitAmountMinor: input.unitAmountMinor,
            totalMinor: subtotalMinor,
          },
        ],
        activities: [],
        payments: [],
        createdAt: now,
        updatedAt: now,
      };

      invoices.set(invoice.id, invoice);
      activity(
        invoice,
        "CREATED",
        `Generated invoice ${invoice.number} for the billing period.`,
        input.actor,
      );

      return { invoice, created: true };
    },

    async applyAction(organizationId, invoiceId, action, actor) {
      const invoice = findScoped(organizationId, invoiceId);

      if (!invoice) {
        throw new InvoiceStateConflictError(
          "That invoice could not be found in this workspace.",
        );
      }

      const transition = resolveInvoiceAction(
        invoice.status,
        action,
        invoice.amountPaidMinor,
      );
      const now = new Date();

      invoice.status = transition.status;
      invoice.updatedAt = now;

      if (action === "issue") {
        invoice.issuedAt = now;
        invoice.dueAt = new Date(
          now.getTime() + invoice.dueInDays * 24 * 60 * 60 * 1000,
        );
        activity(invoice, "ISSUED", "Issued this invoice.", actor);
      } else if (action === "void") {
        invoice.voidedAt = now;
        activity(invoice, "VOIDED", "Voided this invoice.", actor);
      } else {
        invoice.uncollectibleAt = now;
        activity(
          invoice,
          "MARKED_UNCOLLECTIBLE",
          "Marked this invoice uncollectible.",
          actor,
        );
      }

      return invoice;
    },

    async recordPayment(input) {
      const invoice = findScoped(input.organizationId, input.invoiceId);

      if (!invoice) {
        throw new PaymentStateConflictError(
          "That invoice could not be found in this workspace.",
        );
      }

      if (invoice.status !== "OPEN") {
        throw new PaymentStateConflictError(
          invoice.status === "PAID"
            ? "This invoice is already paid in full."
            : `Payments can only be recorded against open invoices. This invoice is ${invoice.status}.`,
        );
      }

      if (input.amountMinor > invoice.totalMinor - invoice.amountPaidMinor) {
        throw new OverpaymentError();
      }

      const now = new Date();
      const payment: PaymentRecord = {
        id: randomUUID(),
        organizationId: input.organizationId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        subscriptionId: invoice.subscriptionId,
        amountMinor: input.amountMinor,
        currency: invoice.currency,
        method: input.method,
        status: input.status,
        source: "MANUAL",
        reference: input.reference,
        note: input.note,
        paidAt: input.status === "SUCCEEDED" ? now : null,
        failedAt: null,
        refundedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      payments.set(payment.id, payment);
      invoice.payments.unshift(payment);
      invoice.updatedAt = now;

      if (payment.status === "SUCCEEDED") {
        invoice.amountPaidMinor += payment.amountMinor;
        const next = invoiceStatusForBalance(
          invoice.totalMinor,
          invoice.amountPaidMinor,
        );
        invoice.status = next.status;
        invoice.paidAt = next.paidAt;
        activity(
          invoice,
          "PAYMENT_SUCCEEDED",
          `Recorded a manual ${invoice.currency} payment of ${payment.amountMinor} minor units.`,
          input.actor,
        );
      } else {
        activity(
          invoice,
          "PAYMENT_RECORDED",
          `Recorded a pending manual payment of ${payment.amountMinor} ${invoice.currency} minor units.`,
          input.actor,
        );
      }

      return { payment, invoice };
    },

    async transitionPayment(input: PaymentTransitionInput) {
      const payment = findPaymentScoped(
        input.organizationId,
        input.paymentId,
      );

      if (!payment) {
        throw new PaymentStateConflictError(
          "That payment could not be found in this workspace.",
        );
      }

      const nextStatus = resolvePaymentTransition(
        payment.status,
        input.action,
      );
      const invoice = findScoped(input.organizationId, payment.invoiceId);

      if (!invoice) {
        throw new PaymentStateConflictError(
          "The invoice for this payment could not be found.",
        );
      }

      const now = new Date();

      if (input.action === "succeed") {
        if (payment.amountMinor > invoice.totalMinor - invoice.amountPaidMinor) {
          throw new OverpaymentError();
        }

        payment.status = nextStatus;
        payment.paidAt = now;
        payment.updatedAt = now;
        invoice.amountPaidMinor += payment.amountMinor;
        const next = invoiceStatusForBalance(
          invoice.totalMinor,
          invoice.amountPaidMinor,
        );
        invoice.status = next.status;
        invoice.paidAt = next.paidAt;
        invoice.updatedAt = now;
        activity(
          invoice,
          "PAYMENT_SUCCEEDED",
          `Confirmed a manual payment of ${payment.amountMinor} ${invoice.currency} minor units.`,
          input.actor,
        );
      } else if (input.action === "fail") {
        payment.status = nextStatus;
        payment.failedAt = now;
        payment.updatedAt = now;
        invoice.updatedAt = now;
        activity(
          invoice,
          "PAYMENT_FAILED",
          "Marked a manual payment attempt as failed.",
          input.actor,
        );
      } else {
        payment.status = nextStatus;
        payment.refundedAt = now;
        payment.updatedAt = now;
        invoice.amountPaidMinor -= payment.amountMinor;
        invoice.status = invoice.amountPaidMinor >= invoice.totalMinor
          ? "PAID"
          : "OPEN";
        invoice.paidAt = invoice.status === "PAID" ? now : null;
        invoice.updatedAt = now;
        activity(
          invoice,
          "PAYMENT_REFUNDED",
          `Refunded a manual payment of ${payment.amountMinor} ${invoice.currency} minor units.`,
          input.actor,
        );
      }

      return { payment, invoice } satisfies PaymentMutationResult;
    },

    async listPaymentsForSubscription(organizationId, subscriptionId) {
      return [...payments.values()]
        .filter(
          (payment) =>
            payment.organizationId === organizationId &&
            payment.subscriptionId === subscriptionId,
        )
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime(),
        );
    },

    async sumOutstandingBySubscriptions(organizationId, subscriptionIds) {
      const ids = new Set(subscriptionIds);
      const outstanding = new Map<string, number>();

      for (const invoice of invoices.values()) {
        if (
          invoice.organizationId !== organizationId ||
          invoice.status !== "OPEN" ||
          !invoice.subscriptionId ||
          !ids.has(invoice.subscriptionId)
        ) {
          continue;
        }

        outstanding.set(
          invoice.subscriptionId,
          (outstanding.get(invoice.subscriptionId) ?? 0) +
            (invoice.totalMinor - invoice.amountPaidMinor),
        );
      }

      return outstanding;
    },
  };
}
