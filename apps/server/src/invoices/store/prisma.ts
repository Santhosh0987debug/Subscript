import type {
  InvoiceStatus,
  Payment as PaymentModel,
  PaymentRefund as PaymentRefundModel,
  PaymentRefundStatus,
  Prisma,
  PrismaClient,
} from "../../generated/prisma/client.js";
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
  InvoiceActivityRecord,
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

const invoiceInclude = {
  lineItems: { orderBy: { position: "asc" } },
  activities: { orderBy: { createdAt: "desc" } },
  payments: {
    orderBy: { createdAt: "desc" },
    include: { refunds: { orderBy: { createdAt: "desc" } } },
  },
} satisfies Prisma.InvoiceInclude;

type InvoiceRow = Prisma.InvoiceGetPayload<{
  include: typeof invoiceInclude;
}>;

const paymentInclude = {
  invoice: { select: { number: true, subscriptionId: true } },
  refunds: { orderBy: { createdAt: "desc" } },
} satisfies Prisma.PaymentInclude;

type PaymentRow = Prisma.PaymentGetPayload<{
  include: typeof paymentInclude;
}>;

type PaymentWithRefunds = PaymentModel & {
  refunds: PaymentRefundModel[];
};

interface LockedInvoice {
  id: string;
  status: string;
  totalMinor: number;
  amountPaidMinor: number;
  dueInDays: number;
  currency: string;
  number: string;
  subscriptionId: string | null;
}

interface LockedPayment {
  id: string;
  organizationId: string;
  status: string;
  amountMinor: number;
  currency: string;
  invoiceId: string;
  source: string;
  refundedAmountMinor: number;
  gatewayProvider: string | null;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  failedAt: Date | null;
  paidAt: Date | null;
  refundedAt: Date | null;
  updatedAt: Date;
}

interface LockedRefund {
  id: string;
  organizationId: string;
  invoiceId: string;
  paymentId: string;
  provider: string;
  providerRefundId: string | null;
  amountMinor: number;
  currency: string;
  status: string;
  reason: string | null;
  processedAt: Date | null;
  failedAt: Date | null;
}

function mapRefund(refund: PaymentRefundModel): PaymentRefundRecord {
  return {
    id: refund.id,
    organizationId: refund.organizationId,
    invoiceId: refund.invoiceId,
    paymentId: refund.paymentId,
    provider: refund.provider,
    providerRefundId: refund.providerRefundId,
    amountMinor: refund.amountMinor,
    currency: refund.currency,
    status: refund.status,
    reason: refund.reason,
    processedAt: refund.processedAt,
    failedAt: refund.failedAt,
    createdAt: refund.createdAt,
    updatedAt: refund.updatedAt,
  };
}

function mapPayment(
  payment: PaymentWithRefunds,
  invoiceNumber: string,
  subscriptionId: string | null,
): PaymentRecord {
  return {
    id: payment.id,
    organizationId: payment.organizationId,
    invoiceId: payment.invoiceId,
    invoiceNumber,
    subscriptionId,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    method: payment.method,
    status: payment.status,
    source: payment.source,
    reference: payment.reference,
    note: payment.note,
    gatewayProvider: payment.gatewayProvider,
    gatewayOrderId: payment.gatewayOrderId,
    gatewayPaymentId: payment.gatewayPaymentId,
    gatewayStatus: payment.gatewayStatus,
    gatewayMetadata: payment.gatewayMetadata,
    refundedAmountMinor: payment.refundedAmountMinor,
    refunds: payment.refunds.map(mapRefund),
    paidAt: payment.paidAt,
    failedAt: payment.failedAt,
    refundedAt: payment.refundedAt,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

function mapPaymentRow(payment: PaymentRow): PaymentRecord {
  return mapPayment(
    payment,
    payment.invoice.number,
    payment.invoice.subscriptionId,
  );
}

function mapInvoice(invoice: InvoiceRow): InvoiceRecord {
  return {
    id: invoice.id,
    organizationId: invoice.organizationId,
    customerId: invoice.customerId,
    customerName: invoice.customerName,
    customerEmail: invoice.customerEmail,
    customerCompany: invoice.customerCompany,
    billingAddress: {
      line1: invoice.billingAddressLine1 ?? "",
      line2: invoice.billingAddressLine2 ?? "",
      city: invoice.billingCity ?? "",
      region: invoice.billingRegion ?? "",
      postalCode: invoice.billingPostalCode ?? "",
      country: invoice.billingCountry ?? "",
    },
    subscriptionId: invoice.subscriptionId,
    number: invoice.number,
    status: invoice.status,
    currency: invoice.currency,
    subtotalMinor: invoice.subtotalMinor,
    taxMinor: invoice.taxMinor,
    totalMinor: invoice.totalMinor,
    amountPaidMinor: invoice.amountPaidMinor,
    taxRateBps: invoice.taxRateBps,
    dueInDays: invoice.dueInDays,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    issuedAt: invoice.issuedAt,
    dueAt: invoice.dueAt,
    paidAt: invoice.paidAt,
    voidedAt: invoice.voidedAt,
    uncollectibleAt: invoice.uncollectibleAt,
    lineItems: invoice.lineItems.map((item) => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unitAmountMinor: item.unitAmountMinor,
      totalMinor: item.totalMinor,
    })),
    activities: invoice.activities.map(
      (entry): InvoiceActivityRecord => ({
        id: entry.id,
        type: entry.type,
        message: entry.message,
        actorName: entry.actorName,
        createdAt: entry.createdAt,
      }),
    ),
    payments: invoice.payments.map((payment) =>
      mapPayment(payment, invoice.number, invoice.subscriptionId),
    ),
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  };
}

function orderBy(
  options: InvoiceListOptions,
): Prisma.InvoiceOrderByWithRelationInput {
  switch (options.sort) {
    case "customer":
      return { customerName: options.direction };
    case "total":
      return { totalMinor: options.direction };
    default:
      return { [options.sort]: options.direction };
  }
}

interface PrismaErrorDetails {
  code?: unknown;
  meta?: {
    driverAdapterError?: {
      cause?: {
        kind?: unknown;
      };
    };
  };
}

function getPrismaErrorDetails(error: unknown): PrismaErrorDetails | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  return error as PrismaErrorDetails;
}

/**
 * The driver adapter exposes the unique constraint inside
 * `meta.driverAdapterError`; older Prisma versions populated `meta.target`
 * instead. Generation treats any unique violation as a possible duplicate
 * period and re-reads the period afterward, so the constraint shape does not
 * need to be parsed here.
 */
function isUniqueViolation(error: unknown): boolean {
  return getPrismaErrorDetails(error)?.code === "P2002";
}

function isRetryableWriteConflict(error: unknown): boolean {
  const details = getPrismaErrorDetails(error);

  if (details?.code === "P2034") {
    return true;
  }

  return (
    details?.meta?.driverAdapterError?.cause?.kind === "TransactionWriteConflict"
  );
}

type InvoiceActivityKind =
  | "CREATED"
  | "ISSUED"
  | "VOIDED"
  | "MARKED_UNCOLLECTIBLE"
  | "PAYMENT_RECORDED"
  | "PAYMENT_SUCCEEDED"
  | "PAYMENT_FAILED"
  | "PAYMENT_REFUND_REQUESTED"
  | "PAYMENT_REFUNDED"
  | "PAYMENT_REFUND_FAILED";

function invoiceActivityFields(
  organizationId: string,
  type: InvoiceActivityKind,
  message: string,
  actor: BillingActor,
) {
  return {
    organizationId,
    type,
    message,
    actorId: actor.actorId,
    actorName: actor.actorName,
  };
}

function invoiceActivityData(
  organizationId: string,
  invoiceId: string,
  type: InvoiceActivityKind,
  message: string,
  actor: BillingActor,
) {
  return {
    ...invoiceActivityFields(organizationId, type, message, actor),
    invoiceId,
  };
}

async function loadPaymentRecord(
  tx: Prisma.TransactionClient,
  paymentId: string,
  invoiceNumber: string,
  subscriptionId: string | null,
): Promise<PaymentRecord> {
  const payment = await tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: { refunds: { orderBy: { createdAt: "desc" } } },
  });

  return mapPayment(payment, invoiceNumber, subscriptionId);
}

async function loadRefundRecord(
  tx: Prisma.TransactionClient,
  refundId: string,
): Promise<PaymentRefundRecord> {
  const refund = await tx.paymentRefund.findUniqueOrThrow({
    where: { id: refundId },
  });

  return mapRefund(refund);
}

function gatewayMetadata(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function lockInvoiceRow(
  tx: Prisma.TransactionClient,
  organizationId: string,
  invoiceId: string,
): Promise<LockedInvoice | null> {
  const rows = await tx.$queryRaw<Array<LockedInvoice>>`
    SELECT "id", "status", "totalMinor", "amountPaidMinor", "dueInDays",
           "currency", "number", "subscriptionId"
    FROM "invoices"
    WHERE "id" = ${invoiceId} AND "organizationId" = ${organizationId}
    FOR UPDATE
  `;

  return rows[0] ?? null;
}

async function lockPaymentRow(
  tx: Prisma.TransactionClient,
  organizationId: string,
  paymentId: string,
): Promise<LockedPayment | null> {
  const rows = await tx.$queryRaw<Array<LockedPayment>>`
    SELECT "id", "organizationId", "status", "amountMinor", "currency",
           "invoiceId", "source", "refundedAmountMinor", "gatewayProvider",
           "gatewayOrderId", "gatewayPaymentId", "failedAt", "paidAt",
           "refundedAt", "updatedAt"
    FROM "payments"
    WHERE "id" = ${paymentId} AND "organizationId" = ${organizationId}
    FOR UPDATE
  `;

  return rows[0] ?? null;
}

export function createPrismaInvoiceStore(
  prisma: PrismaClient,
): InvoiceStore {
  return {
    async list(
      organizationId,
      options: InvoiceListOptions,
    ): Promise<InvoiceListResult> {
      const where: Prisma.InvoiceWhereInput = {
        organizationId,
        ...(options.status === "ALL" ? {} : { status: options.status }),
        ...(options.subscriptionId
          ? { subscriptionId: options.subscriptionId }
          : {}),
        ...(options.customerId ? { customerId: options.customerId } : {}),
        ...(options.search
          ? {
              OR: [
                {
                  number: {
                    contains: options.search,
                    mode: "insensitive",
                  },
                },
                {
                  customerName: {
                    contains: options.search,
                    mode: "insensitive",
                  },
                },
                {
                  customerEmail: {
                    contains: options.search,
                    mode: "insensitive",
                  },
                },
              ],
            }
          : {}),
      };
      const skip = (options.page - 1) * options.pageSize;
      const [items, total] = await prisma.$transaction([
        prisma.invoice.findMany({
          where,
          include: invoiceInclude,
          orderBy: [orderBy(options), { id: "asc" }],
          skip,
          take: options.pageSize,
        }),
        prisma.invoice.count({ where }),
      ]);

      return { items: items.map(mapInvoice), total };
    },

    async findById(organizationId, invoiceId) {
      const invoice = await prisma.invoice.findFirst({
        where: { id: invoiceId, organizationId },
        include: invoiceInclude,
      });

      return invoice ? mapInvoice(invoice) : null;
    },

    async findPaymentById(organizationId, paymentId) {
      const payment = await prisma.payment.findFirst({
        where: { id: paymentId, organizationId },
        include: paymentInclude,
      });

      return payment ? mapPaymentRow(payment) : null;
    },

    async listBySubscription(organizationId, subscriptionId) {
      const invoices = await prisma.invoice.findMany({
        where: { organizationId, subscriptionId },
        include: invoiceInclude,
        orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
      });

      return invoices.map(mapInvoice);
    },

    async generate(input: GenerateInvoiceInput) {
      const findExisting = () =>
        prisma.invoice.findFirst({
          where: {
            organizationId: input.organizationId,
            subscriptionId: input.subscriptionId,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
          },
          include: invoiceInclude,
        });

      const existing = await findExisting();

      if (existing) {
        return { invoice: mapInvoice(existing), created: false };
      }

      const subtotalMinor = input.quantity * input.unitAmountMinor;

      if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor < 0) {
        throw new BillingError(
          "The invoice subtotal is outside the supported range.",
        );
      }

      const totals = calculateInvoiceTotals(subtotalMinor, input.taxRateBps);
      const maxAttempts = 3;

      for (let attempt = 1; ; attempt += 1) {
        try {
          const invoice = await prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<Array<{ number: number }>>`
              INSERT INTO "invoice_counters" ("organizationId", "nextNumber")
              VALUES (${input.organizationId}, 2)
              ON CONFLICT ("organizationId") DO UPDATE
              SET "nextNumber" = "invoice_counters"."nextNumber" + 1
              RETURNING "nextNumber" - 1 AS "number"
            `;
            const counter = rows[0]?.number;

            if (!counter || counter < 1) {
              throw new BillingError(
                "An invoice number could not be allocated.",
              );
            }

            const number = `INV-${String(counter).padStart(6, "0")}`;
            const created = await tx.invoice.create({
              data: {
                organizationId: input.organizationId,
                customerId: input.customerId,
                subscriptionId: input.subscriptionId,
                number,
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
                customerName: input.customerName,
                customerEmail: input.customerEmail,
                customerCompany: input.customerCompany,
                billingAddressLine1: input.billingAddress.line1 || null,
                billingAddressLine2: input.billingAddress.line2 || null,
                billingCity: input.billingAddress.city || null,
                billingRegion: input.billingAddress.region || null,
                billingPostalCode: input.billingAddress.postalCode || null,
                billingCountry: input.billingAddress.country || null,
                lineItems: {
                  create: [
                    {
                      organizationId: input.organizationId,
                      description: input.lineDescription,
                      quantity: input.quantity,
                      unitAmountMinor: input.unitAmountMinor,
                      totalMinor: subtotalMinor,
                      position: 0,
                    },
                  ],
                },
              },
            });

            await tx.invoiceActivity.create({
              data: invoiceActivityData(
                input.organizationId,
                created.id,
                "CREATED",
                `Generated invoice ${number} for the billing period.`,
                input.actor,
              ),
            });

            return tx.invoice.findUniqueOrThrow({
              where: { id: created.id },
              include: invoiceInclude,
            });
          });

          return { invoice: mapInvoice(invoice), created: true };
        } catch (error) {
          if (isUniqueViolation(error)) {
            const raced = await findExisting();

            if (raced) {
              return { invoice: mapInvoice(raced), created: false };
            }
          }

          if (attempt < maxAttempts && isRetryableWriteConflict(error)) {
            continue;
          }

          throw error;
        }
      }
    },

    async applyAction(organizationId, invoiceId, action, actor) {
      return prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<LockedInvoice>>`
          SELECT "id", "status", "totalMinor", "amountPaidMinor", "dueInDays",
                 "currency", "number", "subscriptionId"
          FROM "invoices"
          WHERE "id" = ${invoiceId} AND "organizationId" = ${organizationId}
          FOR UPDATE
        `;
        const current = locked[0];

        if (!current) {
          throw new InvoiceStateConflictError(
            "That invoice could not be found in this workspace.",
          );
        }

        const status = current.status as InvoiceStatus;
        const transition = resolveInvoiceAction(
          status,
          action,
          current.amountPaidMinor,
        );
        const now = new Date();
        const data: Prisma.InvoiceUpdateInput = {
          status: transition.status,
        };

        if (action === "issue") {
          data.issuedAt = now;
          data.dueAt = new Date(
            now.getTime() + current.dueInDays * 24 * 60 * 60 * 1000,
          );
        } else if (action === "void") {
          data.voidedAt = now;
        } else {
          data.uncollectibleAt = now;
        }

        const message =
          action === "issue"
            ? "Issued this invoice."
            : action === "void"
              ? "Voided this invoice."
              : "Marked this invoice uncollectible.";

        const updated = await tx.invoice.update({
          where: { id: current.id },
          data,
        });

        await tx.invoiceActivity.create({
          data: invoiceActivityData(
            organizationId,
            updated.id,
            transition.activityType,
            message,
            actor,
          ),
        });

        const invoice = await tx.invoice.findUniqueOrThrow({
          where: { id: current.id },
          include: invoiceInclude,
        });

        return mapInvoice(invoice);
      });
    },

    async recordPayment(input) {
      return prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<LockedInvoice>>`
          SELECT "id", "status", "totalMinor", "amountPaidMinor", "dueInDays",
                 "currency", "number", "subscriptionId"
          FROM "invoices"
          WHERE "id" = ${input.invoiceId} AND "organizationId" = ${input.organizationId}
          FOR UPDATE
        `;
        const current = locked[0];

        if (!current) {
          throw new PaymentStateConflictError(
            "That invoice could not be found in this workspace.",
          );
        }

        if (current.status !== "OPEN") {
          throw new PaymentStateConflictError(
            current.status === "PAID"
              ? "This invoice is already paid in full."
              : `Payments can only be recorded against open invoices. This invoice is ${current.status}.`,
          );
        }

        if (input.amountMinor > current.totalMinor - current.amountPaidMinor) {
          throw new OverpaymentError();
        }

        const now = new Date();
        const payment = await tx.payment.create({
          data: {
            organizationId: input.organizationId,
            invoiceId: current.id,
            amountMinor: input.amountMinor,
            currency: current.currency,
            method: input.method,
            status: input.status,
            source: "MANUAL",
            reference: input.reference,
            note: input.note,
            paidAt: input.status === "SUCCEEDED" ? now : null,
          },
        });

        if (input.status === "SUCCEEDED") {
          const amountPaidMinor =
            current.amountPaidMinor + input.amountMinor;
          const next = invoiceStatusForBalance(
            current.totalMinor,
            amountPaidMinor,
          );

          await tx.invoice.update({
            where: { id: current.id },
            data: {
              amountPaidMinor,
              status: next.status,
              paidAt: next.paidAt,
            },
          });
          await tx.invoiceActivity.create({
            data: invoiceActivityData(
              input.organizationId,
              current.id,
              "PAYMENT_SUCCEEDED",
              "Recorded a succeeded manual payment.",
              input.actor,
            ),
          });
        } else {
          await tx.invoiceActivity.create({
            data: invoiceActivityData(
              input.organizationId,
              current.id,
              "PAYMENT_RECORDED",
              "Recorded a pending manual payment.",
              input.actor,
            ),
          });
        }

        const invoice = await tx.invoice.findUniqueOrThrow({
          where: { id: current.id },
          include: invoiceInclude,
        });

        return {
          payment: mapPayment(
            { ...payment, refunds: [] },
            current.number,
            current.subscriptionId,
          ),
          invoice: mapInvoice(invoice),
        };
      });
    },

    async transitionPayment(input: PaymentTransitionInput) {
      return prisma.$transaction(async (tx) => {
        const lockedPayments = await tx.$queryRaw<Array<LockedPayment>>`
          SELECT "id", "organizationId", "status", "amountMinor", "currency",
                 "invoiceId", "source", "refundedAmountMinor", "gatewayProvider",
                 "gatewayOrderId", "gatewayPaymentId", "failedAt", "paidAt",
                 "refundedAt", "updatedAt"
          FROM "payments"
          WHERE "id" = ${input.paymentId} AND "organizationId" = ${input.organizationId}
          FOR UPDATE
        `;
        const currentPayment = lockedPayments[0];

        if (!currentPayment) {
          throw new PaymentStateConflictError(
            "That payment could not be found in this workspace.",
          );
        }

        if (currentPayment.source === "GATEWAY") {
          throw new PaymentStateConflictError(
            "Gateway payments are reconciled from verified provider events and cannot be changed manually.",
          );
        }

        const nextStatus = resolvePaymentTransition(
          currentPayment.status as PaymentRecord["status"],
          input.action,
        );

        const lockedInvoices = await tx.$queryRaw<Array<LockedInvoice>>`
          SELECT "id", "status", "totalMinor", "amountPaidMinor", "dueInDays",
                 "currency", "number", "subscriptionId"
          FROM "invoices"
          WHERE "id" = ${currentPayment.invoiceId}
            AND "organizationId" = ${input.organizationId}
          FOR UPDATE
        `;
        const invoiceRow = lockedInvoices[0];

        if (!invoiceRow) {
          throw new PaymentStateConflictError(
            "The invoice for this payment could not be found.",
          );
        }

        const now = new Date();
        let activityType:
          | "PAYMENT_SUCCEEDED"
          | "PAYMENT_FAILED"
          | "PAYMENT_REFUNDED";
        let activityMessage: string;

        if (input.action === "succeed") {
          if (invoiceRow.status !== "OPEN") {
            throw new PaymentStateConflictError(
              `This payment cannot succeed because the invoice is ${invoiceRow.status}.`,
            );
          }

          if (
            currentPayment.amountMinor >
            invoiceRow.totalMinor - invoiceRow.amountPaidMinor
          ) {
            throw new OverpaymentError();
          }

          const amountPaidMinor =
            invoiceRow.amountPaidMinor + currentPayment.amountMinor;
          const next = invoiceStatusForBalance(
            invoiceRow.totalMinor,
            amountPaidMinor,
          );

          await tx.payment.update({
            where: { id: currentPayment.id },
            data: { status: nextStatus, paidAt: now },
          });
          await tx.invoice.update({
            where: { id: invoiceRow.id },
            data: {
              amountPaidMinor,
              status: next.status,
              paidAt: next.paidAt,
            },
          });
          activityType = "PAYMENT_SUCCEEDED";
          activityMessage = "Confirmed a pending manual payment.";
        } else if (input.action === "fail") {
          await tx.payment.update({
            where: { id: currentPayment.id },
            data: { status: nextStatus, failedAt: now },
          });
          activityType = "PAYMENT_FAILED";
          activityMessage = "Marked a manual payment attempt as failed.";
        } else {
          const amountPaidMinor =
            invoiceRow.amountPaidMinor - currentPayment.amountMinor;

          if (amountPaidMinor < 0) {
            throw new PaymentStateConflictError(
              "This refund would make the invoice balance negative.",
            );
          }

          await tx.payment.update({
            where: { id: currentPayment.id },
            data: {
              status: nextStatus,
              refundedAt: now,
              refundedAmountMinor: currentPayment.amountMinor,
            },
          });
          await tx.invoice.update({
            where: { id: invoiceRow.id },
            data: {
              amountPaidMinor,
              status:
                amountPaidMinor >= invoiceRow.totalMinor ? "PAID" : "OPEN",
              paidAt:
                amountPaidMinor >= invoiceRow.totalMinor ? now : null,
            },
          });
          activityType = "PAYMENT_REFUNDED";
          activityMessage = "Refunded a manual payment.";
        }

        await tx.invoiceActivity.create({
          data: invoiceActivityData(
            input.organizationId,
            invoiceRow.id,
            activityType,
            activityMessage,
            input.actor,
          ),
        });

        const payment = await tx.payment.findUniqueOrThrow({
          where: { id: currentPayment.id },
          include: { refunds: true },
        });
        const invoice = await tx.invoice.findUniqueOrThrow({
          where: { id: invoiceRow.id },
          include: invoiceInclude,
        });

        return {
          payment: mapPayment(
            payment,
            invoiceRow.number,
            invoiceRow.subscriptionId,
          ),
          invoice: mapInvoice(invoice),
        } satisfies PaymentMutationResult;
      });
    },

    async reserveGatewayCheckout(input: CreateGatewayCheckoutInput) {
      return prisma.$transaction(async (tx) => {
        const current = await lockInvoiceRow(
          tx,
          input.organizationId,
          input.invoiceId,
        );

        if (!current) {
          throw new PaymentStateConflictError(
            "That invoice could not be found in this workspace.",
          );
        }

        if (current.status !== "OPEN") {
          throw new PaymentStateConflictError(
            current.status === "PAID"
              ? "This invoice is already paid in full."
              : `Checkout is only available for open invoices. This invoice is ${current.status}.`,
          );
        }

        const amountDue = current.totalMinor - current.amountPaidMinor;

        if (amountDue <= 0) {
          throw new PaymentStateConflictError(
            "This invoice has no outstanding balance.",
          );
        }

        const pending = await tx.$queryRaw<Array<LockedPayment>>`
          SELECT "id", "organizationId", "status", "amountMinor", "currency",
                 "invoiceId", "source", "refundedAmountMinor", "gatewayProvider",
                 "gatewayOrderId", "gatewayPaymentId", "failedAt", "paidAt",
                 "refundedAt", "updatedAt"
          FROM "payments"
          WHERE "organizationId" = ${input.organizationId}
            AND "invoiceId" = ${current.id}
            AND "source" = 'GATEWAY'
            AND "gatewayProvider" = ${input.provider}
            AND "status" = 'PENDING'
          ORDER BY "createdAt" DESC
          FOR UPDATE
        `;
        const existing = pending[0];
        const now = new Date();

        if (existing) {
          if (now.getTime() - existing.updatedAt.getTime() < input.staleAfterMs) {
            throw new PaymentStateConflictError(
              "A gateway checkout is already in progress for this invoice. Finish or close it before starting another.",
            );
          }

          await tx.payment.update({
            where: { id: existing.id },
            data: {
              status: "FAILED",
              failedAt: now,
              gatewayStatus: "abandoned",
            },
          });
          await tx.invoiceActivity.create({
            data: invoiceActivityData(
              input.organizationId,
              current.id,
              "PAYMENT_FAILED",
              "Expired an abandoned gateway checkout attempt.",
              input.actor,
            ),
          });
        }

        const payment = await tx.payment.create({
          data: {
            organizationId: input.organizationId,
            invoiceId: current.id,
            amountMinor: amountDue,
            currency: current.currency,
            method: "CARD",
            status: "PENDING",
            source: "GATEWAY",
            gatewayProvider: input.provider,
            gatewayStatus: "created",
          },
        });

        await tx.invoice.update({
          where: { id: current.id },
          data: { updatedAt: now },
        });
        await tx.invoiceActivity.create({
          data: invoiceActivityData(
            input.organizationId,
            current.id,
            "PAYMENT_RECORDED",
            `Started a ${input.provider} checkout for ${amountDue} ${current.currency} minor units.`,
            input.actor,
          ),
        });

        return {
          payment: mapPayment(
            { ...payment, refunds: [] },
            current.number,
            current.subscriptionId,
          ),
          invoice: mapInvoice(
            await tx.invoice.findUniqueOrThrow({
              where: { id: current.id },
              include: invoiceInclude,
            }),
          ),
        };
      });
    },

    async attachGatewayOrder(input: AttachGatewayOrderInput) {
      return prisma.$transaction(async (tx) => {
        const current = await lockPaymentRow(
          tx,
          input.organizationId,
          input.paymentId,
        );

        if (!current) {
          throw new PaymentStateConflictError(
            "That payment could not be found in this workspace.",
          );
        }

        if (
          current.source !== "GATEWAY" ||
          current.gatewayProvider !== input.provider
        ) {
          throw new PaymentStateConflictError(
            "This payment does not belong to the configured gateway.",
          );
        }

        if (
          current.gatewayOrderId &&
          current.gatewayOrderId !== input.gatewayOrderId
        ) {
          throw new PaymentStateConflictError(
            "This payment already belongs to a different gateway order.",
          );
        }

        const invoice = await tx.invoice.findUniqueOrThrow({
          where: { id: current.invoiceId },
          select: { number: true, subscriptionId: true },
        });

        if (current.status !== "PENDING") {
          if (
            current.gatewayOrderId === input.gatewayOrderId &&
            (current.status === "SUCCEEDED" || current.status === "REFUNDED")
          ) {
            return loadPaymentRecord(
              tx,
              current.id,
              invoice.number,
              invoice.subscriptionId,
            );
          }

          throw new PaymentStateConflictError(
            "This payment attempt is no longer accepting a gateway order.",
          );
        }

        await tx.payment.update({
          where: { id: current.id },
          data: {
            gatewayOrderId: input.gatewayOrderId,
            gatewayStatus: input.gatewayStatus,
            ...(input.metadata === undefined
              ? {}
              : { gatewayMetadata: gatewayMetadata(input.metadata) }),
          },
        });

        return loadPaymentRecord(
          tx,
          current.id,
          invoice.number,
          invoice.subscriptionId,
        );
      });
    },

    async failGatewayPayment(input: FailGatewayPaymentInput) {
      return prisma.$transaction(async (tx) => {
        const current = await lockPaymentRow(
          tx,
          input.organizationId,
          input.paymentId,
        );

        if (!current) {
          throw new PaymentStateConflictError(
            "That payment could not be found in this workspace.",
          );
        }

        if (
          current.source !== "GATEWAY" ||
          current.gatewayProvider !== input.provider
        ) {
          throw new PaymentStateConflictError(
            "This payment does not belong to the configured gateway.",
          );
        }

        const invoice = await tx.invoice.findUniqueOrThrow({
          where: { id: current.invoiceId },
          select: { number: true, subscriptionId: true },
        });

        if (
          current.status === "SUCCEEDED" ||
          current.status === "REFUNDED" ||
          current.status === "FAILED"
        ) {
          return loadPaymentRecord(
            tx,
            current.id,
            invoice.number,
            invoice.subscriptionId,
          );
        }

        const now = new Date();

        await tx.payment.update({
          where: { id: current.id },
          data: {
            status: "FAILED",
            failedAt: now,
            gatewayStatus: input.gatewayStatus,
          },
        });
        await tx.invoice.update({
          where: { id: current.invoiceId },
          data: { updatedAt: now },
        });
        await tx.invoiceActivity.create({
          data: invoiceActivityData(
            input.organizationId,
            current.invoiceId,
            "PAYMENT_FAILED",
            input.message,
            input.actor,
          ),
        });

        return loadPaymentRecord(
          tx,
          current.id,
          invoice.number,
          invoice.subscriptionId,
        );
      });
    },

    async confirmGatewayPayment(input: ConfirmGatewayPaymentInput) {
      return prisma.$transaction(async (tx) => {
        const currentPayment = await lockPaymentRow(
          tx,
          input.organizationId,
          input.paymentId,
        );

        if (!currentPayment) {
          throw new PaymentStateConflictError(
            "That payment could not be found in this workspace.",
          );
        }

        if (
          currentPayment.source !== "GATEWAY" ||
          currentPayment.gatewayProvider !== input.provider
        ) {
          throw new PaymentStateConflictError(
            "This payment does not belong to the configured gateway.",
          );
        }

        const currentInvoice = await lockInvoiceRow(
          tx,
          input.organizationId,
          currentPayment.invoiceId,
        );

        if (!currentInvoice) {
          throw new PaymentStateConflictError(
            "The invoice for this payment could not be found.",
          );
        }

        if (currentPayment.gatewayOrderId !== input.gatewayOrderId) {
          throw new PaymentStateConflictError(
            "The gateway order does not match this payment attempt.",
          );
        }

        if (
          currentPayment.gatewayPaymentId &&
          currentPayment.gatewayPaymentId !== input.gatewayPaymentId &&
          currentPayment.status !== "FAILED"
        ) {
          throw new PaymentStateConflictError(
            "This payment attempt is already linked to a different gateway payment.",
          );
        }

        if (
          currentPayment.status === "SUCCEEDED" ||
          currentPayment.status === "REFUNDED"
        ) {
          return {
            payment: await loadPaymentRecord(
              tx,
              currentPayment.id,
              currentInvoice.number,
              currentInvoice.subscriptionId,
            ),
            invoice: mapInvoice(
              await tx.invoice.findUniqueOrThrow({
                where: { id: currentInvoice.id },
                include: invoiceInclude,
              }),
            ),
          } satisfies PaymentMutationResult;
        }

        if (input.amountMinor !== currentPayment.amountMinor) {
          throw new PaymentStateConflictError(
            "The captured amount does not match the reserved payment amount.",
          );
        }

        if (input.currency !== currentPayment.currency) {
          throw new PaymentStateConflictError(
            "The captured currency does not match the invoice currency.",
          );
        }

        if (currentInvoice.status !== "OPEN") {
          throw new PaymentStateConflictError(
            `This payment cannot be applied because the invoice is ${currentInvoice.status}.`,
          );
        }

        if (
          currentPayment.amountMinor >
          currentInvoice.totalMinor - currentInvoice.amountPaidMinor
        ) {
          throw new OverpaymentError();
        }

        const now = new Date();

        await tx.payment.update({
          where: { id: currentPayment.id },
          data: {
            status: "SUCCEEDED",
            gatewayPaymentId: input.gatewayPaymentId,
            gatewayStatus: input.gatewayStatus,
            paidAt: now,
            failedAt: null,
          },
        });

        const amountPaidMinor =
          currentInvoice.amountPaidMinor + currentPayment.amountMinor;
        const next = invoiceStatusForBalance(
          currentInvoice.totalMinor,
          amountPaidMinor,
        );

        await tx.invoice.update({
          where: { id: currentInvoice.id },
          data: {
            amountPaidMinor,
            status: next.status,
            paidAt: next.paidAt,
          },
        });
        await tx.invoiceActivity.create({
          data: invoiceActivityData(
            input.organizationId,
            currentInvoice.id,
            "PAYMENT_SUCCEEDED",
            `Confirmed a ${input.provider} payment of ${currentPayment.amountMinor} ${currentInvoice.currency} minor units.`,
            input.actor,
          ),
        });

        return {
          payment: await loadPaymentRecord(
            tx,
            currentPayment.id,
            currentInvoice.number,
            currentInvoice.subscriptionId,
          ),
          invoice: mapInvoice(
            await tx.invoice.findUniqueOrThrow({
              where: { id: currentInvoice.id },
              include: invoiceInclude,
            }),
          ),
        } satisfies PaymentMutationResult;
      });
    },

    async reserveGatewayRefund(input: ReserveGatewayRefundInput) {
      return prisma.$transaction(async (tx) => {
        const payment = await lockPaymentRow(
          tx,
          input.organizationId,
          input.paymentId,
        );

        if (!payment) {
          throw new PaymentStateConflictError(
            "That payment could not be found in this workspace.",
          );
        }

        const invoice = await lockInvoiceRow(
          tx,
          input.organizationId,
          payment.invoiceId,
        );

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

        const pendingRows = await tx.$queryRaw<
          Array<{ pending: bigint | number | string }>
        >`
          SELECT COALESCE(SUM("amountMinor"), 0)::bigint AS "pending"
          FROM "payment_refunds"
          WHERE "paymentId" = ${payment.id} AND "status" = 'PENDING'
        `;
        const pendingMinor = Number(pendingRows[0]?.pending ?? 0);
        const availableMinor =
          payment.amountMinor - payment.refundedAmountMinor - pendingMinor;

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
        const refund = await tx.paymentRefund.create({
          data: {
            organizationId: input.organizationId,
            invoiceId: payment.invoiceId,
            paymentId: payment.id,
            provider: input.provider,
            amountMinor: input.amountMinor,
            currency: payment.currency,
            status: "PENDING",
            reason: input.reason,
          },
        });

        await tx.payment.update({
          where: { id: payment.id },
          data: { updatedAt: now },
        });
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { updatedAt: now },
        });
        await tx.invoiceActivity.create({
          data: invoiceActivityData(
            input.organizationId,
            invoice.id,
            "PAYMENT_REFUND_REQUESTED",
            `Requested a ${input.amountMinor} ${invoice.currency} minor-unit refund through ${input.provider}.`,
            input.actor,
          ),
        });

        return {
          payment: await loadPaymentRecord(
            tx,
            payment.id,
            invoice.number,
            invoice.subscriptionId,
          ),
          invoice: mapInvoice(
            await tx.invoice.findUniqueOrThrow({
              where: { id: invoice.id },
              include: invoiceInclude,
            }),
          ),
          refund: mapRefund(refund),
        };
      });
    },

    async applyGatewayRefund(input: ApplyGatewayRefundInput) {
      return prisma.$transaction(async (tx) => {
        const refundRows = await tx.$queryRaw<Array<LockedRefund>>`
          SELECT "id", "organizationId", "invoiceId", "paymentId", "provider",
                 "providerRefundId", "amountMinor", "currency", "status",
                 "reason", "processedAt", "failedAt"
          FROM "payment_refunds"
          WHERE "id" = ${input.refundId}
            AND "organizationId" = ${input.organizationId}
          FOR UPDATE
        `;
        const currentRefund = refundRows[0];

        if (!currentRefund) {
          throw new PaymentStateConflictError(
            "That refund could not be found in this workspace.",
          );
        }

        if (currentRefund.provider !== input.provider) {
          throw new PaymentStateConflictError(
            "This refund does not belong to the configured gateway.",
          );
        }

        if (
          input.providerRefundId &&
          currentRefund.providerRefundId &&
          input.providerRefundId !== currentRefund.providerRefundId
        ) {
          throw new PaymentStateConflictError(
            "This refund is already linked to a different gateway refund.",
          );
        }

        if (input.providerRefundId) {
          const duplicate = await tx.paymentRefund.findFirst({
            where: {
              provider: input.provider,
              providerRefundId: input.providerRefundId,
              id: { not: currentRefund.id },
            },
            select: { id: true },
          });

          if (duplicate) {
            throw new PaymentStateConflictError(
              "That gateway refund is already linked to another payment.",
            );
          }
        }

        const payment = await lockPaymentRow(
          tx,
          input.organizationId,
          currentRefund.paymentId,
        );
        const invoice = await lockInvoiceRow(
          tx,
          input.organizationId,
          currentRefund.invoiceId,
        );

        if (!payment || !invoice) {
          throw new PaymentStateConflictError(
            "The payment for this refund could not be found.",
          );
        }

        if (currentRefund.status === "SUCCEEDED") {
          return {
            payment: await loadPaymentRecord(
              tx,
              payment.id,
              invoice.number,
              invoice.subscriptionId,
            ),
            invoice: mapInvoice(
              await tx.invoice.findUniqueOrThrow({
                where: { id: invoice.id },
                include: invoiceInclude,
              }),
            ),
            refund: await loadRefundRecord(tx, currentRefund.id),
          };
        }

        if (
          currentRefund.status === "FAILED" &&
          input.status !== "FAILED"
        ) {
          return {
            payment: await loadPaymentRecord(
              tx,
              payment.id,
              invoice.number,
              invoice.subscriptionId,
            ),
            invoice: mapInvoice(
              await tx.invoice.findUniqueOrThrow({
                where: { id: invoice.id },
                include: invoiceInclude,
              }),
            ),
            refund: await loadRefundRecord(tx, currentRefund.id),
          };
        }

        const now = new Date();

        if (input.status === "PENDING") {
          await tx.paymentRefund.update({
            where: { id: currentRefund.id },
            data: {
              ...(input.providerRefundId
                ? { providerRefundId: input.providerRefundId }
                : {}),
              updatedAt: now,
            },
          });

          return {
            payment: await loadPaymentRecord(
              tx,
              payment.id,
              invoice.number,
              invoice.subscriptionId,
            ),
            invoice: mapInvoice(
              await tx.invoice.findUniqueOrThrow({
                where: { id: invoice.id },
                include: invoiceInclude,
              }),
            ),
            refund: await loadRefundRecord(tx, currentRefund.id),
          };
        }

        if (input.status === "FAILED") {
          await tx.paymentRefund.update({
            where: { id: currentRefund.id },
            data: {
              ...(input.providerRefundId
                ? { providerRefundId: input.providerRefundId }
                : {}),
              status: "FAILED",
              failedAt: now,
            },
          });
          await tx.payment.update({
            where: { id: payment.id },
            data: { updatedAt: now },
          });
          await tx.invoice.update({
            where: { id: invoice.id },
            data: { updatedAt: now },
          });
          await tx.invoiceActivity.create({
            data: invoiceActivityData(
              input.organizationId,
              invoice.id,
              "PAYMENT_REFUND_FAILED",
              `A ${currentRefund.amountMinor} ${invoice.currency} minor-unit refund through ${currentRefund.provider} failed.`,
              input.actor,
            ),
          });

          return {
            payment: await loadPaymentRecord(
              tx,
              payment.id,
              invoice.number,
              invoice.subscriptionId,
            ),
            invoice: mapInvoice(
              await tx.invoice.findUniqueOrThrow({
                where: { id: invoice.id },
                include: invoiceInclude,
              }),
            ),
            refund: await loadRefundRecord(tx, currentRefund.id),
          };
        }

        if (payment.status !== "SUCCEEDED" && payment.status !== "REFUNDED") {
          throw new PaymentStateConflictError(
            "The payment is not in a refundable state.",
          );
        }

        if (currentRefund.currency !== payment.currency) {
          throw new PaymentStateConflictError(
            "The refund currency does not match the payment.",
          );
        }

        if (
          payment.refundedAmountMinor + currentRefund.amountMinor >
          payment.amountMinor
        ) {
          throw new PaymentStateConflictError(
            "This refund would exceed the captured amount.",
          );
        }

        const refundedAmountMinor =
          payment.refundedAmountMinor + currentRefund.amountMinor;
        const fullyRefunded = refundedAmountMinor >= payment.amountMinor;
        const amountPaidMinor = invoice.amountPaidMinor - currentRefund.amountMinor;

        if (amountPaidMinor < 0) {
          throw new PaymentStateConflictError(
            "This refund would make the invoice balance negative.",
          );
        }

        const next = invoiceStatusForBalance(
          invoice.totalMinor,
          amountPaidMinor,
        );

        await tx.paymentRefund.update({
          where: { id: currentRefund.id },
          data: {
            ...(input.providerRefundId
              ? { providerRefundId: input.providerRefundId }
              : {}),
            status: "SUCCEEDED" as PaymentRefundStatus,
            processedAt: now,
            failedAt: null,
          },
        });
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            refundedAmountMinor,
            status: fullyRefunded ? "REFUNDED" : "SUCCEEDED",
            refundedAt: fullyRefunded ? now : null,
          },
        });
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            amountPaidMinor,
            status: next.status,
            paidAt: next.paidAt,
          },
        });
        await tx.invoiceActivity.create({
          data: invoiceActivityData(
            input.organizationId,
            invoice.id,
            "PAYMENT_REFUNDED",
            `Refunded ${currentRefund.amountMinor} ${invoice.currency} minor units through ${currentRefund.provider}.`,
            input.actor,
          ),
        });

        return {
          payment: await loadPaymentRecord(
            tx,
            payment.id,
            invoice.number,
            invoice.subscriptionId,
          ),
          invoice: mapInvoice(
            await tx.invoice.findUniqueOrThrow({
              where: { id: invoice.id },
              include: invoiceInclude,
            }),
          ),
          refund: await loadRefundRecord(tx, currentRefund.id),
        };
      });
    },

    async processGatewayEvent(event: NormalizedGatewayWebhookEvent) {
      if (event.kind === "unsupported") {
        return {
          outcome: "ignored",
          organizationId: null,
          paymentId: null,
        } as const;
      }

      const actor: BillingActor = {
        actorId: null,
        actorName: `${event.provider} webhook`,
      };

      return prisma.$transaction(async (tx) => {
        if (event.kind === "payment") {
          const byInternal = event.internalPaymentId
            ? await tx.$queryRaw<Array<LockedPayment>>`
                SELECT "id", "organizationId", "status", "amountMinor", "currency",
                       "invoiceId", "source", "refundedAmountMinor",
                       "gatewayProvider", "gatewayOrderId", "gatewayPaymentId",
                       "failedAt", "paidAt", "refundedAt", "updatedAt"
                FROM "payments"
                WHERE "id" = ${event.internalPaymentId}
                  AND "source" = 'GATEWAY'
                  AND "gatewayProvider" = ${event.provider}
                FOR UPDATE
              `
            : [];
          const byGateway =
            byInternal.length === 0
              ? await tx.$queryRaw<Array<LockedPayment>>`
                  SELECT "id", "organizationId", "status", "amountMinor",
                         "currency", "invoiceId", "source", "refundedAmountMinor",
                         "gatewayProvider", "gatewayOrderId", "gatewayPaymentId",
                         "failedAt", "paidAt", "refundedAt", "updatedAt"
                  FROM "payments"
                  WHERE "source" = 'GATEWAY'
                    AND "gatewayProvider" = ${event.provider}
                    AND (
                      ("gatewayOrderId" IS NOT NULL
                        AND "gatewayOrderId" = ${event.gatewayOrderId})
                      OR "gatewayPaymentId" = ${event.gatewayPaymentId}
                    )
                  ORDER BY "createdAt" DESC
                  LIMIT 1
                  FOR UPDATE
                `
              : [];
          const payment = byInternal[0] ?? byGateway[0] ?? null;

          if (!payment) {
            return {
              outcome: "ignored",
              organizationId: null,
              paymentId: null,
            } as const;
          }

          const invoice = await lockInvoiceRow(
            tx,
            payment.organizationId,
            payment.invoiceId,
          );

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

          const now = new Date();

          if (event.eventType === "payment.failed") {
            if (
              payment.status === "SUCCEEDED" ||
              payment.status === "REFUNDED"
            ) {
              return {
                outcome: "ignored",
                organizationId: payment.organizationId,
                paymentId: payment.id,
              } as const;
            }

            if (payment.status === "FAILED") {
              await tx.payment.update({
                where: { id: payment.id },
                data: { gatewayStatus: event.gatewayStatus },
              });

              return {
                outcome: "ignored",
                organizationId: payment.organizationId,
                paymentId: payment.id,
              } as const;
            }

            await tx.payment.update({
              where: { id: payment.id },
              data: {
                status: "FAILED",
                gatewayPaymentId: event.gatewayPaymentId,
                gatewayStatus: event.gatewayStatus,
                failedAt: now,
              },
            });
            await tx.invoice.update({
              where: { id: invoice.id },
              data: { updatedAt: now },
            });
            await tx.invoiceActivity.create({
              data: invoiceActivityData(
                payment.organizationId,
                invoice.id,
                "PAYMENT_FAILED",
                `The ${event.provider} payment attempt failed. The invoice balance is unchanged.`,
                actor,
              ),
            });

            return {
              outcome: "applied",
              organizationId: payment.organizationId,
              paymentId: payment.id,
            } as const;
          }

          if (
            payment.status === "SUCCEEDED" ||
            payment.status === "REFUNDED"
          ) {
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

          if (
            payment.amountMinor >
            invoice.totalMinor - invoice.amountPaidMinor
          ) {
            return {
              outcome: "ignored",
              organizationId: payment.organizationId,
              paymentId: payment.id,
            } as const;
          }

          const amountPaidMinor =
            invoice.amountPaidMinor + payment.amountMinor;
          const next = invoiceStatusForBalance(
            invoice.totalMinor,
            amountPaidMinor,
          );

          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: "SUCCEEDED",
              gatewayPaymentId: event.gatewayPaymentId,
              gatewayStatus: event.gatewayStatus,
              paidAt: now,
              failedAt: null,
            },
          });
          await tx.invoice.update({
            where: { id: invoice.id },
            data: {
              amountPaidMinor,
              status: next.status,
              paidAt: next.paidAt,
            },
          });
          await tx.invoiceActivity.create({
            data: invoiceActivityData(
              payment.organizationId,
              invoice.id,
              "PAYMENT_SUCCEEDED",
              `Confirmed a ${event.provider} payment of ${payment.amountMinor} ${invoice.currency} minor units from a verified webhook.`,
              actor,
            ),
          });

          return {
            outcome: "applied",
            organizationId: payment.organizationId,
            paymentId: payment.id,
          } as const;
        }

        let refund: LockedRefund | null = null;

        if (event.internalRefundId) {
          const rows = await tx.$queryRaw<Array<LockedRefund>>`
            SELECT "id", "organizationId", "invoiceId", "paymentId", "provider",
                   "providerRefundId", "amountMinor", "currency", "status",
                   "reason", "processedAt", "failedAt"
            FROM "payment_refunds"
            WHERE "id" = ${event.internalRefundId}
            FOR UPDATE
          `;
          refund = rows[0] ?? null;

          if (refund && refund.provider !== event.provider) {
            refund = null;
          }
        }

        if (!refund) {
          const rows = await tx.$queryRaw<Array<LockedRefund>>`
            SELECT "id", "organizationId", "invoiceId", "paymentId", "provider",
                   "providerRefundId", "amountMinor", "currency", "status",
                   "reason", "processedAt", "failedAt"
            FROM "payment_refunds"
            WHERE "provider" = ${event.provider}
              AND "providerRefundId" = ${event.gatewayRefundId}
            FOR UPDATE
          `;
          refund = rows[0] ?? null;
        }

        let payment: LockedPayment | null;

        if (refund) {
          payment = await lockPaymentRow(
            tx,
            refund.organizationId,
            refund.paymentId,
          );
        } else {
          const rows = await tx.$queryRaw<Array<LockedPayment>>`
            SELECT "id", "organizationId", "status", "amountMinor", "currency",
                   "invoiceId", "source", "refundedAmountMinor", "gatewayProvider",
                   "gatewayOrderId", "gatewayPaymentId", "failedAt", "paidAt",
                   "refundedAt", "updatedAt"
            FROM "payments"
            WHERE "source" = 'GATEWAY'
              AND "gatewayProvider" = ${event.provider}
              AND "gatewayPaymentId" = ${event.gatewayPaymentId}
            ORDER BY "createdAt" DESC
            LIMIT 1
            FOR UPDATE
          `;
          payment = rows[0] ?? null;
        }

        if (!payment) {
          return {
            outcome: "ignored",
            organizationId: null,
            paymentId: null,
          } as const;
        }

        const invoice = await lockInvoiceRow(
          tx,
          payment.organizationId,
          payment.invoiceId,
        );

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
            refund.amountMinor !== event.amountMinor ||
            refund.paymentId !== payment.id)
        ) {
          return {
            outcome: "ignored",
            organizationId: payment.organizationId,
            paymentId: payment.id,
          } as const;
        }

        const now = new Date();

        if (!refund) {
          if (event.eventType === "refund.failed") {
            return {
              outcome: "ignored",
              organizationId: payment.organizationId,
              paymentId: payment.id,
            } as const;
          }

          const pending = await tx.$queryRaw<Array<LockedRefund>>`
            SELECT "id", "organizationId", "invoiceId", "paymentId", "provider",
                   "providerRefundId", "amountMinor", "currency", "status",
                   "reason", "processedAt", "failedAt"
            FROM "payment_refunds"
            WHERE "paymentId" = ${payment.id}
              AND "status" = 'PENDING'
              AND "amountMinor" = ${event.amountMinor}
              AND "currency" = ${event.currency}
              AND ("providerRefundId" IS NULL
                OR "providerRefundId" = ${event.gatewayRefundId})
            ORDER BY "createdAt" ASC
            LIMIT 1
            FOR UPDATE
          `;
          refund = pending[0] ?? null;

          if (!refund) {
            const pendingRows = await tx.$queryRaw<
              Array<{ pending: bigint | number | string }>
            >`
              SELECT COALESCE(SUM("amountMinor"), 0)::bigint AS "pending"
              FROM "payment_refunds"
              WHERE "paymentId" = ${payment.id} AND "status" = 'PENDING'
            `;
            const pendingMinor = Number(pendingRows[0]?.pending ?? 0);
            const availableMinor =
              payment.amountMinor -
              payment.refundedAmountMinor -
              pendingMinor;

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

            const created = await tx.paymentRefund.create({
              data: {
                organizationId: payment.organizationId,
                invoiceId: payment.invoiceId,
                paymentId: payment.id,
                provider: event.provider,
                providerRefundId: event.gatewayRefundId,
                amountMinor: event.amountMinor,
                currency: event.currency,
                status: "PENDING",
                reason: event.reason,
              },
            });

            refund = {
              id: created.id,
              organizationId: created.organizationId,
              invoiceId: created.invoiceId,
              paymentId: created.paymentId,
              provider: created.provider,
              providerRefundId: created.providerRefundId,
              amountMinor: created.amountMinor,
              currency: created.currency,
              status: created.status,
              reason: created.reason,
              processedAt: created.processedAt,
              failedAt: created.failedAt,
            };

            await tx.payment.update({
              where: { id: payment.id },
              data: { updatedAt: now },
            });
            await tx.invoice.update({
              where: { id: invoice.id },
              data: { updatedAt: now },
            });
            await tx.invoiceActivity.create({
              data: invoiceActivityData(
                payment.organizationId,
                invoice.id,
                "PAYMENT_REFUND_REQUESTED",
                `A ${event.amountMinor} ${invoice.currency} minor-unit refund was created through ${event.provider}.`,
                actor,
              ),
            });
          }
        }

        if (refund.providerRefundId === null) {
          refund.providerRefundId = event.gatewayRefundId;
          await tx.paymentRefund.update({
            where: { id: refund.id },
            data: { providerRefundId: event.gatewayRefundId },
          });
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

          await tx.paymentRefund.update({
            where: { id: refund.id },
            data: {
              ...(refund.reason ? {} : { reason: event.reason }),
              updatedAt: now,
            },
          });

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

          await tx.paymentRefund.update({
            where: { id: refund.id },
            data: { status: "FAILED", failedAt: now },
          });
          await tx.payment.update({
            where: { id: payment.id },
            data: { updatedAt: now },
          });
          await tx.invoice.update({
            where: { id: invoice.id },
            data: { updatedAt: now },
          });
          await tx.invoiceActivity.create({
            data: invoiceActivityData(
              payment.organizationId,
              invoice.id,
              "PAYMENT_REFUND_FAILED",
              `A ${refund.amountMinor} ${invoice.currency} minor-unit refund through ${event.provider} failed.`,
              actor,
            ),
          });

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

        const refundedAmountMinor =
          payment.refundedAmountMinor + refund.amountMinor;
        const fullyRefunded = refundedAmountMinor >= payment.amountMinor;
        const amountPaidMinor = invoice.amountPaidMinor - refund.amountMinor;

        if (amountPaidMinor < 0) {
          return {
            outcome: "ignored",
            organizationId: payment.organizationId,
            paymentId: payment.id,
          } as const;
        }

        const next = invoiceStatusForBalance(
          invoice.totalMinor,
          amountPaidMinor,
        );

        await tx.paymentRefund.update({
          where: { id: refund.id },
          data: {
            status: "SUCCEEDED",
            processedAt: now,
            failedAt: null,
          },
        });
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            refundedAmountMinor,
            status: fullyRefunded ? "REFUNDED" : "SUCCEEDED",
            refundedAt: fullyRefunded ? now : null,
          },
        });
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            amountPaidMinor,
            status: next.status,
            paidAt: next.paidAt,
          },
        });
        await tx.invoiceActivity.create({
          data: invoiceActivityData(
            payment.organizationId,
            invoice.id,
            "PAYMENT_REFUNDED",
            `Refunded ${refund.amountMinor} ${invoice.currency} minor units through ${event.provider}.`,
            actor,
          ),
        });

        return {
          outcome: "applied",
          organizationId: payment.organizationId,
          paymentId: payment.id,
        } as const;
      });
    },

    async listPaymentsForSubscription(organizationId, subscriptionId) {
      const payments = await prisma.payment.findMany({
        where: {
          organizationId,
          invoice: { subscriptionId },
        },
        include: paymentInclude,
        orderBy: { createdAt: "desc" },
      });

      return payments.map(mapPaymentRow);
    },

    async sumOutstandingBySubscriptions(organizationId, subscriptionIds) {
      if (subscriptionIds.length === 0) {
        return new Map<string, number>();
      }

      const rows = await prisma.invoice.findMany({
        where: {
          organizationId,
          subscriptionId: { in: [...subscriptionIds] },
          status: "OPEN",
        },
        select: {
          subscriptionId: true,
          totalMinor: true,
          amountPaidMinor: true,
        },
      });
      const outstanding = new Map<string, number>();

      for (const row of rows) {
        if (!row.subscriptionId) {
          continue;
        }

        outstanding.set(
          row.subscriptionId,
          (outstanding.get(row.subscriptionId) ?? 0) +
            (row.totalMinor - row.amountPaidMinor),
        );
      }

      return outstanding;
    },
  };
}
