import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Ban,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  FileText,
  Pause,
  Play,
  Plus,
  ReceiptText,
  RefreshCw,
  Sparkles,
  Wallet,
  XCircle,
} from "lucide-react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  addBillingInterval,
  calculateInvoiceTotals,
  formatIsoDate,
  parseIsoDate,
  type SubscriptionActivityType,
  type SubscriptionResponse,
} from "@subscript/shared";
import { useAuth } from "@/auth/AuthProvider";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { TextField } from "@/components/ui/TextField";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  ApiClientError,
  cancelSubscription,
  expireSubscription,
  generateSubscriptionInvoice,
  getSubscription,
  markSubscriptionPastDue,
  pauseSubscription,
  renewSubscription,
  resumeSubscription,
} from "@/lib/api";
import {
  formatActivityTime,
  formatBillingDate,
  formatBillingPeriod,
  getNextBillingSummary,
  getSubscriptionActionAvailability,
  invoiceStatusLabels,
  invoiceStatusTones,
  paymentMethodLabels,
  paymentStatusLabels,
  paymentStatusTones,
  subscriptionActivityLabels,
  subscriptionStatusLabels,
  subscriptionStatusTones,
} from "@/lib/billing";
import {
  parseTaxRateBps,
  validateGenerateInvoiceForm,
  type BillingFormErrors,
  type GenerateInvoiceFormValues,
} from "@/lib/billing-validation";
import { billingIntervalLabels, getTrialLabel } from "@/lib/catalogue";
import { cn } from "@/lib/cn";
import {
  getErrorMessage,
  getFieldErrors,
  isUnauthorizedError,
} from "@/lib/errors";
import { formatMoney } from "@/lib/money";

type DetailState =
  | { status: "loading" }
  | { status: "ready"; data: SubscriptionResponse }
  | { status: "notfound" }
  | { status: "error"; message: string };

type LifecycleAction =
  | "pause"
  | "resume"
  | "cancelAtPeriodEnd"
  | "cancelImmediately"
  | "renew"
  | "markPastDue"
  | "expire";

const activityStyles: Record<
  SubscriptionActivityType,
  { icon: typeof Plus; className: string }
> = {
  CREATED: { icon: Plus, className: "bg-lime text-ink" },
  TRIAL_STARTED: {
    icon: Sparkles,
    className: "bg-[#e9d9bf] text-[#594831]",
  },
  ACTIVATED: { icon: CheckCircle2, className: "bg-lime text-ink" },
  PAST_DUE: { icon: AlertTriangle, className: "bg-coral-soft text-coral" },
  PAUSED: { icon: Pause, className: "bg-ink/[0.07] text-ink-soft" },
  RESUMED: { icon: Play, className: "bg-lime text-ink" },
  CANCEL_SCHEDULED: {
    icon: CalendarClock,
    className: "bg-ink/[0.07] text-ink-soft",
  },
  CANCELED: { icon: XCircle, className: "bg-coral-soft text-coral" },
  RENEWED: { icon: RefreshCw, className: "bg-lime text-ink" },
  EXPIRED: { icon: Ban, className: "bg-ink/[0.07] text-ink-soft" },
};

const actionTitles: Record<LifecycleAction, string> = {
  pause: "Pause this subscription?",
  resume: "Resume this subscription?",
  cancelAtPeriodEnd: "Schedule cancellation?",
  cancelImmediately: "Cancel immediately?",
  renew: "Renew this subscription?",
  markPastDue: "Mark this subscription past due?",
  expire: "Expire this subscription?",
};

const actionLabels: Record<LifecycleAction, string> = {
  pause: "Pause subscription",
  resume: "Resume subscription",
  cancelAtPeriodEnd: "Schedule cancellation",
  cancelImmediately: "Cancel immediately",
  renew: "Renew now",
  markPastDue: "Mark past due",
  expire: "Expire subscription",
};

function DetailSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-8">
      <span className="sr-only">Loading subscription</span>
      <div className="space-y-4">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-16 w-full max-w-xl rounded-2xl" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>
      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="p-6 xl:col-span-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-5 h-16 w-52 rounded-2xl" />
          <Skeleton className="mt-5 h-3 w-32" />
        </Card>
        <Card className="p-6 xl:col-span-7">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-6 h-3 w-full" />
          <Skeleton className="mt-3 h-3 w-5/6" />
          <Skeleton className="mt-6 h-32 w-full rounded-2xl" />
        </Card>
      </div>
    </div>
  );
}

export default function SubscriptionDetailPage() {
  const { subscriptionId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { activeOrganization, refresh } = useAuth();
  const navigationState = location.state as { notice?: string } | null;
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(
    navigationState?.notice ?? null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<LifecycleAction | null>(
    null,
  );
  const [confirmAction, setConfirmAction] = useState<LifecycleAction | null>(
    null,
  );
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState<GenerateInvoiceFormValues>({
    taxRate: "0",
    dueInDays: "7",
    description: "",
  });
  const [invoiceErrors, setInvoiceErrors] = useState<BillingFormErrors>({});
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const organizationId = activeOrganization?.id;
  const canManage =
    activeOrganization?.role === "OWNER" || activeOrganization?.role === "ADMIN";
  const subscription = state.status === "ready" ? state.data.subscription : null;

  useDocumentTitle(subscription?.customerName ?? "Subscription");

  useEffect(() => {
    if (navigationState?.notice) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, navigate, navigationState]);

  useEffect(() => {
    if (!organizationId || !subscriptionId) {
      setState({ status: "notfound" });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading" });

    getSubscription(subscriptionId, controller.signal)
      .then((data) => {
        setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (isUnauthorizedError(error)) {
          void refresh();
        }

        if (error instanceof ApiClientError && error.status === 404) {
          setState({ status: "notfound" });
          return;
        }

        setState({
          status: "error",
          message: getErrorMessage(
            error,
            "This subscription could not be loaded.",
          ),
        });
      });

    return () => {
      controller.abort();
    };
  }, [organizationId, subscriptionId, reloadKey, refresh]);

  const availability = subscription
    ? getSubscriptionActionAvailability(
        subscription.status,
        subscription.cancelAtPeriodEnd,
      )
    : null;

  const confirmDescription = useMemo(() => {
    if (!subscription || !confirmAction) {
      return "";
    }

    switch (confirmAction) {
      case "pause":
        return "Billing activity pauses until you resume. Existing invoices and payments are unchanged.";
      case "resume":
        return "Billing resumes from the current period. The next billing date stays visible on the subscription.";
      case "cancelAtPeriodEnd":
        return `Service continues until ${formatBillingDate(
          subscription.currentPeriodEnd,
        )}, then the subscription is canceled automatically on renewal.`;
      case "cancelImmediately":
        return "This ends the subscription now. Issued invoices, payments, and history are preserved for audit.";
      case "renew":
        if (subscription.status === "TRIALING") {
          return "The trial converts to an active subscription. The current paid period does not advance.";
        }

        return `The billing period advances to ${formatBillingPeriod(
          subscription.currentPeriodEnd,
          formatIsoDate(
            addBillingInterval(
              parseIsoDate(subscription.currentPeriodEnd) ?? new Date(),
              subscription.interval,
            ),
          ),
        )}.`;
      case "markPastDue":
        return "Use this when payment has not arrived. The subscription shows PAST_DUE until you renew or collect payment.";
      case "expire":
        return "This ends the subscription immediately and cannot be undone. Historical invoices and payments remain.";
    }
  }, [confirmAction, subscription]);

  async function runLifecycle(action: LifecycleAction): Promise<void> {
    if (!subscription || pendingAction) {
      return;
    }

    setPendingAction(action);
    setActionError(null);
    setNotice(null);

    try {
      const response =
        action === "pause"
          ? await pauseSubscription(subscription.id)
          : action === "resume"
            ? await resumeSubscription(subscription.id)
            : action === "renew"
              ? await renewSubscription(subscription.id)
              : action === "markPastDue"
                ? await markSubscriptionPastDue(subscription.id)
                : action === "expire"
                  ? await expireSubscription(subscription.id)
                  : action === "cancelAtPeriodEnd"
                    ? await cancelSubscription(subscription.id, {
                        atPeriodEnd: true,
                      })
                    : await cancelSubscription(subscription.id, {
                        atPeriodEnd: false,
                      });

      applyLifecycleResult(action, response.subscription.status);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        void refresh();
      }

      setActionError(
        getErrorMessage(error, "The subscription could not be updated."),
      );
    } finally {
      setPendingAction(null);
    }
  }

  function applyLifecycleResult(
    action: LifecycleAction,
    status: SubscriptionResponse["subscription"]["status"],
  ): void {
    const messages: Record<LifecycleAction, string> = {
      pause: "Subscription paused.",
      resume: "Subscription resumed.",
      cancelAtPeriodEnd:
        "Cancellation scheduled for the end of the current billing period.",
      cancelImmediately: "Subscription canceled immediately.",
      renew:
        status === "CANCELED"
          ? "Subscription ended at the end of its billing period."
          : "Subscription renewed and ready for the next period.",
      markPastDue: "Subscription marked past due.",
      expire: "Subscription expired.",
    };

    setNotice(messages[action]);
    setConfirmAction(null);
    setReloadKey((current) => current + 1);
  }

  async function handleGenerateInvoice(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    if (!subscription || generating) {
      return;
    }

    const validation = validateGenerateInvoiceForm(invoiceForm);

    if (Object.keys(validation.errors).length > 0) {
      setInvoiceErrors(validation.errors);
      setInvoiceError("Review the highlighted fields before generating.");
      return;
    }

    setGenerating(true);
    setInvoiceErrors({});
    setInvoiceError(null);

    try {
      const response = await generateSubscriptionInvoice(subscription.id, {
        taxRateBps: validation.taxRateBps ?? 0,
        dueInDays: validation.dueInDays,
        description: validation.description,
      });

      navigate(`/invoices/${response.invoice.id}`, {
        state: {
          notice: response.created
            ? `Draft invoice ${response.invoice.number} generated. Review it and issue when ready.`
            : `An invoice already exists for this billing period. Opened ${response.invoice.number}.`,
        },
      });
    } catch (error) {
      if (isUnauthorizedError(error)) {
        void refresh();
      }

      const serverErrors = getFieldErrors(error);

      if (Object.keys(serverErrors).length > 0) {
        setInvoiceErrors(serverErrors);
      }

      setInvoiceError(
        getErrorMessage(error, "The invoice could not be generated."),
      );
    } finally {
      setGenerating(false);
    }
  }

  function updateInvoiceField<K extends keyof GenerateInvoiceFormValues>(
    key: K,
    value: GenerateInvoiceFormValues[K],
  ): void {
    setInvoiceForm((current) => ({ ...current, [key]: value }));
    setInvoiceErrors((current) => {
      if (!(key in current)) {
        return current;
      }

      const next = { ...current };
      delete next[key];
      return next;
    });
    setInvoiceError(null);
  }

  if (state.status === "loading") {
    return <DetailSkeleton />;
  }

  if (state.status === "notfound") {
    return (
      <EmptyState
        icon={CreditCard}
        title="Subscription not found."
        description="It may belong to another workspace or no longer exist. Return to the lifecycle list to continue."
        action={
          <Link to="/subscriptions" className={buttonClassName({ size: "sm" })}>
            <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
            Back to subscriptions
          </Link>
        }
      />
    );
  }

  if (state.status === "error") {
    return (
      <Card className="p-6">
        <Alert tone="error">
          <p className="font-semibold">Subscription could not load.</p>
          <p className="mt-1 text-coral/85">{state.message}</p>
        </Alert>
        <div className="mt-4 flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setReloadKey((current) => current + 1)}
          >
            <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
            Try again
          </Button>
          <Link
            to="/subscriptions"
            className={buttonClassName({ variant: "ghost", size: "sm" })}
          >
            Back to list
          </Link>
        </div>
      </Card>
    );
  }

  const { activities, invoices, payments } = state.data;
  const record = state.data.subscription;
  const nextBilling = getNextBillingSummary(record);
  const subtotalMinor =
    record.price.amountMinor * record.quantity;
  const estimatedTaxRateBps = parseTaxRateBps(invoiceForm.taxRate) ?? 0;
  const estimate = calculateInvoiceTotals(subtotalMinor, estimatedTaxRateBps);

  return (
    <>
      <Link
        to="/subscriptions"
        className="inline-flex items-center gap-2 text-[12px] font-semibold text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
        Back to subscriptions
      </Link>

      <div className="mt-6">
        <PageHeader
          eyebrow="Subscriptions · Detail"
          title={record.customerName}
          description={`${record.planName} · ${
            billingIntervalLabels[record.interval]
          } · ${record.quantity} ${
            record.quantity === 1 ? "unit" : "units"
          } at ${formatMoney(
            record.price.amountMinor,
            record.price.currency,
          )}.`}
          actions={
            <>
              <Badge
                tone={subscriptionStatusTones[record.status]}
                className="h-8 px-3"
              >
                {subscriptionStatusLabels[record.status]}
              </Badge>
              <Link
                to={`/customers/${record.customerId}`}
                className={buttonClassName({ variant: "secondary", size: "sm" })}
              >
                Customer
                <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
              </Link>
              <Link to="/invoices" className={buttonClassName({ variant: "secondary", size: "sm" })}>
                <ReceiptText aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                Invoices
              </Link>
            </>
          }
        />
      </div>

      {notice ? (
        <Alert tone="success" className="mt-7">
          {notice}
        </Alert>
      ) : null}

      <div className="mt-7 grid gap-4 xl:grid-cols-12">
        <Card className="relative overflow-hidden p-6 sm:p-7 xl:col-span-5">
          <span
            aria-hidden="true"
            className="absolute -right-10 -top-12 h-40 w-40 rounded-full bg-lime/35 blur-2xl"
          />
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <p className="eyebrow">Recurring value</p>
              <Badge tone={subscriptionStatusTones[record.status]}>
                {subscriptionStatusLabels[record.status]}
              </Badge>
            </div>

            <p className="mt-5 font-display text-[clamp(2.7rem,5vw,4rem)] leading-[0.9] tracking-[-0.05em] text-ink">
              {formatMoney(subtotalMinor, record.price.currency)}
            </p>
            <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-muted">
              per {record.interval === "MONTH" ? "month" : "year"} ·{" "}
              {record.price.currency}
            </p>

            <dl className="mt-6 space-y-3 border-t border-line pt-5 text-[11.5px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{nextBilling.label}</dt>
                <dd className="text-right font-semibold text-ink">
                  {nextBilling.date}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Current period</dt>
                <dd className="text-right text-ink-soft">
                  {formatBillingPeriod(
                    record.currentPeriodStart,
                    record.currentPeriodEnd,
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Trial</dt>
                <dd className="text-right text-ink-soft">
                  {getTrialLabel(record.trialDays)}
                  {record.trialEndsAt
                    ? ` · ends ${formatBillingDate(record.trialEndsAt)}`
                    : ""}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Outstanding</dt>
                <dd
                  className={cn(
                    "text-right font-semibold",
                    record.outstanding.amountMinor > 0
                      ? "text-coral"
                      : "text-ink",
                  )}
                >
                  {formatMoney(
                    record.outstanding.amountMinor,
                    record.outstanding.currency,
                  )}
                </dd>
              </div>
            </dl>

            {record.cancelAtPeriodEnd ? (
              <Alert tone="info" className="mt-5">
                Cancellation is scheduled for{" "}
                {formatBillingDate(record.currentPeriodEnd)}.
              </Alert>
            ) : null}
          </div>
        </Card>

        <Card className="p-6 sm:p-7 xl:col-span-7">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Lifecycle controls</p>
              <h2 className="mt-2 font-display text-2xl leading-tight tracking-[-0.02em] text-ink">
                Move the subscription deliberately.
              </h2>
              <p className="mt-2 max-w-xl text-[11.5px] leading-5 text-muted">
                Every action is validated against the current state and recorded
                in the timeline with your name.
              </p>
            </div>
            {!canManage ? (
              <Badge tone="outline">Read-only</Badge>
            ) : null}
          </div>

          {actionError ? (
            <Alert tone="error" className="mt-4">
              {actionError}
            </Alert>
          ) : null}

          {canManage && confirmAction ? (
            <div className="mt-5 rounded-2xl border border-line-strong bg-surface-raised/70 p-4">
              <div className="flex items-start gap-2.5">
                <AlertTriangle
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-coral"
                  strokeWidth={2}
                />
                <div>
                  <p className="text-[12px] font-semibold text-ink">
                    {actionTitles[confirmAction]}
                  </p>
                  <p className="mt-1 text-[11px] leading-5 text-muted">
                    {confirmDescription}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={pendingAction !== null}
                  onClick={() => void runLifecycle(confirmAction)}
                  className={
                    confirmAction === "cancelImmediately" ||
                    confirmAction === "expire"
                      ? "border-coral bg-coral text-white hover:bg-coral/90"
                      : undefined
                  }
                >
                  {pendingAction === confirmAction
                    ? "Working..."
                    : actionLabels[confirmAction]}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pendingAction !== null}
                  onClick={() => setConfirmAction(null)}
                >
                  Keep as is
                </Button>
              </div>
            </div>
          ) : canManage ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {availability?.pause ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setConfirmAction("pause")}
                >
                  <Pause aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                  Pause
                </Button>
              ) : null}
              {availability?.resume ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setConfirmAction("resume")}
                >
                  <Play aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                  Resume
                </Button>
              ) : null}
              {availability?.renew ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setConfirmAction("renew")}
                >
                  <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                  {record.status === "TRIALING" ? "Convert trial" : "Renew now"}
                </Button>
              ) : null}
              {availability?.markPastDue ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setConfirmAction("markPastDue")}
                >
                  <AlertTriangle
                    aria-hidden="true"
                    className="h-3.5 w-3.5"
                    strokeWidth={2}
                  />
                  Mark past due
                </Button>
              ) : null}
              {availability?.cancelAtPeriodEnd ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setConfirmAction("cancelAtPeriodEnd")}
                >
                  <CalendarClock
                    aria-hidden="true"
                    className="h-3.5 w-3.5"
                    strokeWidth={2}
                  />
                  Cancel at period end
                </Button>
              ) : null}
              {availability?.cancelImmediately ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-coral"
                  onClick={() => setConfirmAction("cancelImmediately")}
                >
                  <XCircle
                    aria-hidden="true"
                    className="h-3.5 w-3.5"
                    strokeWidth={2}
                  />
                  Cancel immediately
                </Button>
              ) : null}
              {availability?.expire ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-coral"
                  onClick={() => setConfirmAction("expire")}
                >
                  <Ban aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                  Expire
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="mt-5 text-[11.5px] leading-5 text-muted">
              Owners and admins can change lifecycle state. You can still follow
              invoices, payments, and activity here.
            </p>
          )}

          <div className="mt-6 grid gap-3 border-t border-line pt-5 sm:grid-cols-2">
            <div className="rounded-xl bg-surface-raised/70 px-3.5 py-3">
              <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                Started
              </p>
              <p className="mt-1 text-[11.5px] text-ink-soft">
                {formatBillingDate(record.startedAt)}
              </p>
            </div>
            <div className="rounded-xl bg-surface-raised/70 px-3.5 py-3">
              <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                {record.canceledAt ? "Canceled" : "Last updated"}
              </p>
              <p className="mt-1 text-[11.5px] text-ink-soft">
                {formatBillingDate(
                  record.canceledAt ?? record.updatedAt,
                )}
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-12">
        <Card className="p-6 sm:p-7 xl:col-span-7">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Billing history</p>
              <h2 className="mt-2 font-display text-2xl leading-tight tracking-[-0.02em] text-ink">
                Invoices for this subscription.
              </h2>
            </div>
            <ReceiptText
              aria-hidden="true"
              className="h-5 w-5 text-muted"
              strokeWidth={1.7}
            />
          </div>

          {invoices.length === 0 ? (
            <p className="mt-5 rounded-xl border border-dashed border-line-strong bg-surface-raised/60 px-4 py-6 text-center text-[11.5px] text-muted">
              No invoices yet. Generate a draft for the current period when the
              billing details are ready.
            </p>
          ) : (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="pb-2 font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                      Invoice
                    </th>
                    <th className="pb-2 font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                      Period
                    </th>
                    <th className="pb-2 font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                      Status
                    </th>
                    <th className="pb-2 text-right font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                      Due
                    </th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="group">
                      <td className="py-3 pr-3">
                        <Link
                          to={`/invoices/${invoice.id}`}
                          className="text-[11.5px] font-semibold text-ink group-hover:underline"
                        >
                          {invoice.number}
                        </Link>
                        <p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-muted">
                          {formatBillingDate(
                            invoice.issuedAt ?? invoice.createdAt,
                          )}
                        </p>
                      </td>
                      <td className="py-3 pr-3 text-[10px] text-muted">
                        {formatBillingPeriod(
                          invoice.periodStart,
                          invoice.periodEnd,
                        )}
                      </td>
                      <td className="py-3 pr-3">
                        <Badge tone={invoiceStatusTones[invoice.status]}>
                          {invoiceStatusLabels[invoice.status]}
                        </Badge>
                      </td>
                      <td className="py-3 pr-3 text-right text-[11px] font-semibold text-ink">
                        {formatMoney(
                          invoice.amountDue.amountMinor,
                          invoice.amountDue.currency,
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <Link
                          to={`/invoices/${invoice.id}`}
                          aria-label={`Open invoice ${invoice.number}`}
                          className="inline-grid h-7 w-7 place-items-center rounded-full text-muted transition-colors hover:bg-ink hover:text-surface"
                        >
                          <ArrowUpRight
                            aria-hidden="true"
                            className="h-3 w-3"
                            strokeWidth={2}
                          />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canManage && availability?.generateInvoice ? (
            <div className="mt-6 border-t border-line pt-5">
              {!invoiceOpen ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11.5px] font-semibold text-ink">
                      Ready to bill this period?
                    </p>
                    <p className="mt-1 text-[10.5px] text-muted">
                      {formatBillingPeriod(
                        record.currentPeriodStart,
                        record.currentPeriodEnd,
                      )}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setInvoiceOpen(true)}
                  >
                    <FileText
                      aria-hidden="true"
                      className="h-3.5 w-3.5"
                      strokeWidth={2}
                    />
                    Generate invoice
                  </Button>
                </div>
              ) : (
                <form
                  onSubmit={(event) => void handleGenerateInvoice(event)}
                  noValidate
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11.5px] font-semibold text-ink">
                      Generate a draft invoice
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setInvoiceOpen(false);
                        setInvoiceErrors({});
                        setInvoiceError(null);
                      }}
                    >
                      Close
                    </Button>
                  </div>
                  <p className="mt-1 text-[10.5px] leading-4 text-muted">
                    Duplicate generation for the same period returns the existing
                    invoice. Drafts become collectable only after issue.
                  </p>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <TextField
                      label="Tax rate (%)"
                      value={invoiceForm.taxRate}
                      onChange={(value) => updateInvoiceField("taxRate", value)}
                      inputMode="decimal"
                      error={invoiceErrors.taxRate}
                      hint="For example 8.25 for 8.25%."
                    />
                    <TextField
                      label="Due in days"
                      value={invoiceForm.dueInDays}
                      onChange={(value) => updateInvoiceField("dueInDays", value)}
                      inputMode="numeric"
                      error={invoiceErrors.dueInDays}
                    />
                  </div>
                  <TextField
                    label="Line description (optional)"
                    value={invoiceForm.description}
                    onChange={(value) =>
                      updateInvoiceField("description", value)
                    }
                    error={invoiceErrors.description}
                    className="mt-3"
                    maxLength={300}
                  />

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-raised/70 px-3.5 py-3">
                    <div>
                      <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                        Estimated total
                      </p>
                      <p className="mt-1 text-[13px] font-semibold text-ink">
                        {formatMoney(estimate.totalMinor, record.price.currency)}
                      </p>
                    </div>
                    <Button type="submit" size="sm" disabled={generating}>
                      {generating ? "Generating..." : "Generate draft"}
                    </Button>
                  </div>

                  {invoiceError ? (
                    <Alert tone="error" className="mt-3">
                      {invoiceError}
                    </Alert>
                  ) : null}
                </form>
              )}
            </div>
          ) : null}
        </Card>

        <Card className="p-6 sm:p-7 xl:col-span-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Payments</p>
              <h2 className="mt-2 font-display text-2xl leading-tight tracking-[-0.02em] text-ink">
                Recorded against this subscription.
              </h2>
            </div>
            <Wallet
              aria-hidden="true"
              className="h-5 w-5 text-muted"
              strokeWidth={1.7}
            />
          </div>

          {payments.length === 0 ? (
            <p className="mt-5 rounded-xl border border-dashed border-line-strong bg-surface-raised/60 px-4 py-6 text-center text-[11.5px] text-muted">
              No payments recorded. Open an invoice to add a manual payment or
              confirm a pending attempt.
            </p>
          ) : (
            <ul className="mt-5 divide-y divide-line">
              {payments.map((payment) => (
                <li key={payment.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        to={`/invoices/${payment.invoiceId}`}
                        className="text-[11.5px] font-semibold text-ink hover:underline"
                      >
                        {payment.invoiceNumber}
                      </Link>
                      <p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-muted">
                        {paymentMethodLabels[payment.method]} ·{" "}
                        {formatBillingDate(
                          payment.paidAt ?? payment.createdAt,
                        )}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11.5px] font-semibold text-ink">
                        {formatMoney(
                          payment.amount.amountMinor,
                          payment.amount.currency,
                        )}
                      </p>
                      <Badge
                        tone={paymentStatusTones[payment.status]}
                        className="mt-1"
                      >
                        {paymentStatusLabels[payment.status]}
                      </Badge>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4 p-6 sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Lifecycle timeline</p>
            <h2 className="mt-2 font-display text-2xl leading-tight tracking-[-0.02em] text-ink">
              Every state change, in order.
            </h2>
          </div>
          <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted">
            {activities.length} events
          </span>
        </div>

        <ol className="mt-6 space-y-0">
          {activities.map((activity, index) => {
            const style = activityStyles[activity.type];
            const Icon = style.icon;

            return (
              <li key={activity.id} className="relative flex gap-3 pb-6 last:pb-0">
                {index < activities.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-line"
                  />
                ) : null}
                <span
                  className={cn(
                    "relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full",
                    style.className,
                  )}
                >
                  <Icon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.9} />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[11.5px] font-semibold text-ink">
                      {subscriptionActivityLabels[activity.type]}
                    </p>
                    <p className="font-mono text-[8px] uppercase tracking-[0.08em] text-muted">
                      {formatActivityTime(activity.createdAt)}
                    </p>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-muted">
                    {activity.message}
                  </p>
                  <p className="mt-0.5 text-[9.5px] text-muted/80">
                    {activity.actorName ?? "System"}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
    </>
  );
}
