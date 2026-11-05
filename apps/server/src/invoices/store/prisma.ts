import type {
  InvoiceStatus,
  Payment as PaymentModel,
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
  BillingActor,
  GenerateInvoiceInput,
  InvoiceActivityRecord,
  InvoiceListOptions,
  InvoiceListResult,
  InvoiceRecord,
  InvoiceStore,
  PaymentMutationResult,
  PaymentRecord,
  PaymentTransitionInput,
} from "../types.js";

const invoiceInclude = {
  lineItems: { orderBy: { position: "asc" } },
  activities: { orderBy: { createdAt: "desc" } },
  payments: { orderBy: { createdAt: "desc" } },
} satisfies Prisma.InvoiceInclude;

type InvoiceRow = Prisma.InvoiceGetPayload<{
  include: typeof invoiceInclude;
}>;

const paymentInclude = {
  invoice: { select: { number: true, subscriptionId: true } },
} satisfies Prisma.PaymentInclude;

type PaymentRow = Prisma.PaymentGetPayload<{
  include: typeof paymentInclude;
}>;

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
  status: string;
  amountMinor: number;
  invoiceId: string;
}

function mapPayment(
  payment: PaymentModel,
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
  | "PAYMENT_REFUNDED";

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
            payment,
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
          SELECT "id", "status", "amountMinor", "invoiceId"
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
            data: { status: nextStatus, refundedAt: now },
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
