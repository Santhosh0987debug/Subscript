import {
  addBillingInterval,
  formatIsoDate,
} from "@subscript/shared";
import type { SubscriptionActivityType } from "@subscript/shared";
import {
  resolveSubscriptionTransition,
} from "../billing/lifecycle.js";
import type { CustomerStore } from "../customers/types.js";
import type { InvoiceStore } from "../invoices/types.js";
import { logger } from "../lib/logger.js";
import type { SubscriptionRecord, SubscriptionStore } from "../subscriptions/types.js";
import { boundedExponentialDelay } from "./backoff.js";
import type { NotificationService } from "./notifications/service.js";
import type {
  AutomationCandidateSource,
  AutomationJobDispatcher,
  AutomationJobRecord,
  AutomationRunSummary,
  AutomationStore,
  NotificationRecord,
} from "./types.js";

const AUTOMATION_ACTOR_NAME = "Subscript Automation";
const PAYMENT_RECOVERY_LOOKBACK_DAYS = 14;
const PAYMENT_RECOVERY_LOOKBACK_MS = PAYMENT_RECOVERY_LOOKBACK_DAYS * 86_400_000;

export interface AutomationServiceConfig {
  renewalReminderWindowDays: number;
  trialReminderWindowDays: number;
  invoiceDueInDays: number;
  invoiceTaxRateBps: number;
  jobMaxAttempts: number;
  jobBackoffBaseMs: number;
  jobBackoffMaxMs: number;
  paymentRetryBaseMs: number;
  paymentRetryMaxMs: number;
  paymentRetryMaxAttempts: number;
  paymentExhaustionAction: "MARK_PAST_DUE" | "CANCEL";
  pastDueExpiryDays: number;
  workerStaleMs: number;
}

export interface AutomationServiceOptions {
  store: AutomationStore;
  candidates: AutomationCandidateSource;
  subscriptions: SubscriptionStore;
  invoices: InvoiceStore;
  customers: CustomerStore;
  notifications: NotificationService;
  dispatcher?: AutomationJobDispatcher | null;
  config: AutomationServiceConfig;
}

export interface AutomationDispatchResult {
  queuedJobs: number;
  queuedNotifications: number;
}

export type AutomationJobOutcome = "succeeded" | "skipped" | "failed";

export interface AutomationService {
  runSweep(now?: Date): Promise<AutomationRunSummary>;
  processJob(jobId: string, workerId: string): Promise<AutomationJobOutcome>;
  dispatchOutbox(
    organizationId: string,
    now?: Date,
    limit?: number,
  ): Promise<AutomationDispatchResult>;
  retryJob(
    organizationId: string,
    jobId: string,
    now?: Date,
  ): Promise<AutomationJobRecord | null>;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 500);
}

function emptyBillingAddress() {
  return {
    line1: "",
    line2: "",
    city: "",
    region: "",
    country: "",
    postalCode: "",
  };
}

export function createAutomationService(
  options: AutomationServiceOptions,
): AutomationService {
  const { store, candidates, config } = options;

  async function organizationName(organizationId: string): Promise<string> {
    return (await candidates.getOrganizationName(organizationId)) ?? "Subscript";
  }

  async function ensureJob(
    organizationId: string,
    type: AutomationJobRecord["type"],
    idempotencyKey: string,
    targetType: string,
    targetId: string,
    runAt: Date,
  ): Promise<boolean> {
    const result = await store.createJob({
      organizationId,
      type,
      queue: "BILLING",
      idempotencyKey,
      targetType,
      targetId,
      runAt,
      maxAttempts: config.jobMaxAttempts,
    });

    return result.created;
  }

  async function loadSubscription(
    organizationId: string,
    subscriptionId: string,
  ): Promise<SubscriptionRecord | null> {
    return options.subscriptions.findById(organizationId, subscriptionId);
  }

  async function applyLifecycle(
    subscription: SubscriptionRecord,
    action: "renew" | "cancel" | "expire" | "markPastDue" | "activate",
    message: string,
    atPeriodEnd?: boolean,
  ): Promise<SubscriptionRecord> {
    const transition = resolveSubscriptionTransition({
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      action,
      ...(atPeriodEnd !== undefined ? { atPeriodEnd } : {}),
      ...(action === "cancel" && atPeriodEnd === false ? { force: true } : {}),
    });
    const now = new Date();
    let currentPeriodStart = subscription.currentPeriodStart;
    let currentPeriodEnd = subscription.currentPeriodEnd;

    if (transition.advancePeriod) {
      currentPeriodStart = subscription.currentPeriodEnd;
      currentPeriodEnd = addBillingInterval(
        subscription.currentPeriodEnd,
        subscription.interval,
      );
    }

    const becomingInactive =
      transition.status === "CANCELED" || transition.status === "EXPIRED";
    const activityType: SubscriptionActivityType = transition.activityType;

    return options.subscriptions.applyLifecycleChange(
      subscription.organizationId,
      subscription.id,
      {
        expectedStatus: subscription.status,
        expectedPeriodEnd: subscription.currentPeriodEnd,
        status: transition.status,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: transition.cancelAtPeriodEnd,
        canceledAt:
          transition.status === "CANCELED" ? now : subscription.canceledAt,
        pausedAt: subscription.pausedAt,
        endedAt: becomingInactive
          ? action === "renew" && subscription.cancelAtPeriodEnd
            ? subscription.currentPeriodEnd
            : now
          : subscription.endedAt,
        activity: {
          type: activityType,
          message,
          actorId: null,
          actorName: AUTOMATION_ACTOR_NAME,
        },
      },
    );
  }

  async function generateInvoice(
    subscription: SubscriptionRecord,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{ invoice: Awaited<ReturnType<InvoiceStore["generate"]>>["invoice"]; created: boolean }> {
    const customer = await options.customers.findById(
      subscription.organizationId,
      subscription.customerId,
    );
    const result = await options.invoices.generate({
      organizationId: subscription.organizationId,
      subscriptionId: subscription.id,
      customerId: subscription.customerId,
      customerName: customer?.name ?? subscription.customerName,
      customerEmail: customer?.email ?? subscription.customerEmail,
      customerCompany: customer?.company ?? null,
      billingAddress: customer?.billingAddress ?? emptyBillingAddress(),
      periodStart,
      periodEnd,
      quantity: subscription.quantity,
      unitAmountMinor: subscription.unitAmountMinor,
      currency: subscription.currency,
      lineDescription: `${subscription.planName} (${formatIsoDate(periodStart)} - ${formatIsoDate(periodEnd)})`,
      taxRateBps: config.invoiceTaxRateBps,
      dueInDays: config.invoiceDueInDays,
      actor: { actorId: null, actorName: AUTOMATION_ACTOR_NAME },
    });

    return result;
  }

  async function notifyInvoiceGenerated(
    subscription: SubscriptionRecord,
    invoice: Awaited<ReturnType<InvoiceStore["generate"]>>["invoice"],
  ): Promise<boolean> {
    const result = await options.notifications.enqueue({
      organizationId: subscription.organizationId,
      customerId: subscription.customerId,
      subscriptionId: subscription.id,
      invoiceId: invoice.id,
      type: "INVOICE_GENERATED",
      dedupeKey: `invoice-generated:${invoice.id}`,
      recipientEmail: invoice.customerEmail,
      data: {
        organizationName: await organizationName(subscription.organizationId),
        customerName: invoice.customerName,
        planName: subscription.planName,
        invoiceNumber: invoice.number,
        amountMinor: invoice.totalMinor,
        currency: invoice.currency,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
      },
    });

    return result.created;
  }

  async function notifyRenewalReminder(
    subscription: SubscriptionRecord,
  ): Promise<boolean> {
    const nextPeriodEnd = addBillingInterval(
      subscription.currentPeriodEnd,
      subscription.interval,
    );
    const result = await options.notifications.enqueue({
      organizationId: subscription.organizationId,
      customerId: subscription.customerId,
      subscriptionId: subscription.id,
      invoiceId: null,
      type: "RENEWAL_UPCOMING",
      dedupeKey: `renewal-reminder:${subscription.id}:${subscription.currentPeriodEnd.toISOString()}`,
      recipientEmail: subscription.customerEmail,
      data: {
        organizationName: await organizationName(subscription.organizationId),
        customerName: subscription.customerName,
        planName: subscription.planName,
        amountMinor: subscription.quantity * subscription.unitAmountMinor,
        currency: subscription.currency,
        effectiveDate: subscription.currentPeriodEnd,
        periodStart: subscription.currentPeriodEnd,
        periodEnd: nextPeriodEnd,
      },
    });

    return result.created;
  }

  async function notifyTrialEnding(
    subscription: SubscriptionRecord,
  ): Promise<boolean> {
    if (!subscription.trialEndsAt) {
      return false;
    }

    const result = await options.notifications.enqueue({
      organizationId: subscription.organizationId,
      customerId: subscription.customerId,
      subscriptionId: subscription.id,
      invoiceId: null,
      type: "TRIAL_ENDING",
      dedupeKey: `trial-ending:${subscription.id}:${subscription.trialEndsAt.toISOString()}`,
      recipientEmail: subscription.customerEmail,
      data: {
        organizationName: await organizationName(subscription.organizationId),
        customerName: subscription.customerName,
        planName: subscription.planName,
        amountMinor: subscription.quantity * subscription.unitAmountMinor,
        currency: subscription.currency,
        effectiveDate: subscription.trialEndsAt,
      },
    });

    return result.created;
  }

  async function notifyCanceled(
    subscription: SubscriptionRecord,
    idempotencyDate: Date,
    reason: string,
  ): Promise<boolean> {
    const result = await options.notifications.enqueue({
      organizationId: subscription.organizationId,
      customerId: subscription.customerId,
      subscriptionId: subscription.id,
      invoiceId: null,
      type: "SUBSCRIPTION_CANCELED",
      dedupeKey: `subscription-canceled:${subscription.id}:${idempotencyDate.toISOString()}`,
      recipientEmail: subscription.customerEmail,
      data: {
        organizationName: await organizationName(subscription.organizationId),
        customerName: subscription.customerName,
        planName: subscription.planName,
        effectiveDate: new Date(),
        reason,
      },
    });

    return result.created;
  }

  async function scheduleSubscriptionJobs(
    organizationId: string,
    subscription: {
      subscriptionId: string;
      status: SubscriptionRecord["status"];
      currentPeriodEnd: Date;
      trialEndsAt: Date | null;
      cancelAtPeriodEnd: boolean;
    },
    now: Date,
    created: { value: number },
  ): Promise<void> {
    const subscriptionId = subscription.subscriptionId;

    if (subscription.status === "TRIALING" && subscription.trialEndsAt) {
      const activationAt = subscription.trialEndsAt;
      const reminderAt = new Date(
        activationAt.getTime() -
          config.trialReminderWindowDays * 86_400_000,
      );

      if (activationAt.getTime() > now.getTime()) {
        const reminderRunAt =
          reminderAt.getTime() <= now.getTime() ? now : reminderAt;

        if (
          await ensureJob(
            organizationId,
            "TRIAL_ENDING_REMINDER",
            `trial-ending:${subscriptionId}:${activationAt.toISOString()}`,
            "SUBSCRIPTION",
            subscriptionId,
            reminderRunAt,
          )
        ) {
          created.value += 1;
        }
      }

      if (
        await ensureJob(
          organizationId,
          "TRIAL_ACTIVATION",
          `trial-activation:${subscriptionId}:${activationAt.toISOString()}`,
          "SUBSCRIPTION",
          subscriptionId,
          activationAt.getTime() <= now.getTime() ? now : activationAt,
        )
      ) {
        created.value += 1;
      }
    }

    if (subscription.status === "ACTIVE" && subscription.cancelAtPeriodEnd) {
      if (
        await ensureJob(
          organizationId,
          "CANCEL_AT_PERIOD_END",
          `cancel-at-period-end:${subscriptionId}:${subscription.currentPeriodEnd.toISOString()}`,
          "SUBSCRIPTION",
          subscriptionId,
          subscription.currentPeriodEnd.getTime() <= now.getTime()
            ? now
            : subscription.currentPeriodEnd,
        )
      ) {
        created.value += 1;
      }
    }

    if (subscription.status === "ACTIVE" && !subscription.cancelAtPeriodEnd) {
      const reminderAt = new Date(
        subscription.currentPeriodEnd.getTime() -
          config.renewalReminderWindowDays * 86_400_000,
      );

      if (subscription.currentPeriodEnd.getTime() > now.getTime()) {
        if (
          await ensureJob(
            organizationId,
            "RENEWAL_REMINDER",
            `renewal-reminder:${subscriptionId}:${subscription.currentPeriodEnd.toISOString()}`,
            "SUBSCRIPTION",
            subscriptionId,
            reminderAt.getTime() <= now.getTime() ? now : reminderAt,
          )
        ) {
          created.value += 1;
        }
      }

      if (
        await ensureJob(
          organizationId,
          "RECURRING_INVOICE",
          `recurring-invoice:${subscriptionId}:${subscription.currentPeriodEnd.toISOString()}`,
          "SUBSCRIPTION",
          subscriptionId,
          subscription.currentPeriodEnd.getTime() <= now.getTime()
            ? now
            : subscription.currentPeriodEnd,
        )
      ) {
        created.value += 1;
      }
    }

    if (
      subscription.status === "PAST_DUE" ||
      subscription.status === "PAUSED"
    ) {
      if (subscription.cancelAtPeriodEnd) {
        if (
          await ensureJob(
            organizationId,
            "CANCEL_AT_PERIOD_END",
            `cancel-at-period-end:${subscriptionId}:${subscription.currentPeriodEnd.toISOString()}`,
            "SUBSCRIPTION",
            subscriptionId,
            subscription.currentPeriodEnd.getTime() <= now.getTime()
              ? now
              : subscription.currentPeriodEnd,
          )
        ) {
          created.value += 1;
        }
      }
    }

    if (subscription.status === "PAST_DUE") {
      if (
        await ensureJob(
          organizationId,
          "STATUS_SYNC",
          `status-sync:${subscriptionId}:${formatIsoDate(now)}`,
          "SUBSCRIPTION",
          subscriptionId,
          now,
        )
      ) {
        created.value += 1;
      }

      const expiryCutoff = new Date(
        now.getTime() - config.pastDueExpiryDays * 86_400_000,
      );

      if (subscription.currentPeriodEnd.getTime() < expiryCutoff.getTime()) {
        if (
          await ensureJob(
            organizationId,
            "SUBSCRIPTION_EXPIRATION",
            `subscription-expiration:${subscriptionId}:${subscription.currentPeriodEnd.toISOString()}`,
            "SUBSCRIPTION",
            subscriptionId,
            now,
          )
        ) {
          created.value += 1;
        }
      }
    }
  }

  async function schedulePaymentRecovery(
    organizationId: string,
    payment: {
      paymentId: string;
      failedAt: Date;
    },
    now: Date,
    created: { value: number },
  ): Promise<void> {
    const latest = await store.findLatestJob(
      organizationId,
      "PAYMENT_RECOVERY",
      payment.paymentId,
    );

    if (!latest) {
      if (
        await ensureJob(
          organizationId,
          "PAYMENT_RECOVERY",
          `payment-recovery:${payment.paymentId}:1`,
          "PAYMENT",
          payment.paymentId,
          payment.failedAt.getTime() <= now.getTime()
            ? now
            : payment.failedAt,
        )
      ) {
        created.value += 1;
      }

      return;
    }

    if (latest.status !== "SUCCEEDED") {
      return;
    }

    const match = /:(\d+)$/.exec(latest.idempotencyKey);
    const attempt = match ? Number(match[1]) : 1;

    if (!Number.isSafeInteger(attempt) || attempt >= config.paymentRetryMaxAttempts) {
      return;
    }

    const nextAttempt = attempt + 1;
    const lastFinished = latest.finishedAt ?? latest.runAt;
    const retryAt = new Date(
      lastFinished.getTime() +
        boundedExponentialDelay(
          nextAttempt - 1,
          config.paymentRetryBaseMs,
          config.paymentRetryMaxMs,
        ),
    );

    if (
      await ensureJob(
        organizationId,
        "PAYMENT_RECOVERY",
        `payment-recovery:${payment.paymentId}:${nextAttempt}`,
        "PAYMENT",
        payment.paymentId,
        retryAt.getTime() <= now.getTime() ? now : retryAt,
      )
    ) {
      created.value += 1;
    }
  }

  async function scheduleOrganization(
    organizationId: string,
    now: Date,
  ): Promise<{
    jobsCreated: number;
    notificationsCreated: number;
  }> {
    const created = { value: 0 };
    let notificationsCreated = 0;
    const subscriptions =
      await candidates.listSubscriptionsForAutomation(organizationId);

    for (const subscription of subscriptions) {
      await scheduleSubscriptionJobs(organizationId, subscription, now, created);
    }

    const failedPayments = await candidates.listFailedPayments(
      organizationId,
      new Date(now.getTime() - PAYMENT_RECOVERY_LOOKBACK_MS),
    );

    for (const payment of failedPayments) {
      await schedulePaymentRecovery(organizationId, payment, now, created);
    }

    const succeededPayments = await candidates.listRecentSucceededPayments(
      organizationId,
      new Date(now.getTime() - PAYMENT_RECOVERY_LOOKBACK_MS),
    );

    for (const payment of succeededPayments) {
      const notification = await options.notifications.enqueue({
        organizationId,
        customerId: payment.customerId,
        subscriptionId: payment.subscriptionId,
        invoiceId: payment.invoiceId,
        type: "PAYMENT_SUCCEEDED",
        dedupeKey: `payment-succeeded:${payment.paymentId}`,
        recipientEmail: payment.customerEmail,
        data: {
          organizationName: payment.organizationName,
          customerName: payment.customerName,
          planName: payment.planName,
          invoiceNumber: payment.invoiceNumber,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          effectiveDate: payment.paidAt,
        },
      });

      if (notification.created) {
        notificationsCreated += 1;
      }

      if (
        payment.subscriptionId &&
        (await ensureJob(
          organizationId,
          "STATUS_SYNC",
          `status-sync-payment:${payment.paymentId}`,
          "SUBSCRIPTION",
          payment.subscriptionId,
          now,
        ))
      ) {
        created.value += 1;
      }
    }

    const refunds = await candidates.listRecentRefundUpdates(
      organizationId,
      new Date(now.getTime() - PAYMENT_RECOVERY_LOOKBACK_MS),
    );

    for (const refund of refunds) {
      const notification = await options.notifications.enqueue({
        organizationId,
        customerId: refund.customerId,
        subscriptionId: refund.subscriptionId,
        invoiceId: refund.invoiceId,
        type: "REFUND_UPDATED",
        dedupeKey: `refund-updated:${refund.refundId}:${refund.status}`,
        recipientEmail: refund.customerEmail,
        data: {
          organizationName: refund.organizationName,
          customerName: refund.customerName,
          planName: null,
          invoiceNumber: refund.invoiceNumber,
          amountMinor: refund.amountMinor,
          currency: refund.currency,
          statusLabel: refund.status.toLowerCase(),
          reason: refund.reason,
        },
      });

      if (notification.created) {
        notificationsCreated += 1;
      }
    }

    return {
      jobsCreated: created.value,
      notificationsCreated,
    };
  }

  async function dispatchOutbox(
    organizationId: string,
    now = new Date(),
    limit = 200,
  ): Promise<AutomationDispatchResult> {
    let queuedJobs = 0;

    if (options.dispatcher) {
      const jobs = await store.listDispatchableJobs(organizationId, now, limit);

      for (const job of jobs) {
        try {
          if (await options.dispatcher.dispatchJob(job)) {
            queuedJobs += 1;
          }
        } catch (error) {
          logger.warn("Automation job dispatch failed; it will be retried", {
            jobId: job.id,
            type: job.type,
            error: safeError(error),
          });
        }
      }
    }

    const queuedNotifications = await options.notifications.dispatchPending(
      organizationId,
      now,
      limit,
    );

    return { queuedJobs, queuedNotifications };
  }

  async function handleRenewalReminder(
    job: AutomationJobRecord,
  ): Promise<string> {
    if (!job.targetId) {
      return "No subscription target was recorded.";
    }

    const subscription = await loadSubscription(job.organizationId, job.targetId);

    if (!subscription) {
      return "The subscription no longer exists.";
    }

    if (
      subscription.status !== "ACTIVE" ||
      subscription.cancelAtPeriodEnd ||
      subscription.currentPeriodEnd.getTime() <= Date.now()
    ) {
      return "The subscription is no longer eligible for a renewal reminder.";
    }

    const created = await notifyRenewalReminder(subscription);
    return created
      ? "Renewal reminder notification created."
      : "Renewal reminder already existed.";
  }

  async function handleTrialEndingReminder(
    job: AutomationJobRecord,
  ): Promise<string> {
    if (!job.targetId) {
      return "No subscription target was recorded.";
    }

    const subscription = await loadSubscription(job.organizationId, job.targetId);

    if (!subscription || subscription.status !== "TRIALING") {
      return "The subscription is no longer trialing.";
    }

    if (!subscription.trialEndsAt) {
      return "The subscription has no trial end date.";
    }

    if (subscription.trialEndsAt.getTime() <= Date.now()) {
      return "The trial has already ended.";
    }

    const created = await notifyTrialEnding(subscription);
    return created
      ? "Trial ending notification created."
      : "Trial ending notification already existed.";
  }

  async function handleTrialActivation(
    job: AutomationJobRecord,
  ): Promise<string> {
    if (!job.targetId) {
      return "No subscription target was recorded.";
    }

    const subscription = await loadSubscription(job.organizationId, job.targetId);

    if (!subscription || subscription.status !== "TRIALING") {
      return "The subscription is no longer trialing.";
    }

    if (!subscription.trialEndsAt) {
      return "The subscription has no trial end date.";
    }

    if (subscription.trialEndsAt.getTime() > Date.now()) {
      return "The trial has not ended yet.";
    }

    const invoice = await generateInvoice(
      subscription,
      subscription.currentPeriodStart,
      subscription.currentPeriodEnd,
    );
    const activated = await applyLifecycle(
      subscription,
      "renew",
      "Converted the trial to an active subscription automatically.",
    );

    let notificationCreated = false;

    if (invoice.created) {
      notificationCreated = await notifyInvoiceGenerated(activated, invoice.invoice);
    }

    return `Trial activated and invoice ${invoice.invoice.number} ${
      invoice.created ? "generated" : "already existed"
    }${notificationCreated ? "; notification created" : ""}.`;
  }

  async function handleRecurringInvoice(
    job: AutomationJobRecord,
  ): Promise<string> {
    if (!job.targetId) {
      return "No subscription target was recorded.";
    }

    const subscription = await loadSubscription(job.organizationId, job.targetId);

    if (!subscription) {
      return "The subscription no longer exists.";
    }

    if (subscription.status !== "ACTIVE" || subscription.cancelAtPeriodEnd) {
      return "The subscription is no longer eligible for recurring billing.";
    }

    if (subscription.currentPeriodEnd.getTime() > Date.now()) {
      return "The billing period has not ended yet.";
    }

    const nextStart = subscription.currentPeriodEnd;
    const nextEnd = addBillingInterval(nextStart, subscription.interval);
    const invoice = await generateInvoice(subscription, nextStart, nextEnd);
    const renewed = await applyLifecycle(
      subscription,
      "renew",
      `Renewed for the period ${formatIsoDate(nextStart)} to ${formatIsoDate(nextEnd)} automatically.`,
    );

    let notificationCreated = false;

    if (invoice.created) {
      notificationCreated = await notifyInvoiceGenerated(renewed, invoice.invoice);
    }

    return `Recurring invoice ${invoice.invoice.number} ${
      invoice.created ? "generated" : "already existed"
    }${notificationCreated ? "; notification created" : ""}.`;
  }

  async function handleCancellation(
    job: AutomationJobRecord,
  ): Promise<string> {
    if (!job.targetId) {
      return "No subscription target was recorded.";
    }

    const subscription = await loadSubscription(job.organizationId, job.targetId);

    if (!subscription) {
      return "The subscription no longer exists.";
    }

    if (
      !subscription.cancelAtPeriodEnd ||
      subscription.currentPeriodEnd.getTime() > Date.now() ||
      subscription.status === "CANCELED" ||
      subscription.status === "EXPIRED"
    ) {
      return "The subscription is no longer eligible for period-end cancellation.";
    }

    const canceledEnd = subscription.currentPeriodEnd;
    const canceled = await applyLifecycle(
      subscription,
      "cancel",
      "Canceled automatically at the end of the paid billing period.",
      false,
    );
    await notifyCanceled(canceled, canceledEnd, "the requested cancellation date was reached");

    return "Subscription canceled at period end.";
  }

  async function handleStatusSync(job: AutomationJobRecord): Promise<string> {
    if (!job.targetId) {
      return "No subscription target was recorded.";
    }

    const subscription = await loadSubscription(job.organizationId, job.targetId);

    if (!subscription) {
      return "The subscription no longer exists.";
    }

    if (subscription.status !== "PAST_DUE") {
      return "The subscription does not need a status sync.";
    }

    const outstanding =
      await options.invoices.sumOutstandingBySubscriptions(
        job.organizationId,
        [subscription.id],
      );

    if ((outstanding.get(subscription.id) ?? 0) > 0) {
      return "The subscription still has an outstanding balance.";
    }

    await applyLifecycle(
      subscription,
      "activate",
      "Reactivated automatically after all outstanding invoices were settled.",
    );

    return "Subscription reactivated after its balance reached zero.";
  }

  async function handlePaymentRecovery(
    job: AutomationJobRecord,
  ): Promise<string> {
    if (!job.targetId) {
      return "No payment target was recorded.";
    }

    const payment = await options.invoices.findPaymentById(
      job.organizationId,
      job.targetId,
    );

    if (!payment) {
      return "The payment no longer exists.";
    }

    const invoice = await options.invoices.findById(
      job.organizationId,
      payment.invoiceId,
    );

    if (!invoice) {
      return "The invoice for this payment no longer exists.";
    }

    if (payment.status !== "FAILED" || invoice.status !== "OPEN") {
      return "The payment or invoice is no longer eligible for recovery.";
    }

    const match = /:(\d+)$/.exec(job.idempotencyKey);
    const attempt = match ? Number(match[1]) : 1;
    const maxAttempts = config.paymentRetryMaxAttempts;
    const subscription = invoice.subscriptionId
      ? await loadSubscription(job.organizationId, invoice.subscriptionId)
      : null;

    const notification = await options.notifications.enqueue({
      organizationId: job.organizationId,
      customerId: invoice.customerId,
      subscriptionId: invoice.subscriptionId,
      invoiceId: invoice.id,
      type: "PAYMENT_FAILED",
      dedupeKey: `payment-recovery:${payment.id}:${attempt}`,
      recipientEmail: invoice.customerEmail,
      data: {
        organizationName: await organizationName(job.organizationId),
        customerName: invoice.customerName,
        planName: subscription?.planName ?? null,
        invoiceNumber: invoice.number,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        retryAttempt: attempt,
        maxAttempts,
      },
    });

    if (attempt < maxAttempts) {
      return `Payment recovery notification ${attempt} of ${maxAttempts} ${
        notification.created ? "created" : "already existed"
      }.`;
    }

    let actionSummary = "no subscription status change was needed";

    if (subscription && config.paymentExhaustionAction === "MARK_PAST_DUE") {
      if (
        subscription.status === "ACTIVE" ||
        subscription.status === "TRIALING"
      ) {
        await applyLifecycle(
          subscription,
          "markPastDue",
          "Marked past due after payment recovery attempts were exhausted.",
        );
        actionSummary = "subscription marked past due";
      }
    } else if (subscription && config.paymentExhaustionAction === "CANCEL") {
      if (
        subscription.status !== "CANCELED" &&
        subscription.status !== "EXPIRED"
      ) {
        const canceled = await applyLifecycle(
          subscription,
          "cancel",
          "Canceled after payment recovery attempts were exhausted.",
          false,
        );
        await notifyCanceled(
          canceled,
          payment.updatedAt,
          "payment recovery attempts were exhausted",
        );
        actionSummary = "subscription canceled";
      }
    }

    return `Payment recovery exhausted after ${maxAttempts} attempts; ${actionSummary}. No gateway charge was initiated.`;
  }

  async function handleExpiration(job: AutomationJobRecord): Promise<string> {
    if (!job.targetId) {
      return "No subscription target was recorded.";
    }

    const subscription = await loadSubscription(job.organizationId, job.targetId);

    if (!subscription || subscription.status !== "PAST_DUE") {
      return "The subscription is no longer past due.";
    }

    const cutoff = new Date(
      Date.now() - config.pastDueExpiryDays * 86_400_000,
    );

    if (subscription.currentPeriodEnd.getTime() >= cutoff.getTime()) {
      return "The past-due grace period has not ended.";
    }

    const outstanding =
      await options.invoices.sumOutstandingBySubscriptions(
        job.organizationId,
        [subscription.id],
      );

    if ((outstanding.get(subscription.id) ?? 0) === 0) {
      return "The subscription has no outstanding balance and can be reactivated instead.";
    }

    const expiredEnd = subscription.currentPeriodEnd;
    const expired = await applyLifecycle(
      subscription,
      "expire",
      "Expired after the past-due grace period ended.",
    );
    await notifyCanceled(
      expired,
      expiredEnd,
      "the past-due grace period ended with an outstanding balance",
    );

    return "Subscription expired after the past-due grace period.";
  }

  async function executeJob(job: AutomationJobRecord): Promise<string> {
    switch (job.type) {
      case "RENEWAL_REMINDER":
        return handleRenewalReminder(job);
      case "TRIAL_ENDING_REMINDER":
        return handleTrialEndingReminder(job);
      case "TRIAL_ACTIVATION":
        return handleTrialActivation(job);
      case "RECURRING_INVOICE":
        return handleRecurringInvoice(job);
      case "CANCEL_AT_PERIOD_END":
        return handleCancellation(job);
      case "STATUS_SYNC":
        return handleStatusSync(job);
      case "PAYMENT_RECOVERY":
        return handlePaymentRecovery(job);
      case "SUBSCRIPTION_EXPIRATION":
        return handleExpiration(job);
    }
  }

  async function processJob(
    jobId: string,
    workerId: string,
  ): Promise<AutomationJobOutcome> {
    const job = await store.claimJob(jobId, workerId, new Date());

    if (!job) {
      return "skipped";
    }

    const startedAt = Date.now();

    try {
      const summary = await executeJob(job);
      const finishedAt = new Date();

      await store.completeJob(job.id, summary, finishedAt);
      logger.info("Automation job completed", {
        jobId: job.id,
        type: job.type,
        targetType: job.targetType,
        targetId: job.targetId,
        attempt: job.attempts,
        durationMs: finishedAt.getTime() - startedAt,
        summary,
      });

      return "succeeded";
    } catch (error) {
      const failedAt = new Date();
      const message = safeError(error);
      const retryAt =
        job.attempts < job.maxAttempts
          ? new Date(
              failedAt.getTime() +
                boundedExponentialDelay(
                  job.attempts,
                  config.jobBackoffBaseMs,
                  config.jobBackoffMaxMs,
                ),
            )
          : null;

      await store.failJob(job.id, { lastError: message, retryAt }, failedAt);
      logger.warn("Automation job failed", {
        jobId: job.id,
        type: job.type,
        targetType: job.targetType,
        targetId: job.targetId,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
        willRetry: retryAt !== null,
        error: message,
      });

      return "failed";
    }
  }

  async function runSweep(now = new Date()): Promise<AutomationRunSummary> {
    const staleBefore = new Date(now.getTime() - config.workerStaleMs);
    const queuedBefore = new Date(
      now.getTime() - Math.max(config.workerStaleMs, 60_000),
    );
    const staleJobs = await store.recoverStaleJobs(
      staleBefore,
      queuedBefore,
      now,
    );
    const staleNotifications = await store.recoverStaleNotifications(
      staleBefore,
      queuedBefore,
      now,
    );
    const organizationIds = await candidates.listOrganizationIds();
    let jobsCreated = 0;
    let jobsDispatched = 0;
    let notificationsCreated = 0;
    let notificationsDispatched = 0;

    for (const organizationId of organizationIds) {
      const scheduled = await scheduleOrganization(organizationId, now);
      jobsCreated += scheduled.jobsCreated;
      notificationsCreated += scheduled.notificationsCreated;

      const dispatched = await dispatchOutbox(organizationId, now);
      jobsDispatched += dispatched.queuedJobs;
      notificationsDispatched += dispatched.queuedNotifications;
    }

    logger.info("Automation sweep completed", {
      organizations: organizationIds.length,
      jobsCreated,
      jobsDispatched,
      notificationsCreated,
      notificationsDispatched,
      staleJobsRecovered: staleJobs.running + staleJobs.queued,
      staleNotificationsRecovered:
        staleNotifications.sending + staleNotifications.queued,
    });

    return {
      organizations: organizationIds.length,
      jobsCreated,
      jobsDispatched,
      notificationsCreated,
      notificationsDispatched,
      staleJobsRecovered: staleJobs.running + staleJobs.queued,
      staleNotificationsRecovered:
        staleNotifications.sending + staleNotifications.queued,
    };
  }

  async function retryJob(
    organizationId: string,
    jobId: string,
    now = new Date(),
  ) {
    const job = await store.retryJob(organizationId, jobId, now);

    if (!job) {
      return null;
    }

    if (options.dispatcher) {
      try {
        await options.dispatcher.dispatchJob(job);
      } catch (error) {
        logger.warn("Retried job could not be dispatched yet", {
          jobId: job.id,
          error: safeError(error),
        });
      }
    }

    return job;
  }

  return {
    runSweep,
    processJob,
    dispatchOutbox,
    retryJob,
  };
}

export type { NotificationRecord };
