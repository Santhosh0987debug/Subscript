import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CreditCard,
  Layers,
  RefreshCw,
  UserRound,
} from "lucide-react";
import {
  Link,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import type {
  Customer,
  Plan,
} from "@subscript/shared";
import { useAuth } from "@/auth/AuthProvider";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { SelectField } from "@/components/ui/SelectField";
import { Skeleton } from "@/components/ui/Skeleton";
import { TextField } from "@/components/ui/TextField";
import { Button } from "@/components/ui/Button";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  createSubscription,
  listCustomers,
  listPlans,
} from "@/lib/api";
import {
  getTodayDateInputValue,
  formatBillingDate,
} from "@/lib/billing";
import {
  validateSubscriptionForm,
  type BillingFormErrors,
  type SubscriptionFormValues,
} from "@/lib/billing-validation";
import { billingIntervalLabels, getTrialLabel } from "@/lib/catalogue";
import {
  getErrorMessage,
  getFieldErrors,
  isUnauthorizedError,
} from "@/lib/errors";
import { formatMoney } from "@/lib/money";

type LoadState =
  | { status: "loading" }
  | {
      status: "ready";
      customers: Customer[];
      plans: Plan[];
    }
  | { status: "error"; message: string };

const FIELD_NAMES = [
  "customerId",
  "planId",
  "startDate",
  "quantity",
  "trialDays",
  "nextBillingDate",
] as const;

export default function SubscriptionFormPage() {
  useDocumentTitle("New subscription");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { activeOrganization, refresh } = useAuth();
  const organizationId = activeOrganization?.id;
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [values, setValues] = useState<SubscriptionFormValues>({
    customerId: searchParams.get("customerId") ?? "",
    planId: searchParams.get("planId") ?? "",
    startDate: getTodayDateInputValue(),
    quantity: "1",
    trialDays: "",
    nextBillingDate: "",
  });
  const [fieldErrors, setFieldErrors] = useState<BillingFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!organizationId) {
      setLoadState({ status: "error", message: "No active organization." });
      return;
    }

    const controller = new AbortController();
    setLoadState({ status: "loading" });

    Promise.all([
      listCustomers(
        {
          status: "ACTIVE",
          sort: "name",
          direction: "asc",
          pageSize: 100,
        },
        controller.signal,
      ),
      listPlans(
        {
          status: "ACTIVE",
          sort: "name",
          direction: "asc",
          pageSize: 100,
        },
        controller.signal,
      ),
    ])
      .then(([customers, plans]) => {
        const nextCustomers = customers.customers;
        const nextPlans = plans.plans;

        setLoadState({
          status: "ready",
          customers: nextCustomers,
          plans: nextPlans,
        });
        setValues((current) => ({
          ...current,
          customerId:
            current.customerId &&
            nextCustomers.some((customer) => customer.id === current.customerId)
              ? current.customerId
              : (nextCustomers[0]?.id ?? ""),
          planId:
            current.planId &&
            nextPlans.some((plan) => plan.id === current.planId)
              ? current.planId
              : (nextPlans[0]?.id ?? ""),
        }));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (isUnauthorizedError(error)) {
          void refresh();
        }

        setLoadState({
          status: "error",
          message: getErrorMessage(
            error,
            "Customers and plans could not be loaded.",
          ),
        });
      });

    return () => {
      controller.abort();
    };
  }, [organizationId, reloadKey, refresh]);

  const selectedPlan =
    loadState.status === "ready"
      ? loadState.plans.find((plan) => plan.id === values.planId) ?? null
      : null;
  const selectedCustomer =
    loadState.status === "ready"
      ? loadState.customers.find(
          (customer) => customer.id === values.customerId,
        ) ?? null
      : null;

  const effectiveTrialDays = useMemo(() => {
    if (values.trialDays.trim().length === 0) {
      return selectedPlan?.trialDays ?? 0;
    }

    const parsed = Number(values.trialDays);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  }, [selectedPlan, values.trialDays]);

  function updateField<K extends keyof SubscriptionFormValues>(
    key: K,
    value: SubscriptionFormValues[K],
  ): void {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!(key in current)) {
        return current;
      }

      const next = { ...current };
      delete next[key];
      return next;
    });
    setFormError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting) {
      return;
    }

    const errors = validateSubscriptionForm(
      values,
      selectedPlan?.trialDays ?? 0,
    );

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError("Review the highlighted fields before starting.");
      return;
    }

    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);

    try {
      const trialDaysValue = values.trialDays.trim();
      const nextBillingValue = values.nextBillingDate.trim();
      const response = await createSubscription({
        customerId: values.customerId,
        planId: values.planId,
        startDate: values.startDate.trim(),
        quantity: Number(values.quantity),
        ...(trialDaysValue.length > 0
          ? { trialDays: Number(trialDaysValue) }
          : {}),
        ...(nextBillingValue.length > 0
          ? { nextBillingDate: nextBillingValue }
          : {}),
      });

      navigate(`/subscriptions/${response.subscription.id}`, {
        state: {
          notice: `Subscription started for ${response.subscription.customerName}.`,
        },
      });
    } catch (error) {
      if (isUnauthorizedError(error)) {
        void refresh();
      }

      const serverErrors = getFieldErrors(error);
      const relevantErrors = Object.fromEntries(
        Object.entries(serverErrors).filter(([field]) =>
          (FIELD_NAMES as readonly string[]).includes(field),
        ),
      );

      if (Object.keys(relevantErrors).length > 0) {
        setFieldErrors(relevantErrors);
      }

      setFormError(
        getErrorMessage(error, "The subscription could not be started."),
      );
    } finally {
      setSubmitting(false);
    }
  }

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
          eyebrow="Subscriptions · New"
          title="Start the next billing relationship."
          description="Choose an active customer and plan. The plan supplies the price snapshot, interval, and default trial; dates stay calendar-exact."
        />
      </div>

      {loadState.status === "loading" ? (
        <div className="mt-9 grid gap-4 xl:grid-cols-12" role="status" aria-live="polite">
          <span className="sr-only">Loading customers and plans</span>
          <Card className="p-6 xl:col-span-8">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-6 h-12 w-full rounded-xl" />
            <Skeleton className="mt-4 h-12 w-full rounded-xl" />
            <Skeleton className="mt-8 h-4 w-32" />
            <Skeleton className="mt-4 h-12 w-full rounded-xl" />
          </Card>
          <Card className="p-6 xl:col-span-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-6 h-12 w-40 rounded-xl" />
            <Skeleton className="mt-4 h-3 w-full" />
          </Card>
        </div>
      ) : null}

      {loadState.status === "error" ? (
        <Card className="mt-9 p-6">
          <Alert tone="error">
            <p className="font-semibold">The form could not be prepared.</p>
            <p className="mt-1 text-coral/85">{loadState.message}</p>
          </Alert>
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={() => setReloadKey((current) => current + 1)}
          >
            <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
            Try again
          </Button>
        </Card>
      ) : null}

      {loadState.status === "ready" &&
      (loadState.customers.length === 0 || loadState.plans.length === 0) ? (
        <Card className="mt-9 p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lime text-ink">
              <CreditCard aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <div>
              <h2 className="font-display text-2xl leading-tight text-ink">
                A customer and an active plan are required.
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                Subscriptions snapshot pricing from a plan, so both records must
                exist first. Archived records cannot be used.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {loadState.customers.length === 0 ? (
                  <Link
                    to="/customers/new"
                    className="inline-flex h-9 items-center gap-2 rounded-full border border-line-strong bg-surface px-3.5 text-[13px] font-semibold text-ink transition-colors hover:border-ink/35 hover:bg-surface-raised"
                  >
                    <UserRound aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                    Add a customer
                  </Link>
                ) : null}
                {loadState.plans.length === 0 ? (
                  <Link
                    to="/plans/new"
                    className="inline-flex h-9 items-center gap-2 rounded-full border border-line-strong bg-surface px-3.5 text-[13px] font-semibold text-ink transition-colors hover:border-ink/35 hover:bg-surface-raised"
                  >
                    <Layers aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                    Add a plan
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {loadState.status === "ready" &&
      loadState.customers.length > 0 &&
      loadState.plans.length > 0 ? (
        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="mt-9 grid gap-4 xl:grid-cols-12"
          noValidate
        >
          <div className="space-y-4 xl:col-span-8">
            <Card className="p-6 sm:p-7">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink text-lime">
                  <UserRound aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <div>
                  <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
                    Customer and plan
                  </h2>
                  <p className="mt-0.5 text-[10.5px] text-muted">
                    Only active records are listed. The plan price is snapshotted
                    at creation.
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <SelectField
                  label="Customer"
                  value={values.customerId}
                  onChange={(value) => updateField("customerId", value)}
                  options={loadState.customers.map((customer) => ({
                    value: customer.id,
                    label: `${customer.name} · ${customer.email}`,
                  }))}
                  error={fieldErrors.customerId}
                  required
                />
                <SelectField
                  label="Plan"
                  value={values.planId}
                  onChange={(value) => updateField("planId", value)}
                  options={loadState.plans.map((plan) => ({
                    value: plan.id,
                    label: `${plan.name} · ${formatMoney(
                      plan.price.amountMinor,
                      plan.price.currency,
                    )} / ${plan.interval === "MONTH" ? "mo" : "yr"}`,
                  }))}
                  error={fieldErrors.planId}
                  required
                />
              </div>

              {selectedCustomer ? (
                <p className="mt-4 text-[11px] text-muted">
                  Billing contact: {selectedCustomer.email}
                  {selectedCustomer.company
                    ? ` · ${selectedCustomer.company}`
                    : ""}
                </p>
              ) : null}
            </Card>

            <Card className="p-6 sm:p-7">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink text-lime">
                  <CalendarDays aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <div>
                  <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
                    Billing schedule
                  </h2>
                  <p className="mt-0.5 text-[10.5px] text-muted">
                    Start dates are calendar dates; month-end renewal dates clamp
                    safely.
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Start date"
                  type="date"
                  value={values.startDate}
                  onChange={(value) => updateField("startDate", value)}
                  error={fieldErrors.startDate}
                  required
                />
                <TextField
                  label="Quantity"
                  value={values.quantity}
                  onChange={(value) => updateField("quantity", value)}
                  inputMode="numeric"
                  placeholder="1"
                  error={fieldErrors.quantity}
                  hint="Seats or units billed at the plan price."
                  required
                />
                <TextField
                  label="Trial days override"
                  value={values.trialDays}
                  onChange={(value) => updateField("trialDays", value)}
                  inputMode="numeric"
                  placeholder={String(selectedPlan?.trialDays ?? 0)}
                  error={fieldErrors.trialDays}
                  hint={`Leave blank to use the plan default: ${getTrialLabel(
                    selectedPlan?.trialDays ?? 0,
                  ).toLowerCase()}.`}
                />
                <TextField
                  label="First period end (optional)"
                  type="date"
                  value={values.nextBillingDate}
                  onChange={(value) => updateField("nextBillingDate", value)}
                  error={fieldErrors.nextBillingDate}
                  hint="Leave blank to derive the end from the plan interval."
                />
              </div>

              {effectiveTrialDays > 0 ? (
                <Alert tone="info" className="mt-5">
                  The subscription starts trialing. The first paid period begins
                  after {effectiveTrialDays}{" "}
                  {effectiveTrialDays === 1 ? "day" : "days"}.
                </Alert>
              ) : null}
            </Card>

            {formError ? <Alert tone="error">{formError}</Alert> : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Starting..." : "Start subscription"}
              </Button>
              <Link
                to="/subscriptions"
                className="inline-flex h-11 items-center rounded-full px-5 text-sm font-semibold text-ink transition-colors hover:bg-ink/[0.055]"
              >
                Cancel
              </Link>
            </div>
          </div>

          <div className="xl:col-span-4">
            <Card className="relative overflow-hidden p-6 sm:p-7">
              <span
                aria-hidden="true"
                className="absolute -right-10 -top-12 h-40 w-40 rounded-full bg-lime/35 blur-2xl"
              />
              <div className="relative">
                <p className="eyebrow">Snapshot preview</p>
                {selectedPlan ? (
                  <>
                    <p className="mt-4 font-display text-[clamp(2.4rem,4vw,3.4rem)] leading-[0.9] tracking-[-0.05em] text-ink">
                      {formatMoney(
                        selectedPlan.price.amountMinor *
                          Math.max(1, Number(values.quantity) || 1),
                        selectedPlan.price.currency,
                      )}
                    </p>
                    <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-muted">
                      per{" "}
                      {selectedPlan.interval === "MONTH" ? "month" : "year"} ·{" "}
                      {selectedPlan.price.currency}
                    </p>

                    <dl className="mt-6 space-y-3 border-t border-line pt-5 text-[11.5px]">
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-muted">Plan</dt>
                        <dd className="text-right font-semibold text-ink">
                          {selectedPlan.name}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-muted">Interval</dt>
                        <dd className="text-right text-ink-soft">
                          {billingIntervalLabels[selectedPlan.interval]}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-muted">Trial</dt>
                        <dd className="text-right text-ink-soft">
                          {getTrialLabel(effectiveTrialDays)}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-muted">Starts</dt>
                        <dd className="text-right text-ink-soft">
                          {formatBillingDate(values.startDate || null)}
                        </dd>
                      </div>
                    </dl>

                    <p className="mt-6 text-[10.5px] leading-4 text-muted">
                      Changing the plan later never rewrites this subscription's
                      historical price. Generate invoices from the subscription
                      detail page when a period is ready to bill.
                    </p>
                  </>
                ) : (
                  <p className="mt-4 text-[12px] text-muted">
                    Choose a plan to preview the price snapshot.
                  </p>
                )}
              </div>
            </Card>
          </div>
        </form>
      ) : null}
    </>
  );
}
