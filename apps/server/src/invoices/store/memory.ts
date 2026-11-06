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
  ApplyGatewayRefundInput,
  AttachGatewayOrderInput,
  BillingActor,
  ConfirmGatewayPaymentInput,
  CreateGatewayCheckoutInput,
  FailGatewayPaymentInput,
  GenerateInvoiceInput,
  InvoiceListOptions,
  InvoiceListResult,
  InvoiceRecord,
  InvoiceStore,
  PaymentMutationResult,
  PaymentRecord,
  PaymentRefundRecord,
  PaymentTransitionInput,
  ReserveGatewayRefundInput,
} from "../types.js";
import type { NormalizedGatewayWebhookEvent } from "../../gateway/types.js";

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

  function findPaymentByGateway(input: {
    provider: string;
    orderId: string | null;
    paymentId: string | null;
    internalPaymentId?: string | null;
  }): PaymentRecord | null {
    const internal = input.internalPaymentId
      ? payments.get(input.internalPaymentId)
      : null;

    if (
      internal &&
      internal.source === "GATEWAY" &&
      internal.gatewayProvider === input.provider &&
      (!input.orderId || internal.gatewayOrderId === input.orderId) &&
      (!input.paymentId || internal.gatewayPaymentId === input.paymentId)
    ) {
      return internal;
    }

    return (
      [...payments.values()].find(
        (payment) =>
          payment.source === "GATEWAY" &&
          payment.gatewayProvider === input.provider &&
          ((input.orderId !== null &&
            payment.gatewayOrderId === input.orderId) ||
            (input.paymentId !== null &&
              payment.gatewayPaymentId === input.paymentId)),
      ) ?? null
    );
  }

  function findRefundScoped(
    organizationId: string,
    refundId: string,
  ): PaymentRefundRecord | null {
    for (const payment of payments.values()) {
      if (payment.organizationId !== organizationId) {
        continue;
      }

      const refund = payment.refunds.find((entry) => entry.id === refundId);

      if (refund) {
        return refund;
      }
    }

    return null;
  }

  function findRefundByProvider(
    provider: string,
    providerRefundId: string,
  ): PaymentRefundRecord | null {
    for (const payment of payments.values()) {
      const refund = payment.refunds.find(
        (entry) =>
          entry.provider === provider &&
          entry.providerRefundId === providerRefundId,
      );

      if (refund) {
        return refund;
      }
    }

    return null;
  }

  function pendingRefundMinor(payment: PaymentRecord): number {
    return payment.refunds
      .filter((refund) => refund.status === "PENDING")
      .reduce((total, refund) => total + refund.amountMinor, 0);
  }

  function gatewayActor(provider: string): BillingActor {
    return { actorId: null, actorName: `${provider} webhook` };
  }

  function applyRefundSuccess(
    refund: PaymentRefundRecord,
    payment: PaymentRecord,
    invoice: InvoiceRecord,
    actor: BillingActor,
    now: Date,
  ): void {
    if (
      refund.status === "SUCCEEDED" ||
      payment.refundedAmountMinor + refund.amountMinor > payment.amountMinor
    ) {
      return;
    }

    if (payment.refundedAmountMinor + refund.amountMinor < 0) {
      throw new BillingError("The refund would make the payment negative.");
    }

    refund.status = "SUCCEEDED";
    refund.processedAt = now;
    refund.failedAt = null;
    refund.updatedAt = now;
    payment.refundedAmountMinor += refund.amountMinor;
    payment.refundedAt =
      payment.refundedAmountMinor >= payment.amountMinor ? now : null;
    payment.status =
      payment.refundedAmountMinor >= payment.amountMinor
        ? "REFUNDED"
        : "SUCCEEDED";
    payment.updatedAt = now;

    const amountPaidMinor = invoice.amountPaidMinor - refund.amountMinor;

    if (amountPaidMinor < 0) {
      throw new BillingError("The refund would make the invoice negative.");
    }

    const next = invoiceStatusForBalance(invoice.totalMinor, amountPaidMinor);

    invoice.amountPaidMinor = amountPaidMinor;
    invoice.status = next.status;
    invoice.paidAt = next.paidAt;
    invoice.updatedAt = now;
    activity(
      invoice,
      "PAYMENT_REFUNDED",
      `Refunded ${refund.amountMinor} ${invoice.currency} minor units through ${refund.provider}.`,
      actor,
    );
  }

  function failRefund(
    refund: PaymentRefundRecord,
    invoice: InvoiceRecord,
    actor: BillingActor,
    now: Date,
  ): void {
    if (refund.status === "SUCCEEDED" || refund.status === "FAILED") {
      return;
    }

    refund.status = "FAILED";
    refund.failedAt = now;
    refund.updatedAt = now;
    invoice.updatedAt = now;
    activity(
      invoice,
      "PAYMENT_REFUND_FAILED",
      `A ${refund.amountMinor} ${invoice.currency} minor-unit refund through ${refund.provider} failed.`,
      actor,
    );
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
        gatewayProvider: null,
        gatewayOrderId: null,
        gatewayPaymentId: null,
        gatewayStatus: null,
        gatewayMetadata: null,
        refundedAmountMinor: 0,
        refunds: [],
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

      if (payment.source === "GATEWAY") {
        throw new PaymentStateConflictError(
          "Gateway payments are reconciled from verified provider events and cannot be changed manually.",
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
        payment.refundedAmountMinor = payment.amountMinor;
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

    async reserveGatewayCheckout(input: CreateGatewayCheckoutInput) {
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
            : `Checkout is only available for open invoices. This invoice is ${invoice.status}.`,
        );
      }

      const amountDue = invoice.totalMinor - invoice.amountPaidMinor;

      if (amountDue <= 0) {
        throw new PaymentStateConflictError(
          "This invoice has no outstanding balance.",
        );
      }

      const now = new Date();
      const existing = invoice.payments.find(
        (payment) =>
          payment.source === "GATEWAY" &&
          payment.gatewayProvider === input.provider &&
          payment.status === "PENDING",
      );

      if (existing) {
        if (now.getTime() - existing.updatedAt.getTime() < input.staleAfterMs) {
          throw new PaymentStateConflictError(
            "A gateway checkout is already in progress for this invoice. Finish or close it before starting another.",
          );
        }

        existing.status = "FAILED";
        existing.failedAt = now;
        existing.gatewayStatus = "abandoned";
        existing.updatedAt = now;
        activity(
          invoice,
          "PAYMENT_FAILED",
          "Expired an abandoned gateway checkout attempt.",
          input.actor,
        );
      }

      const payment: PaymentRecord = {
        id: randomUUID(),
        organizationId: input.organizationId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        subscriptionId: invoice.subscriptionId,
        amountMinor: amountDue,
        currency: invoice.currency,
        method: "CARD",
        status: "PENDING",
        source: "GATEWAY",
        reference: null,
        note: null,
        gatewayProvider: input.provider,
        gatewayOrderId: null,
        gatewayPaymentId: null,
        gatewayStatus: "created",
        gatewayMetadata: null,
        refundedAmountMinor: 0,
        refunds: [],
        paidAt: null,
        failedAt: null,
        refundedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      payments.set(payment.id, payment);
      invoice.payments.unshift(payment);
      invoice.updatedAt = now;
      activity(
        invoice,
        "PAYMENT_RECORDED",
        `Started a ${input.provider} checkout for ${amountDue} ${invoice.currency} minor units.`,
        input.actor,
      );

      return { payment, invoice };
    },

    async attachGatewayOrder(input: AttachGatewayOrderInput) {
      const payment = findPaymentScoped(
        input.organizationId,
        input.paymentId,
      );

      if (!payment) {
        throw new PaymentStateConflictError(
          "That payment could not be found in this workspace.",
        );
      }

      if (
        payment.source !== "GATEWAY" ||
        payment.gatewayProvider !== input.provider
      ) {
        throw new PaymentStateConflictError(
          "This payment does not belong to the configured gateway.",
        );
      }

      if (
        payment.gatewayOrderId &&
        payment.gatewayOrderId !== input.gatewayOrderId
      ) {
        throw new PaymentStateConflictError(
          "This payment already belongs to a different gateway order.",
        );
      }

      if (payment.status !== "PENDING") {
        if (
          payment.gatewayOrderId === input.gatewayOrderId &&
          (payment.status === "SUCCEEDED" || payment.status === "REFUNDED")
        ) {
          return payment;
        }

        throw new PaymentStateConflictError(
          "This payment attempt is no longer accepting a gateway order.",
        );
      }

      payment.gatewayOrderId = input.gatewayOrderId;
      payment.gatewayStatus = input.gatewayStatus;
      payment.gatewayMetadata = input.metadata;
      payment.updatedAt = new Date();

      return payment;
    },

    async failGatewayPayment(input: FailGatewayPaymentInput) {
      const payment = findPaymentScoped(
        input.organizationId,
        input.paymentId,
      );

      if (!payment) {
        throw new PaymentStateConflictError(
          "That payment could not be found in this workspace.",
        );
      }

      if (
        payment.source !== "GATEWAY" ||
        payment.gatewayProvider !== input.provider
      ) {
        throw new PaymentStateConflictError(
          "This payment does not belong to the configured gateway.",
        );
      }

      if (payment.status === "SUCCEEDED" || payment.status === "REFUNDED") {
        return payment;
      }

      if (payment.status === "FAILED") {
        return payment;
      }

      const invoice = findScoped(input.organizationId, payment.invoiceId);
      const now = new Date();

      payment.status = "FAILED";
      payment.failedAt = now;
      payment.gatewayStatus = input.gatewayStatus;
      payment.updatedAt = now;

      if (invoice) {
        invoice.updatedAt = now;
        activity(
          invoice,
          "PAYMENT_FAILED",
          input.message,
          input.actor,
        );
      }

      return payment;
    },

    async confirmGatewayPayment(input: ConfirmGatewayPaymentInput) {
      const payment = findPaymentScoped(
        input.organizationId,
        input.paymentId,
      );

      if (!payment) {
        throw new PaymentStateConflictError(
          "That payment could not be found in this workspace.",
        );
      }

      if (
        payment.source !== "GATEWAY" ||
        payment.gatewayProvider !== input.provider
      ) {
        throw new PaymentStateConflictError(
          "This payment does not belong to the configured gateway.",
        );
      }

      const invoice = findScoped(input.organizationId, payment.invoiceId);

      if (!invoice) {
        throw new PaymentStateConflictError(
          "The invoice for this payment could not be found.",
        );
      }

      if (payment.gatewayOrderId !== input.gatewayOrderId) {
        throw new PaymentStateConflictError(
          "The gateway order does not match this payment attempt.",
        );
      }

      if (
        payment.gatewayPaymentId &&
        payment.gatewayPaymentId !== input.gatewayPaymentId &&
        payment.status !== "FAILED"
      ) {
        throw new PaymentStateConflictError(
          "This payment attempt is already linked to a different gateway payment.",
        );
      }

      if (payment.status === "SUCCEEDED" || payment.status === "REFUNDED") {
        return { payment, invoice } satisfies PaymentMutationResult;
      }

      if (input.amountMinor !== payment.amountMinor) {
        throw new PaymentStateConflictError(
          "The captured amount does not match the reserved payment amount.",
        );
      }

      if (input.currency !== payment.currency) {
        throw new PaymentStateConflictError(
          "The captured currency does not match the invoice currency.",
        );
      }

      if (invoice.status !== "OPEN") {
        throw new PaymentStateConflictError(
          `This payment cannot be applied because the invoice is ${invoice.status}.`,
        );
      }

      if (payment.amountMinor > invoice.totalMinor - invoice.amountPaidMinor) {
        throw new OverpaymentError();
      }

      const now = new Date();

      payment.status = "SUCCEEDED";
      payment.gatewayPaymentId = input.gatewayPaymentId;
      payment.gatewayStatus = input.gatewayStatus;
      payment.paidAt = now;
      payment.failedAt = null;
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
        `Confirmed a ${input.provider} payment of ${payment.amountMinor} ${invoice.currency} minor units.`,
        input.actor,
      );

      return { payment, invoice } satisfies PaymentMutationResult;
    },

    async reserveGatewayRefund(input: ReserveGatewayRefundInput) {
      const payment = findPaymentScoped(
        input.organizationId,
        input.paymentId,
      );

      if (!payment) {
        throw new PaymentStateConflictError(
          "That payment could not be found in this workspace.",
        );
      }

      const invoice = findScoped(input.organizationId, payment.invoiceId);

      if (!invoice) {
        throw new PaymentStateConflictError(
          "The invoice for this payment could not be found.",
        );
      }

      if (
        payment.source !== "GATEWAY" ||
        payment.gatewayProvider !== input.provider
      ) {
        throw new PaymentStateConflictError(
          "This payment does not belong to the configured gateway.",
        );
      }

      if (!payment.gatewayPaymentId) {
        throw new PaymentStateConflictError(
          "This payment has not been captured by the gateway yet.",
        );
      }

      if (payment.status !== "SUCCEEDED" && payment.status !== "REFUNDED") {
        throw new PaymentStateConflictError(
          "Only succeeded gateway payments can be refunded.",
        );
      }

      const availableMinor =
        payment.amountMinor -
        payment.refundedAmountMinor -
        pendingRefundMinor(payment);

      if (input.amountMinor <= 0) {
        throw new PaymentStateConflictError(
          "Enter a refund amount greater than zero.",
        );
      }

      if (input.amountMinor > availableMinor) {
        throw new PaymentStateConflictError(
          "This refund would exceed the refundable amount.",
        );
      }

      const now = new Date();
      const refund: PaymentRefundRecord = {
        id: randomUUID(),
        organizationId: input.organizationId,
        invoiceId: invoice.id,
        paymentId: payment.id,
        provider: input.provider,
        providerRefundId: null,
        amountMinor: input.amountMinor,
        currency: payment.currency,
        status: "PENDING",
        reason: input.reason,
        processedAt: null,
        failedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      payment.refunds.unshift(refund);
      payment.updatedAt = now;
      invoice.updatedAt = now;
      activity(
        invoice,
        "PAYMENT_REFUND_REQUESTED",
        `Requested a ${input.amountMinor} ${invoice.currency} minor-unit refund through ${input.provider}.`,
        input.actor,
      );

      return { payment, invoice, refund };
    },

    async applyGatewayRefund(input: ApplyGatewayRefundInput) {
      const refund = findRefundScoped(input.organizationId, input.refundId);

      if (!refund) {
        throw new PaymentStateConflictError(
          "That refund could not be found in this workspace.",
        );
      }

      if (refund.provider !== input.provider) {
        throw new PaymentStateConflictError(
          "This refund does not belong to the configured gateway.",
        );
      }

      if (
        input.providerRefundId &&
        refund.providerRefundId &&
        input.providerRefundId !== refund.providerRefundId
      ) {
        throw new PaymentStateConflictError(
          "This refund is already linked to a different gateway refund.",
        );
      }

      if (input.providerRefundId) {
        const duplicate = findRefundByProvider(
          input.provider,
          input.providerRefundId,
        );

        if (duplicate && duplicate.id !== refund.id) {
          throw new PaymentStateConflictError(
            "That gateway refund is already linked to another payment.",
          );
        }
      }

      const payment = findPaymentScoped(
        input.organizationId,
        refund.paymentId,
      );
      const invoice = findScoped(input.organizationId, refund.invoiceId);

      if (!payment || !invoice) {
        throw new PaymentStateConflictError(
          "The payment for this refund could not be found.",
        );
      }

      if (refund.status === "SUCCEEDED") {
        return { payment, invoice, refund };
      }

      if (refund.status === "FAILED" && input.status !== "FAILED") {
        return { payment, invoice, refund };
      }

      if (input.status === "PENDING") {
        refund.providerRefundId =
          input.providerRefundId ?? refund.providerRefundId;
        refund.updatedAt = new Date();
        return { payment, invoice, refund };
      }

      const now = new Date();

      refund.providerRefundId =
        input.providerRefundId ?? refund.providerRefundId;

      if (input.status === "FAILED") {
        failRefund(refund, invoice, input.actor, now);
        payment.updatedAt = now;
        return { payment, invoice, refund };
      }

      if (payment.status !== "SUCCEEDED" && payment.status !== "REFUNDED") {
        throw new PaymentStateConflictError(
          "The payment is not in a refundable state.",
        );
      }

      if (refund.currency !== payment.currency) {
        throw new PaymentStateConflictError(
          "The refund currency does not match the payment.",
        );
      }

      if (payment.refundedAmountMinor + refund.amountMinor > payment.amountMinor) {
        throw new PaymentStateConflictError(
          "This refund would exceed the captured amount.",
        );
      }

      applyRefundSuccess(
        refund,
        payment,
        invoice,
        input.actor,
        now,
      );

      return { payment, invoice, refund };
    },

    async processGatewayEvent(event: NormalizedGatewayWebhookEvent) {
      if (event.kind === "unsupported") {
        return {
          outcome: "ignored",
          organizationId: null,
          paymentId: null,
        } as const;
      }

      if (event.kind === "payment") {
        const payment = findPaymentByGateway({
          provider: event.provider,
          orderId: event.gatewayOrderId,
          paymentId: event.gatewayPaymentId,
          internalPaymentId: event.internalPaymentId,
        });

        if (!payment) {
          return {
            outcome: "ignored",
            organizationId: null,
            paymentId: null,
          } as const;
        }

        const invoice = findScoped(payment.organizationId, payment.invoiceId);

        if (!invoice) {
          return {
            outcome: "ignored",
            organizationId: payment.organizationId,
            paymentId: payment.id,
          } as const;
        }

        if (
          payment.source !== "GATEWAY" ||
          payment.gatewayProvider !== event.provider ||
          (payment.gatewayOrderId &&
            event.gatewayOrderId &&
            payment.gatewayOrderId !== event.gatewayOrderId) ||
          (payment.gatewayPaymentId &&
            payment.gatewayPaymentId !== event.gatewayPaymentId &&
            payment.status !== "FAILED") ||
          event.amountMinor !== payment.amountMinor ||
          event.currency !== payment.currency
        ) {
          return {
            outcome: "ignored",
            organizationId: payment.organizationId,
            paymentId: payment.id,
          } as const;
        }

        const actor = gatewayActor(event.provider);
        const now = new Date();

        if (event.eventType === "payment.failed") {
          if (payment.status === "SUCCEEDED" || payment.status === "REFUNDED") {
            return {
              outcome: "ignored",
              organizationId: payment.organizationId,
              paymentId: payment.id,
            } as const;
          }

          if (payment.status === "FAILED") {
            payment.gatewayStatus = event.gatewayStatus;
            payment.updatedAt = now;
            return {
              outcome: "ignored",
              organizationId: payment.organizationId,
              paymentId: payment.id,
            } as const;
          }

          payment.status = "FAILED";
          payment.gatewayPaymentId = event.gatewayPaymentId;
          payment.gatewayStatus = event.gatewayStatus;
          payment.failedAt = now;
          payment.updatedAt = now;
          invoice.updatedAt = now;
          activity(
            invoice,
            "PAYMENT_FAILED",
            `The ${event.provider} payment attempt failed. The invoice balance is unchanged.`,
            actor,
          );

          return {
            outcome: "applied",
            organizationId: payment.organizationId,
            paymentId: payment.id,
          } as const;
        }

        if (payment.status === "SUCCEEDED" || payment.status === "REFUNDED") {
          return {
            outcome: "ignored",
            organizationId: payment.organizationId,
            paymentId: payment.id,
          } as const;
        }

        if (invoice.status !== "OPEN") {
          return {
            outcome: "ignored",
            organizationId: payment.organizationId,
            paymentId: payment.id,
          } as const;
        }

        if (payment.amountMinor > invoice.totalMinor - invoice.amountPaidMinor) {
          return {
            outcome: "ignored",
            organizationId: payment.organizationId,
            paymentId: payment.id,
          } as const;
        }

        payment.status = "SUCCEEDED";
        payment.gatewayPaymentId = event.gatewayPaymentId;
        payment.gatewayStatus = event.gatewayStatus;
        payment.paidAt = now;
        payment.failedAt = null;
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
          `Confirmed a ${event.provider} payment of ${payment.amountMinor} ${invoice.currency} minor units from a verified webhook.`,
          actor,
        );

        return {
          outcome: "applied",
          organizationId: payment.organizationId,
          paymentId: payment.id,
        } as const;
      }

      let refund = findRefundByProvider(
        event.provider,
        event.gatewayRefundId,
      );

      if (!refund && event.internalRefundId) {
        for (const candidate of payments.values()) {
          const match = candidate.refunds.find(
            (entry) => entry.id === event.internalRefundId,
          );

          if (match) {
            refund = match;
            break;
          }
        }
      }

      if (refund && refund.provider !== event.provider) {
        refund = null;
      }

      const payment = refund
        ? payments.get(refund.paymentId) ?? null
        : findPaymentByGateway({
            provider: event.provider,
            orderId: null,
            paymentId: event.gatewayPaymentId,
            internalPaymentId: null,
          });

      if (!payment) {
        return {
          outcome: "ignored",
          organizationId: null,
          paymentId: null,
        } as const;
      }

      const invoice = findScoped(payment.organizationId, payment.invoiceId);

      if (!invoice) {
        return {
          outcome: "ignored",
          organizationId: payment.organizationId,
          paymentId: payment.id,
        } as const;
      }

      if (
        payment.source !== "GATEWAY" ||
        payment.gatewayProvider !== event.provider ||
        (payment.gatewayPaymentId &&
          payment.gatewayPaymentId !== event.gatewayPaymentId)
      ) {
        return {
          outcome: "ignored",
          organizationId: payment.organizationId,
          paymentId: payment.id,
        } as const;
      }

      if (
        refund &&
        (refund.currency !== event.currency ||
          refund.amountMinor !== event.amountMinor)
      ) {
        return {
          outcome: "ignored",
          organizationId: payment.organizationId,
          paymentId: payment.id,
        } as const;
      }

      const actor = gatewayActor(event.provider);
      const now = new Date();

      if (!refund) {
        if (event.eventType === "refund.failed") {
          return {
            outcome: "ignored",
            organizationId: payment.organizationId,
            paymentId: payment.id,
          } as const;
        }

        refund = payment.refunds.find(
          (entry) =>
            entry.status === "PENDING" &&
            entry.amountMinor === event.amountMinor &&
            entry.currency === event.currency &&
            (!entry.providerRefundId ||
              entry.providerRefundId === event.gatewayRefundId),
        ) ?? null;

        if (!refund) {
          const availableMinor =
            payment.amountMinor -
            payment.refundedAmountMinor -
            pendingRefundMinor(payment);

          if (
            (payment.status !== "SUCCEEDED" &&
              payment.status !== "REFUNDED") ||
            event.amountMinor <= 0 ||
            event.amountMinor > availableMinor
          ) {
            return {
              outcome: "ignored",
              organizationId: payment.organizationId,
              paymentId: payment.id,
            } as const;
          }

          refund = {
            id: randomUUID(),
            organizationId: payment.organizationId,
            invoiceId: payment.invoiceId,
            paymentId: payment.id,
            provider: event.provider,
            providerRefundId: event.gatewayRefundId,
            amountMinor: event.amountMinor,
            currency: event.currency,
            status: "PENDING",
            reason: event.reason,
            processedAt: null,
            failedAt: null,
            createdAt: now,
            updatedAt: now,
          };
          payment.refunds.unshift(refund);
          payment.updatedAt = now;
          invoice.updatedAt = now;
          activity(
            invoice,
            "PAYMENT_REFUND_REQUESTED",
            `A ${event.amountMinor} ${invoice.currency} minor-unit refund was created through ${event.provider}.`,
            actor,
          );
        }
      }

      if (refund.providerRefundId === null) {
        refund.providerRefundId = event.gatewayRefundId;
      } else if (refund.providerRefundId !== event.gatewayRefundId) {
        return {
          outcome: "ignored",
          organizationId: payment.organizationId,
          paymentId: payment.id,
        } as const;
      }

      if (event.eventType === "refund.created") {
        if (refund.status !== "PENDING") {
          return {
            outcome: "ignored",
            organizationId: payment.organizationId,
            paymentId: payment.id,
          } as const;
        }

        if (!refund.reason && event.reason) {
          refund.reason = event.reason;
        }

        refund.updatedAt = now;
        return {
          outcome: "applied",
          organizationId: payment.organizationId,
          paymentId: payment.id,
        } as const;
      }

      if (event.eventType === "refund.failed") {
        if (refund.status !== "PENDING") {
          return {
            outcome: "ignored",
            organizationId: payment.organizationId,
            paymentId: payment.id,
          } as const;
        }

        failRefund(refund, invoice, actor, now);
        payment.updatedAt = now;
        return {
          outcome: "applied",
          organizationId: payment.organizationId,
          paymentId: payment.id,
        } as const;
      }

      if (refund.status === "FAILED" || refund.status === "SUCCEEDED") {
        return {
          outcome: "ignored",
          organizationId: payment.organizationId,
          paymentId: payment.id,
        } as const;
      }

      if (payment.status !== "SUCCEEDED" && payment.status !== "REFUNDED") {
        return {
          outcome: "ignored",
          organizationId: payment.organizationId,
          paymentId: payment.id,
        } as const;
      }

      if (
        payment.refundedAmountMinor + refund.amountMinor >
        payment.amountMinor
      ) {
        return {
          outcome: "ignored",
          organizationId: payment.organizationId,
          paymentId: payment.id,
        } as const;
      }

      applyRefundSuccess(refund, payment, invoice, actor, now);

      return {
        outcome: "applied",
        organizationId: payment.organizationId,
        paymentId: payment.id,
      } as const;
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
