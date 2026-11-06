import type {
  GatewayConfigResponse,
  GatewayWebhookResponse,
} from "@subscript/shared";
import { BillingError, PaymentStateConflictError } from "../billing/errors.js";
import type {
  BillingActor,
  GatewayCheckoutReservation,
  GatewayRefundResult,
  InvoiceStore,
  PaymentMutationResult,
  PaymentRecord,
} from "../invoices/types.js";
import {
  GatewayConfigurationError,
  GatewayPayloadError,
  GatewayRequestError,
  GatewaySignatureError,
  GatewayWebhookInProgressError,
} from "./errors.js";
import type {
  CreateGatewayOrderInput,
  GatewayOrder,
  GatewayRefund,
  PaymentGateway,
} from "./types.js";
import type { GatewayWebhookStore } from "./webhook-store.js";

const DEFAULT_CHECKOUT_RESERVATION_MS = 30 * 60 * 1000;

export interface GatewayServiceOptions {
  gateway: PaymentGateway | null;
  invoiceStore: InvoiceStore;
  webhookStore: GatewayWebhookStore;
  checkoutReservationMs?: number;
}

export interface GatewayActorContext {
  organizationId: string;
  actor: BillingActor;
}

function requireGateway(gateway: PaymentGateway | null): PaymentGateway {
  if (!gateway) {
    throw new GatewayConfigurationError(
      "The payment gateway is not configured. Add Razorpay environment variables to enable checkout.",
    );
  }

  return gateway;
}

function validateOrder(
  order: GatewayOrder,
  input: CreateGatewayOrderInput,
): void {
  if (
    order.id.length === 0 ||
    order.amountMinor !== input.amountMinor ||
    order.currency !== input.currency
  ) {
    throw new GatewayRequestError(
      "The payment provider returned an order that does not match the invoice.",
    );
  }
}

function validateGatewayRefund(
  refund: {
    id: string;
    gatewayPaymentId: string;
    amountMinor: number;
    currency: string;
  },
  input: {
    gatewayPaymentId: string;
    amountMinor: number;
    currency: string;
  },
): void {
  if (
    refund.id.length === 0 ||
    refund.gatewayPaymentId !== input.gatewayPaymentId ||
    refund.amountMinor !== input.amountMinor ||
    refund.currency !== input.currency
  ) {
    throw new GatewayRequestError(
      "The payment provider returned a refund that does not match the payment.",
    );
  }
}

function pendingRefundMinor(payment: PaymentRecord): number {
  return payment.refunds
    .filter((refund) => refund.status === "PENDING")
    .reduce((total, refund) => total + refund.amountMinor, 0);
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof BillingError) {
    return error.message;
  }

  if (error instanceof GatewayPayloadError) {
    return error.message;
  }

  if (error instanceof GatewayRequestError) {
    return error.message;
  }

  return "Webhook processing failed.";
}

export interface GatewayCheckoutResult {
  provider: string;
  keyId: string;
  orderId: string;
  payment: PaymentRecord;
  invoiceNumber: string;
  amount: {
    amountMinor: number;
    currency: string;
  };
  customerName: string;
  customerEmail: string;
  description: string;
  testMode: boolean;
}

export interface GatewayService {
  config(): GatewayConfigResponse;
  createCheckout(
    input: GatewayActorContext & { invoiceId: string },
  ): Promise<GatewayCheckoutResult>;
  verifyPayment(
    input: GatewayActorContext & {
      paymentId: string;
      orderId: string;
      gatewayPaymentId: string;
      signature: string;
    },
  ): Promise<PaymentMutationResult>;
  cancelCheckout(
    input: GatewayActorContext & {
      paymentId: string;
      orderId: string | null;
    },
  ): Promise<PaymentRecord>;
  refund(
    input: GatewayActorContext & {
      paymentId: string;
      amountMinor?: number;
      reason: string | null;
    },
  ): Promise<GatewayRefundResult>;
  processWebhook(input: {
    rawBody: Buffer;
    signature: string | null;
    eventId: string | null;
  }): Promise<GatewayWebhookResponse>;
}

export function createGatewayService(
  options: GatewayServiceOptions,
): GatewayService {
  const checkoutReservationMs =
    options.checkoutReservationMs ?? DEFAULT_CHECKOUT_RESERVATION_MS;

  return {
    config() {
      return {
        provider: options.gateway?.provider ?? "razorpay",
        enabled: options.gateway !== null,
        testMode: options.gateway?.testMode ?? true,
      };
    },

    async createCheckout(input) {
      const gateway = requireGateway(options.gateway);
      const reservation: GatewayCheckoutReservation =
        await options.invoiceStore.reserveGatewayCheckout({
          organizationId: input.organizationId,
          invoiceId: input.invoiceId,
          provider: gateway.provider,
          actor: input.actor,
          staleAfterMs: checkoutReservationMs,
        });
      const orderInput: CreateGatewayOrderInput = {
        amountMinor: reservation.payment.amountMinor,
        currency: reservation.payment.currency,
        receipt: reservation.invoice.number,
        notes: {
          invoiceId: reservation.invoice.id,
          paymentId: reservation.payment.id,
        },
      };
      let order: GatewayOrder;

      try {
        order = await gateway.createOrder(orderInput);
        validateOrder(order, orderInput);
      } catch (error) {
        await options.invoiceStore
          .failGatewayPayment({
            organizationId: input.organizationId,
            paymentId: reservation.payment.id,
            provider: gateway.provider,
            gatewayStatus: "order_failed",
            message:
              "The gateway order could not be created. The invoice balance is unchanged; try checkout again.",
            actor: input.actor,
          })
          .catch(() => undefined);

        if (error instanceof GatewayRequestError) {
          throw error;
        }

        throw new GatewayRequestError(
          "The payment provider could not create a checkout order.",
        );
      }

      let payment: PaymentRecord;

      try {
        payment = await options.invoiceStore.attachGatewayOrder({
          organizationId: input.organizationId,
          paymentId: reservation.payment.id,
          provider: gateway.provider,
          gatewayOrderId: order.id,
          gatewayStatus: order.status,
          metadata: {
            amountMinor: order.amountMinor,
            currency: order.currency,
            status: order.status,
            createdAt: order.createdAt?.toISOString() ?? null,
          },
        });
      } catch (error) {
        await options.invoiceStore
          .failGatewayPayment({
            organizationId: input.organizationId,
            paymentId: reservation.payment.id,
            provider: gateway.provider,
            gatewayStatus: "order_attach_failed",
            message:
              "The gateway order could not be linked to this payment. Try checkout again.",
            actor: input.actor,
          })
          .catch(() => undefined);

        if (error instanceof BillingError) {
          throw error;
        }

        throw new GatewayRequestError(
          "The payment provider order could not be linked to the payment.",
        );
      }

      return {
        provider: gateway.provider,
        keyId: gateway.publicKey,
        orderId: order.id,
        payment,
        invoiceNumber: reservation.invoice.number,
        amount: {
          amountMinor: payment.amountMinor,
          currency: payment.currency,
        },
        customerName: reservation.invoice.customerName,
        customerEmail: reservation.invoice.customerEmail,
        description: `Invoice ${reservation.invoice.number}`,
        testMode: gateway.testMode,
      };
    },

    async verifyPayment(input) {
      const gateway = requireGateway(options.gateway);
      const payment = await options.invoiceStore.findPaymentById(
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
        payment.gatewayProvider !== gateway.provider ||
        payment.gatewayOrderId !== input.orderId
      ) {
        throw new PaymentStateConflictError(
          "This checkout does not match the reserved payment attempt.",
        );
      }

      if (
        !gateway.verifyCheckoutSignature({
          orderId: input.orderId,
          gatewayPaymentId: input.gatewayPaymentId,
          signature: input.signature,
        })
      ) {
        throw new GatewaySignatureError(
          "The payment signature could not be verified. No balance was updated.",
        );
      }

      const providerPayment = await gateway.fetchPayment(
        input.gatewayPaymentId,
      );

      if (
        providerPayment.id !== input.gatewayPaymentId ||
        providerPayment.orderId !== input.orderId ||
        providerPayment.amountMinor !== payment.amountMinor ||
        providerPayment.currency !== payment.currency
      ) {
        throw new GatewaySignatureError(
          "The captured payment does not match the invoice. No balance was updated.",
        );
      }

      if (providerPayment.status !== "captured") {
        throw new PaymentStateConflictError(
          "The payment has not been captured yet. Wait a moment and refresh the invoice.",
        );
      }

      return options.invoiceStore.confirmGatewayPayment({
        organizationId: input.organizationId,
        paymentId: payment.id,
        provider: gateway.provider,
        gatewayOrderId: input.orderId,
        gatewayPaymentId: input.gatewayPaymentId,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        gatewayStatus: providerPayment.status,
        actor: input.actor,
      });
    },

    async cancelCheckout(input) {
      const gateway = requireGateway(options.gateway);
      const payment = await options.invoiceStore.findPaymentById(
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
        payment.gatewayProvider !== gateway.provider
      ) {
        throw new PaymentStateConflictError(
          "This payment does not belong to the configured gateway.",
        );
      }

      if (
        payment.gatewayOrderId &&
        input.orderId &&
        payment.gatewayOrderId !== input.orderId
      ) {
        throw new PaymentStateConflictError(
          "This checkout does not match the reserved payment attempt.",
        );
      }

      if (payment.status !== "PENDING") {
        return payment;
      }

      return options.invoiceStore.failGatewayPayment({
        organizationId: input.organizationId,
        paymentId: payment.id,
        provider: gateway.provider,
        gatewayStatus: "cancelled",
        message:
          "Checkout was closed before payment was confirmed. No balance was changed; start checkout again when ready.",
        actor: input.actor,
      });
    },

    async refund(input) {
      const gateway = requireGateway(options.gateway);
      const payment = await options.invoiceStore.findPaymentById(
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
        payment.gatewayProvider !== gateway.provider ||
        !payment.gatewayPaymentId
      ) {
        throw new PaymentStateConflictError(
          "Only captured gateway payments can be refunded through the provider.",
        );
      }

      const availableMinor =
        payment.amountMinor -
        payment.refundedAmountMinor -
        pendingRefundMinor(payment);
      const amountMinor = input.amountMinor ?? availableMinor;

      if (amountMinor <= 0) {
        throw new PaymentStateConflictError(
          "This payment has no refundable balance.",
        );
      }

      const reservation = await options.invoiceStore.reserveGatewayRefund({
        organizationId: input.organizationId,
        paymentId: payment.id,
        provider: gateway.provider,
        amountMinor,
        reason: input.reason,
        actor: input.actor,
      });
      let providerRefund: GatewayRefund;

      try {
        providerRefund = await gateway.createRefund({
          gatewayPaymentId: payment.gatewayPaymentId,
          amountMinor,
          currency: payment.currency,
          notes: {
            refundId: reservation.refund.id,
            ...(input.reason ? { reason: input.reason } : {}),
          },
        });
        validateGatewayRefund(providerRefund, {
          gatewayPaymentId: payment.gatewayPaymentId,
          amountMinor,
          currency: payment.currency,
        });
      } catch (error) {
        const uncertain =
          !(error instanceof GatewayRequestError) ||
          error.providerStatus === null ||
          error.providerStatus >= 500;

        await options.invoiceStore
          .applyGatewayRefund({
            organizationId: input.organizationId,
            refundId: reservation.refund.id,
            provider: gateway.provider,
            providerRefundId: null,
            gatewayStatus: uncertain ? "request_uncertain" : "request_failed",
            status: uncertain ? "PENDING" : "FAILED",
            actor: input.actor,
          })
          .catch(() => undefined);

        if (uncertain) {
          throw new GatewayRequestError(
            "The refund request could not be confirmed. The amount remains reserved and pending; refresh the invoice before trying again.",
          );
        }

        if (error instanceof GatewayRequestError) {
          throw error;
        }

        throw new GatewayRequestError(
          "The payment provider could not process the refund.",
        );
      }

      const status =
        providerRefund.status === "processed"
          ? "SUCCEEDED"
          : providerRefund.status === "failed"
            ? "FAILED"
            : "PENDING";

      if (status === "FAILED") {
        await options.invoiceStore.applyGatewayRefund({
          organizationId: input.organizationId,
          refundId: reservation.refund.id,
          provider: gateway.provider,
          providerRefundId: providerRefund.id,
          gatewayStatus: providerRefund.status,
          status: "FAILED",
          actor: input.actor,
        });

        throw new GatewayRequestError(
          "The payment provider rejected the refund. The balance is unchanged.",
        );
      }

      const result: GatewayRefundResult =
        await options.invoiceStore.applyGatewayRefund({
          organizationId: input.organizationId,
          refundId: reservation.refund.id,
          provider: gateway.provider,
          providerRefundId: providerRefund.id,
          gatewayStatus: providerRefund.status,
          status,
          actor: input.actor,
        });

      return result;
    },

    async processWebhook(input) {
      const gateway = requireGateway(options.gateway);

      if (input.signature === null) {
        throw new GatewaySignatureError("The webhook signature is missing.");
      }

      if (!gateway.verifyWebhookSignature(input.rawBody, input.signature)) {
        throw new GatewaySignatureError("The webhook signature is invalid.");
      }

      if (!input.eventId || input.eventId.length > 160) {
        throw new GatewayPayloadError(
          "The webhook event id is missing or invalid.",
        );
      }

      const event = gateway.parseWebhookEvent({
        rawBody: input.rawBody,
        eventId: input.eventId,
      });
      const claim = await options.webhookStore.claim({
        provider: gateway.provider,
        providerEventId: input.eventId,
        eventType: event.kind === "unsupported" ? event.eventType : event.eventType,
        payload: event.raw,
      });

      if (!claim.created) {
        if (claim.inProgress) {
          throw new GatewayWebhookInProgressError();
        }

        return { status: "duplicate" };
      }

      try {
        if (event.kind === "unsupported") {
          await options.webhookStore.markProcessed(claim.event.id, {
            status: "IGNORED",
            organizationId: null,
            paymentId: null,
          });

          return { status: "ignored" };
        }

        const result = await options.invoiceStore.processGatewayEvent(event);

        await options.webhookStore.markProcessed(claim.event.id, {
          status: result.outcome === "applied" ? "PROCESSED" : "IGNORED",
          organizationId: result.organizationId,
          paymentId: result.paymentId,
        });

        return {
          status: result.outcome === "applied" ? "processed" : "ignored",
        };
      } catch (error) {
        await options.webhookStore
          .markFailed(claim.event.id, safeFailureMessage(error))
          .catch(() => undefined);
        throw error;
      }
    },
  };
}
