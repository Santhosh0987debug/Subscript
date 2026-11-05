import { useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  CircleAlert,
  FileText,
  Plus,
  Printer,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Send,
  Wallet,
  XCircle,
} from "lucide-react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import type {
  Invoice,
  InvoiceActivityType,
  InvoiceResponse,
  Payment,
  PaymentMethod,
  RecordablePaymentStatus,
} from "@subscript/shared";
import { useAuth } from "@/auth/AuthProvider";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { SelectField } from "@/components/ui/SelectField";
import { Skeleton } from "@/components/ui/Skeleton";
import { TextField } from "@/components/ui/TextField";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  ApiClientError,
  failPayment,
  getInvoice,
  issueInvoice,
  markInvoiceUncollectible,
  recordPayment,
  refundPayment,
  succeedPayment,
  voidInvoice,
} from "@/lib/api";
import {
  formatActivityTime,
  formatBillingDate,
  formatBillingPeriod,
  formatTaxRateBps,
  getInvoiceActionAvailability,
  getPaymentActionAvailability,
  invoiceActivityLabels,
  invoiceStatusLabels,
  invoiceStatusTones,
  paymentMethodLabels,
  paymentSourceLabels,
  paymentStatusLabels,
  paymentStatusTones,
} from "@/lib/billing";
import {
  validatePaymentForm,
  type BillingFormErrors,
  type PaymentFormValues,
} from "@/lib/billing-validation";
import { cn } from "@/lib/cn";
import {
  getErrorMessage,
  getFieldErrors,
  isUnauthorizedError,
} from "@/lib/errors";
import {
  formatMajorAmount,
  formatMoney,
} from "@/lib/money";

type DetailState =
  | { status: "loading" }
  | { status: "ready"; data: InvoiceResponse }
  | { status: "notfound" }
  | { status: "error"; message: string };

type InvoiceAction = "issue" | "void" | "markUncollectible";
type PaymentAction = "succeed" | "fail" | "refund";

const paymentMethodOptions = (
  ["CASH", "BANK_TRANSFER", "CARD", "CHECK", "OTHER"] as PaymentMethod[]
).map((method) => ({
  value: method,
  label: paymentMethodLabels[method],
}));

const recordableStatusOptions: Array<{
  value: RecordablePaymentStatus;
  label: string;
}> = [
  { value: "SUCCEEDED", label: "Succeeded - apply now" },
  { value: "PENDING", label: "Pending - confirm later" },
];

const invoiceActivityStyles: Record<
  InvoiceActivityType,
  { icon: typeof Plus; className: string }
> = {
  CREATED: { icon: Plus, className: "bg-lime text-ink" },
  ISSUED: { icon: Send, className: "bg-lime text-ink" },
  VOIDED: { icon: Ban, className: "bg-ink/[0.07] text-ink-soft" },
  MARKED_UNCOLLECTIBLE: {
    icon: AlertTriangle,
    className: "bg-coral-soft text-coral",
  },
  PAYMENT_RECORDED: { icon: Wallet, className: "bg-ink/[0.07] text-ink-soft" },
  PAYMENT_SUCCEEDED: { icon: CheckCircle2, className: "bg-lime text-ink" },
  PAYMENT_FAILED: { icon: XCircle, className: "bg-coral-soft text-coral" },
  PAYMENT_REFUNDED: {
    icon: RotateCcw,
    className: "bg-[#e9d9bf] text-[#594831]",
  },
};

const invoiceActionCopy: Record<
  InvoiceAction,
  { title: string; description: string; confirm: string }
> = {
  issue: {
    title: "Issue this invoice?",
    description:
      "Issuing makes the invoice collectable and sets its due date. Draft edits stop being available.",
    confirm: "Issue invoice",
  },
  void: {
    title: "Void this invoice?",
    description:
      "Voiding keeps the invoice and its history for audit, but removes it from outstanding balances.",
    confirm: "Void invoice",
  },
  markUncollectible: {
    title: "Mark this invoice uncollectible?",
    description:
      "Use this for a debt you do not expect to collect. The record remains visible and cannot be deleted.",
    confirm: "Mark uncollectible",
  },
};

function emptyPaymentForm(invoice: Invoice): PaymentFormValues {
  return {
    amount: formatMajorAmount(
      invoice.amountDue.amountMinor,
      invoice.amountDue.currency,
    ),
    method: "BANK_TRANSFER",
    reference: "",
    note: "",
    status: "SUCCEEDED",
  };
}

function DetailSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-8">
      <span className="sr-only">Loading invoice</span>
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

export default function InvoiceDetailPage() {
  const { invoiceId = "" } = useParams();
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
  const [pendingInvoiceAction, setPendingInvoiceAction] =
    useState<InvoiceAction | null>(null);
  const [confirmInvoiceAction, setConfirmInvoiceAction] =
    useState<InvoiceAction | null>(null);
  const [confirmPayment, setConfirmPayment] = useState<{
    payment: Payment;
    action: PaymentAction;
  } | null>(null);
  const [pendingPaymentId, setPendingPaymentId] = useState<string | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentFormValues>({
    amount: "",
    method: "BANK_TRANSFER",
    reference: "",
    note: "",
    status: "SUCCEEDED",
  });
  const [paymentErrors, setPaymentErrors] = useState<BillingFormErrors>({});
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [paymentFormOpen, setPaymentFormOpen] = useState(false);
  const organizationId = activeOrganization?.id;
  const canManage =
    activeOrganization?.role === "OWNER" || activeOrganization?.role === "ADMIN";
  const invoice = state.status === "ready" ? state.data.invoice : null;

  useDocumentTitle(invoice?.number ?? "Invoice");

  useEffect(() => {
    if (navigationState?.notice) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, navigate, navigationState]);

  useEffect(() => {
    if (!organizationId || !invoiceId) {
      setState({ status: "notfound" });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading" });

    getInvoice(invoiceId, controller.signal)
      .then((data) => {
        setState({ status: "ready", data });
        setPaymentForm(emptyPaymentForm(data.invoice));
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
          message: getErrorMessage(error, "This invoice could not be loaded."),
        });
      });

    return () => {
      controller.abort();
    };
  }, [organizationId, invoiceId, reloadKey, refresh]);

  function applyInvoice(next: Invoice): void {
    setState({ status: "ready", data: { invoice: next } });
    setPaymentForm(emptyPaymentForm(next));
  }

  async function runInvoiceAction(action: InvoiceAction): Promise<void> {
    if (!invoice || pendingInvoiceAction) {
      return;
    }

    setPendingInvoiceAction(action);
    setActionError(null);
    setNotice(null);

    try {
      const response =
        action === "issue"
          ? await issueInvoice(invoice.id)
          : action === "void"
            ? await voidInvoice(invoice.id)
            : await markInvoiceUncollectible(invoice.id);

      applyInvoice(response.invoice);
      setConfirmInvoiceAction(null);
      setNotice(
        action === "issue"
          ? `Invoice ${response.invoice.number} issued and open for collection.`
          : action === "void"
            ? `Invoice ${response.invoice.number} voided.`
            : `Invoice ${response.invoice.number} marked uncollectible.`,
      );
    } catch (error) {
      if (isUnauthorizedError(error)) {
        void refresh();
      }

      setActionError(
        getErrorMessage(error, "The invoice could not be updated."),
      );
    } finally {
      setPendingInvoiceAction(null);
    }
  }

  async function handleRecordPayment(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    if (!invoice || recordingPayment) {
      return;
    }

    const validation = validatePaymentForm(paymentForm, {
      amountDueMinor: invoice.amountDue.amountMinor,
      currency: invoice.amountDue.currency,
    });

    if (Object.keys(validation.errors).length > 0 || validation.amountMinor === null) {
      setPaymentErrors(validation.errors);
      setPaymentError("Review the highlighted fields before recording.");
      return;
    }

    setRecordingPayment(true);
    setPaymentErrors({});
    setPaymentError(null);

    try {
      const reference = paymentForm.reference.trim();
      const note = paymentForm.note.trim();
      const response = await recordPayment(invoice.id, {
        amountMinor: validation.amountMinor,
        method: paymentForm.method,
        status: paymentForm.status,
        reference: reference.length > 0 ? reference : null,
        note: note.length > 0 ? note : null,
      });

      applyInvoice(response.invoice);
      setPaymentFormOpen(false);
      setNotice(
        paymentForm.status === "PENDING"
          ? "Pending manual payment recorded. Confirm it when the funds clear."
          : "Manual payment recorded and the invoice balance updated.",
      );
    } catch (error) {
      if (isUnauthorizedError(error)) {
        void refresh();
      }

      const serverErrors = getFieldErrors(error);
      const mapped: BillingFormErrors = {};

      for (const [field, message] of Object.entries(serverErrors)) {
        mapped[field === "amountMinor" ? "amount" : field] = message;
      }

      if (Object.keys(mapped).length > 0) {
        setPaymentErrors(mapped);
      }

      setPaymentError(
        getErrorMessage(error, "The payment could not be recorded."),
      );
    } finally {
      setRecordingPayment(false);
    }
  }

  async function runPaymentAction(): Promise<void> {
    if (!confirmPayment || pendingPaymentId) {
      return;
    }

    setPendingPaymentId(confirmPayment.payment.id);
    setActionError(null);
    setNotice(null);

    try {
      const response =
        confirmPayment.action === "succeed"
          ? await succeedPayment(confirmPayment.payment.id)
          : confirmPayment.action === "fail"
            ? await failPayment(confirmPayment.payment.id)
            : await refundPayment(confirmPayment.payment.id);

      applyInvoice(response.invoice);
      setConfirmPayment(null);
      setNotice(
        confirmPayment.action === "succeed"
          ? "Payment confirmed and the invoice balance updated."
          : confirmPayment.action === "fail"
            ? "Payment marked failed. The attempt remains in history."
            : "Payment refunded and the invoice balance reopened.",
      );
    } catch (error) {
      if (isUnauthorizedError(error)) {
        void refresh();
      }

      setActionError(
        getErrorMessage(error, "The payment could not be updated."),
      );
    } finally {
      setPendingPaymentId(null);
    }
  }

  function updatePaymentField<K extends keyof PaymentFormValues>(
    key: K,
    value: PaymentFormValues[K],
  ): void {
    setPaymentForm((current) => ({ ...current, [key]: value }));
    setPaymentErrors((current) => {
      if (!(key in current)) {
        return current;
      }

      const next = { ...current };
      delete next[key];
      return next;
    });
    setPaymentError(null);
  }

  if (state.status === "loading") {
    return <DetailSkeleton />;
  }

  if (state.status === "notfound") {
    return (
      <EmptyState
        icon={ReceiptText}
        title="Invoice not found."
        description="It may belong to another workspace or no longer exist. Return to the ledger to continue."
        action={
          <Link to="/invoices" className={buttonClassName({ size: "sm" })}>
            <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
            Back to invoices
          </Link>
        }
      />
    );
  }

  if (state.status === "error") {
    return (
      <Card className="p-6">
        <Alert tone="error">
          <p className="font-semibold">Invoice could not load.</p>
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
            to="/invoices"
            className={buttonClassName({ variant: "ghost", size: "sm" })}
          >
            Back to ledger
          </Link>
        </div>
      </Card>
    );
  }

  const record = state.data.invoice;
  const invoiceActions = getInvoiceActionAvailability(
    record.status,
    record.amountPaid.amountMinor,
  );
  const hasInvoiceActions =
    invoiceActions.issue || invoiceActions.void || invoiceActions.markUncollectible;
  const canRecordPayment =
    canManage && record.status === "OPEN" && record.amountDue.amountMinor > 0;
  const addressLines = [
    record.customer.billingAddress.line1,
    record.customer.billingAddress.line2,
    [record.customer.billingAddress.city, record.customer.billingAddress.region]
      .filter(Boolean)
      .join(", "),
    [record.customer.billingAddress.postalCode, record.customer.billingAddress.country]
      .filter(Boolean)
      .join(" "),
  ].filter((line) => line.trim().length > 0);

  return (
    <>
      <Link
        to="/invoices"
        className="inline-flex items-center gap-2 text-[12px] font-semibold text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
        Back to invoices
      </Link>

      <div className="mt-6">
        <PageHeader
          eyebrow="Invoices · Detail"
          title={
            <span className="font-mono text-[clamp(1.9rem,4vw,3.1rem)] uppercase tracking-[-0.02em]">
              {record.number}
            </span>
          }
          description={`${record.customer.name} · ${formatBillingPeriod(
            record.periodStart,
            record.periodEnd,
          )}. This is an internal billing record; payments are recorded manually.`}
          actions={
            <>
              <Badge
                tone={invoiceStatusTones[record.status]}
                className="h-8 px-3"
              >
                {invoiceStatusLabels[record.status]}
              </Badge>
              <Link
                to={`/invoices/${record.id}/print`}
                className={buttonClassName({ variant: "secondary", size: "sm" })}
              >
                <Printer aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                Print / save PDF
              </Link>
              {record.subscriptionId ? (
                <Link
                  to={`/subscriptions/${record.subscriptionId}`}
                  className={buttonClassName({ variant: "secondary", size: "sm" })}
                >
                  Subscription
                  <ArrowUpRight
                    aria-hidden="true"
                    className="h-3.5 w-3.5"
                    strokeWidth={2}
                  />
                </Link>
              ) : null}
            </>
          }
        />
      </div>

      {notice ? (
        <Alert tone="success" className="mt-7">
          {notice}
        </Alert>
      ) : null}

      {actionError ? (
        <Alert tone="error" className="mt-4">
          {actionError}
        </Alert>
      ) : null}

      <div className="mt-7 grid gap-4 xl:grid-cols-12">
        <Card className="relative overflow-hidden p-6 sm:p-7 xl:col-span-5">
          <span
            aria-hidden="true"
            className={cn(
              "absolute -right-10 -top-12 h-40 w-40 rounded-full blur-2xl",
              record.amountDue.amountMinor > 0 ? "bg-coral/15" : "bg-lime/35",
            )}
          />
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <p className="eyebrow">Amount due</p>
              <Badge tone={invoiceStatusTones[record.status]}>
                {invoiceStatusLabels[record.status]}
              </Badge>
            </div>

            <p
              className={cn(
                "mt-5 font-display text-[clamp(2.7rem,5vw,4rem)] leading-[0.9] tracking-[-0.05em]",
                record.amountDue.amountMinor > 0 ? "text-coral" : "text-ink",
              )}
            >
              {formatMoney(
                record.amountDue.amountMinor,
                record.amountDue.currency,
              )}
            </p>
            <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-muted">
              of {formatMoney(record.total.amountMinor, record.total.currency)}{" "}
              total · {record.total.currency}
            </p>

            <dl className="mt-6 space-y-3 border-t border-line pt-5 text-[11.5px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Subtotal</dt>
                <dd className="text-right text-ink-soft">
                  {formatMoney(
                    record.subtotal.amountMinor,
                    record.subtotal.currency,
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">
                  Tax ({formatTaxRateBps(record.taxRateBps)})
                </dt>
                <dd className="text-right text-ink-soft">
                  {formatMoney(record.tax.amountMinor, record.tax.currency)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Paid</dt>
                <dd className="text-right font-semibold text-ink">
                  {formatMoney(
                    record.amountPaid.amountMinor,
                    record.amountPaid.currency,
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Issued</dt>
                <dd className="text-right text-ink-soft">
                  {formatBillingDate(record.issuedAt)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Due</dt>
                <dd className="text-right text-ink-soft">
                  {formatBillingDate(record.dueAt)}
                </dd>
              </div>
              {record.paidAt ? (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Settled</dt>
                  <dd className="text-right text-ink-soft">
                    {formatBillingDate(record.paidAt)}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        </Card>

        <Card className="p-6 sm:p-7 xl:col-span-7">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Collection controls</p>
              <h2 className="mt-2 font-display text-2xl leading-tight tracking-[-0.02em] text-ink">
                Move the invoice through its lifecycle.
              </h2>
              <p className="mt-2 max-w-xl text-[11.5px] leading-5 text-muted">
                Drafts are internal. Issuing opens the invoice for payment.
                Issued records are never deleted; void or write off instead.
              </p>
            </div>
            {!canManage ? <Badge tone="outline">Read-only</Badge> : null}
          </div>

          {canManage && confirmInvoiceAction ? (
            <div className="mt-5 rounded-2xl border border-line-strong bg-surface-raised/70 p-4">
              <div className="flex items-start gap-2.5">
                <CircleAlert
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-coral"
                  strokeWidth={2}
                />
                <div>
                  <p className="text-[12px] font-semibold text-ink">
                    {invoiceActionCopy[confirmInvoiceAction].title}
                  </p>
                  <p className="mt-1 text-[11px] leading-5 text-muted">
                    {invoiceActionCopy[confirmInvoiceAction].description}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={pendingInvoiceAction !== null}
                  onClick={() => void runInvoiceAction(confirmInvoiceAction)}
                  className={
                    confirmInvoiceAction === "issue"
                      ? undefined
                      : "border-coral bg-coral text-white hover:bg-coral/90"
                  }
                >
                  {pendingInvoiceAction === confirmInvoiceAction
                    ? "Working..."
                    : invoiceActionCopy[confirmInvoiceAction].confirm}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pendingInvoiceAction !== null}
                  onClick={() => setConfirmInvoiceAction(null)}
                >
                  Keep as is
                </Button>
              </div>
            </div>
          ) : canManage && hasInvoiceActions ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {invoiceActions.issue ? (
                <Button
                  size="sm"
                  onClick={() => setConfirmInvoiceAction("issue")}
                >
                  <Send aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                  Issue invoice
                </Button>
              ) : null}
              {invoiceActions.void ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setConfirmInvoiceAction("void")}
                >
                  <Ban aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                  Void
                </Button>
              ) : null}
              {invoiceActions.markUncollectible ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="text-coral"
                  onClick={() => setConfirmInvoiceAction("markUncollectible")}
                >
                  <AlertTriangle
                    aria-hidden="true"
                    className="h-3.5 w-3.5"
                    strokeWidth={2}
                  />
                  Mark uncollectible
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="mt-5 text-[11.5px] leading-5 text-muted">
              {!canManage
                ? "Owners and admins can move invoices through their lifecycle. You can still view the full record and payment history."
                : "No collection actions are available in this state. Paid, void, and uncollectible invoices remain immutable for audit."}
            </p>
          )}

          <div className="mt-6 grid gap-3 border-t border-line pt-5 sm:grid-cols-2">
            <div className="rounded-xl bg-surface-raised/70 px-3.5 py-3">
              <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                Customer
              </p>
              <p className="mt-1 text-[11.5px] font-semibold text-ink">
                {record.customer.name}
              </p>
              <p className="mt-0.5 text-[10.5px] text-muted">
                {record.customer.email}
              </p>
            </div>
            <div className="rounded-xl bg-surface-raised/70 px-3.5 py-3">
              <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                Billing period
              </p>
              <p className="mt-1 text-[11.5px] font-semibold text-ink">
                {formatBillingPeriod(record.periodStart, record.periodEnd)}
              </p>
              <p className="mt-0.5 text-[10.5px] text-muted">
                {record.payments.length} payment
                {record.payments.length === 1 ? "" : "s"} recorded
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-12">
        <Card className="p-6 sm:p-7 xl:col-span-7">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Line items</p>
              <h2 className="mt-2 font-display text-2xl leading-tight tracking-[-0.02em] text-ink">
                What this invoice bills.
              </h2>
            </div>
            <FileText
              aria-hidden="true"
              className="h-5 w-5 text-muted"
              strokeWidth={1.7}
            />
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[460px] border-collapse">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="pb-2 font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                    Description
                  </th>
                  <th className="pb-2 text-right font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                    Qty
                  </th>
                  <th className="pb-2 text-right font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                    Unit
                  </th>
                  <th className="pb-2 text-right font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {record.lineItems.map((item) => (
                  <tr key={item.id}>
                    <td className="py-3 pr-3 text-[11.5px] text-ink">
                      {item.description}
                    </td>
                    <td className="py-3 pl-3 text-right text-[11px] text-muted">
                      {item.quantity}
                    </td>
                    <td className="py-3 pl-3 text-right text-[11px] text-muted">
                      {formatMoney(item.unitAmountMinor, record.total.currency)}
                    </td>
                    <td className="py-3 pl-3 text-right text-[11.5px] font-semibold text-ink">
                      {formatMoney(item.totalMinor, record.total.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="mt-5 space-y-2 border-t border-line pt-4 text-[11.5px]">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">Subtotal</dt>
              <dd className="text-right text-ink-soft">
                {formatMoney(record.subtotal.amountMinor, record.subtotal.currency)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">
                Tax at {formatTaxRateBps(record.taxRateBps)}
              </dt>
              <dd className="text-right text-ink-soft">
                {formatMoney(record.tax.amountMinor, record.tax.currency)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-line pt-2 text-[13px]">
              <dt className="font-semibold text-ink">Total</dt>
              <dd className="text-right font-semibold text-ink">
                {formatMoney(record.total.amountMinor, record.total.currency)}
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="p-6 sm:p-7 xl:col-span-5">
          <p className="eyebrow">Customer snapshot</p>
          <h2 className="mt-2 font-display text-2xl leading-tight tracking-[-0.02em] text-ink">
            Billing details at issue time.
          </h2>

          <div className="mt-5 space-y-2 text-[11.5px] leading-5">
            <p className="font-semibold text-ink">{record.customer.name}</p>
            {record.customer.company ? (
              <p className="text-muted">{record.customer.company}</p>
            ) : null}
            <p className="text-muted">{record.customer.email}</p>
            {addressLines.length > 0 ? (
              <address className="not-italic text-muted">
                {addressLines.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </address>
            ) : (
              <p className="text-muted">No billing address on file.</p>
            )}
          </div>

          <Alert tone="info" className="mt-5">
            Customer details are snapshotted when the invoice is generated. Later
            customer edits never rewrite this record.
          </Alert>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-12">
        <Card className="p-6 sm:p-7 xl:col-span-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Payment history</p>
              <h2 className="mt-2 font-display text-2xl leading-tight tracking-[-0.02em] text-ink">
                Manual records and attempts.
              </h2>
            </div>
            {canRecordPayment && !paymentFormOpen ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPaymentFormOpen(true)}
              >
                <Plus aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                Record payment
              </Button>
            ) : null}
          </div>

          <p className="mt-2 text-[10.5px] leading-4 text-muted">
            Internal records only. Subscript does not confirm funds with a payment
            gateway in this phase.
          </p>

          {paymentFormOpen && canRecordPayment ? (
            <form
              onSubmit={(event) => void handleRecordPayment(event)}
              noValidate
              className="mt-5 rounded-2xl border border-line bg-surface-raised/55 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11.5px] font-semibold text-ink">
                  Record a manual payment
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPaymentFormOpen(false);
                    setPaymentErrors({});
                    setPaymentError(null);
                  }}
                >
                  Close
                </Button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <TextField
                  label={`Amount (${record.amountDue.currency})`}
                  value={paymentForm.amount}
                  onChange={(value) => updatePaymentField("amount", value)}
                  inputMode="decimal"
                  error={paymentErrors.amount}
                  hint={`Outstanding ${formatMoney(
                    record.amountDue.amountMinor,
                    record.amountDue.currency,
                  )}.`}
                  required
                />
                <SelectField
                  label="Method"
                  value={paymentForm.method}
                  onChange={(value) =>
                    updatePaymentField("method", value as PaymentMethod)
                  }
                  options={paymentMethodOptions}
                  error={paymentErrors.method}
                />
                <SelectField
                  label="Status"
                  value={paymentForm.status}
                  onChange={(value) =>
                    updatePaymentField(
                      "status",
                      value as RecordablePaymentStatus,
                    )
                  }
                  options={recordableStatusOptions}
                  error={paymentErrors.status}
                  hint="Pending attempts do not change the balance until confirmed."
                />
                <TextField
                  label="Reference (optional)"
                  value={paymentForm.reference}
                  onChange={(value) => updatePaymentField("reference", value)}
                  error={paymentErrors.reference}
                  placeholder="Transfer, check, or receipt number"
                  maxLength={160}
                />
              </div>

              <TextField
                label="Note (optional)"
                value={paymentForm.note}
                onChange={(value) => updatePaymentField("note", value)}
                error={paymentErrors.note}
                className="mt-3"
                maxLength={500}
              />

              {paymentError ? (
                <Alert tone="error" className="mt-3">
                  {paymentError}
                </Alert>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={recordingPayment}>
                  {recordingPayment ? "Recording..." : "Record payment"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={recordingPayment}
                  onClick={() => {
                    setPaymentFormOpen(false);
                    setPaymentErrors({});
                    setPaymentError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}

          {!canManage && record.status === "OPEN" ? (
            <Alert tone="info" className="mt-5">
              Owners and admins can record manual payments. You can review the
              history here.
            </Alert>
          ) : null}

          {record.status === "DRAFT" ? (
            <Alert tone="info" className="mt-5">
              Issue this invoice before recording payments.
            </Alert>
          ) : null}

          {confirmPayment ? (
            <div className="mt-5 rounded-2xl border border-line-strong bg-surface-raised/70 p-4">
              <div className="flex items-start gap-2.5">
                <CircleAlert
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-coral"
                  strokeWidth={2}
                />
                <div>
                  <p className="text-[12px] font-semibold text-ink">
                    {confirmPayment.action === "succeed"
                      ? "Confirm this payment succeeded?"
                      : confirmPayment.action === "fail"
                        ? "Mark this payment failed?"
                        : "Refund this payment?"}
                  </p>
                  <p className="mt-1 text-[11px] leading-5 text-muted">
                    {formatMoney(
                      confirmPayment.payment.amount.amountMinor,
                      confirmPayment.payment.amount.currency,
                    )}{" "}
                    via {paymentMethodLabels[confirmPayment.payment.method]}.{" "}
                    {confirmPayment.action === "succeed"
                      ? "The amount is applied to the invoice balance immediately."
                      : confirmPayment.action === "fail"
                        ? "The attempt stays in history but no longer counts toward the balance."
                        : "The refund reopens the invoice balance and is recorded in the timeline."}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={pendingPaymentId !== null}
                  onClick={() => void runPaymentAction()}
                  className={
                    confirmPayment.action === "succeed"
                      ? undefined
                      : "border-coral bg-coral text-white hover:bg-coral/90"
                  }
                >
                  {pendingPaymentId !== null
                    ? "Working..."
                    : confirmPayment.action === "succeed"
                      ? "Confirm payment"
                      : confirmPayment.action === "fail"
                        ? "Mark failed"
                        : "Refund payment"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pendingPaymentId !== null}
                  onClick={() => setConfirmPayment(null)}
                >
                  Keep as is
                </Button>
              </div>
            </div>
          ) : null}

          {record.payments.length === 0 ? (
            <p className="mt-5 rounded-xl border border-dashed border-line-strong bg-surface-raised/60 px-4 py-6 text-center text-[11.5px] text-muted">
              No payments recorded yet.
            </p>
          ) : (
            <ul className="mt-5 divide-y divide-line">
              {record.payments.map((payment) => {
                const paymentActions = getPaymentActionAvailability(
                  payment.status,
                );

                return (
                  <li key={payment.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[12px] font-semibold text-ink">
                            {formatMoney(
                              payment.amount.amountMinor,
                              payment.amount.currency,
                            )}
                          </p>
                          <Badge tone={paymentStatusTones[payment.status]}>
                            {paymentStatusLabels[payment.status]}
                          </Badge>
                        </div>
                        <p className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.08em] text-muted">
                          {paymentMethodLabels[payment.method]} ·{" "}
                          {paymentSourceLabels[payment.source]} ·{" "}
                          {formatBillingDate(
                            payment.paidAt ??
                              payment.failedAt ??
                              payment.refundedAt ??
                              payment.createdAt,
                          )}
                        </p>
                        {payment.reference ? (
                          <p className="mt-1 text-[10px] text-muted">
                            Ref: {payment.reference}
                          </p>
                        ) : null}
                        {payment.note ? (
                          <p className="mt-1 text-[10px] leading-4 text-muted">
                            {payment.note}
                          </p>
                        ) : null}
                      </div>

                      {canManage ? (
                        <div className="flex flex-wrap gap-1.5">
                          {paymentActions.succeed ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() =>
                                setConfirmPayment({
                                  payment,
                                  action: "succeed",
                                })
                              }
                            >
                              Succeed
                            </Button>
                          ) : null}
                          {paymentActions.fail ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-coral"
                              onClick={() =>
                                setConfirmPayment({ payment, action: "fail" })
                              }
                            >
                              Fail
                            </Button>
                          ) : null}
                          {paymentActions.refund ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() =>
                                setConfirmPayment({ payment, action: "refund" })
                              }
                            >
                              Refund
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-6 sm:p-7 xl:col-span-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Invoice timeline</p>
              <h2 className="mt-2 font-display text-2xl leading-tight tracking-[-0.02em] text-ink">
                Every action, auditable.
              </h2>
            </div>
            <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted">
              {record.activities.length} events
            </span>
          </div>

          <ol className="mt-6 space-y-0">
            {record.activities.map((activity, index) => {
              const style = invoiceActivityStyles[activity.type];
              const Icon = style.icon;

              return (
                <li key={activity.id} className="relative flex gap-3 pb-5 last:pb-0">
                  {index < record.activities.length - 1 ? (
                    <span
                      aria-hidden="true"
                      className="absolute left-[14px] top-7 h-[calc(100%-1.25rem)] w-px bg-line"
                    />
                  ) : null}
                  <span
                    className={cn(
                      "relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full",
                      style.className,
                    )}
                  >
                    <Icon aria-hidden="true" className="h-3 w-3" strokeWidth={1.9} />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-[11px] font-semibold text-ink">
                        {invoiceActivityLabels[activity.type]}
                      </p>
                      <p className="font-mono text-[8px] uppercase tracking-[0.08em] text-muted">
                        {formatActivityTime(activity.createdAt)}
                      </p>
                    </div>
                    <p className="mt-1 text-[10.5px] leading-5 text-muted">
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
      </div>
    </>
  );
}
