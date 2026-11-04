import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Coins,
  Layers,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { BillingInterval } from "@subscript/shared";
import { BILLING_INTERVALS } from "@subscript/shared";
import { useAuth } from "@/auth/AuthProvider";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { SelectField } from "@/components/ui/SelectField";
import { Skeleton } from "@/components/ui/Skeleton";
import { TextAreaField } from "@/components/ui/TextAreaField";
import { TextField } from "@/components/ui/TextField";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  ApiClientError,
  createPlan,
  getPlan,
  updatePlan,
} from "@/lib/api";
import { billingIntervalLabels, getTrialLabel } from "@/lib/catalogue";
import {
  getErrorMessage,
  getFieldErrors,
  isUnauthorizedError,
} from "@/lib/errors";
import {
  formatMajorAmount,
  formatMoney,
  getCurrencyFractionDigits,
  getCurrencyOptions,
  getDefaultCurrency,
  parseMajorAmount,
} from "@/lib/money";
import {
  type PlanFormValues,
  validatePlanForm,
} from "@/lib/plan-validation";

const EMPTY_VALUES: PlanFormValues = {
  name: "",
  description: "",
  amount: "",
  currency: getDefaultCurrency(),
  interval: "MONTH",
  trialDays: "14",
};

const intervalOptions = BILLING_INTERVALS.map((interval) => ({
  value: interval,
  label: billingIntervalLabels[interval],
}));

type LoadState =
  | { status: "ready" }
  | { status: "loading" }
  | { status: "error"; message: string };

function trimOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default function PlanFormPage() {
  const { planId } = useParams();
  const isEdit = Boolean(planId);
  const navigate = useNavigate();
  const { activeOrganization, refresh } = useAuth();
  const [currencyOptions] = useState(getCurrencyOptions);
  const [values, setValues] = useState<PlanFormValues>(EMPTY_VALUES);
  const [loadState, setLoadState] = useState<LoadState>(
    isEdit ? { status: "loading" } : { status: "ready" },
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const organizationId = activeOrganization?.id;
  const canManage =
    activeOrganization?.role === "OWNER" || activeOrganization?.role === "ADMIN";
  const currency = values.currency.toUpperCase();
  const fractionDigits = getCurrencyFractionDigits(currency);
  const parsedAmount = parseMajorAmount(values.amount, currency);
  const previewAmount = parsedAmount ?? 0;
  const trialDays = Number(values.trialDays);
  const previewTrial = Number.isInteger(trialDays) ? Math.max(trialDays, 0) : 0;

  useDocumentTitle(isEdit ? "Edit plan" : "New plan");

  useEffect(() => {
    if (!isEdit) {
      setLoadState({ status: "ready" });
      return;
    }

    if (!organizationId || !planId) {
      return;
    }

    const controller = new AbortController();
    setLoadState({ status: "loading" });

    getPlan(planId, controller.signal)
      .then((data) => {
        const plan = data.plan;
        setValues({
          name: plan.name,
          description: plan.description ?? "",
          amount: formatMajorAmount(
            plan.price.amountMinor,
            plan.price.currency,
          ),
          currency: plan.price.currency,
          interval: plan.interval,
          trialDays: String(plan.trialDays),
        });
        setLoadState({ status: "ready" });
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
          message:
            error instanceof ApiClientError && error.status === 404
              ? "That plan could not be found in this workspace."
              : getErrorMessage(error, "The plan could not be loaded."),
        });
      });

    return () => {
      controller.abort();
    };
  }, [isEdit, organizationId, planId, refresh]);

  function updateField<K extends keyof PlanFormValues>(
    key: K,
    value: PlanFormValues[K],
  ): void {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors({});
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const errors = validatePlanForm(values);

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError("Check the highlighted fields before saving.");
      return;
    }

    if (!canManage) {
      setFormError("Only owners and admins can save plans.");
      return;
    }

    const amountMinor = parseMajorAmount(values.amount, currency);

    if (amountMinor === null) {
      setFieldErrors({ amount: "Enter a valid amount." });
      return;
    }

    setSaving(true);
    setFormError(null);
    setFieldErrors({});

    const payload = {
      name: values.name.trim(),
      description: trimOrNull(values.description),
      price: {
        amountMinor,
        currency,
      },
      interval: values.interval,
      trialDays: Number(values.trialDays),
    };

    try {
      if (isEdit && planId) {
        const result = await updatePlan(planId, payload);
        navigate(`/plans/${result.plan.id}`, {
          state: { notice: "Plan updated." },
        });
      } else {
        const result = await createPlan(payload);
        navigate(`/plans/${result.plan.id}`, {
          state: { notice: "Plan created." },
        });
      }
    } catch (error) {
      if (isUnauthorizedError(error)) {
        void refresh();
        return;
      }

      setFieldErrors(getFieldErrors(error));
      setFormError(
        getErrorMessage(
          error,
          isEdit ? "The plan could not be updated." : "The plan could not be created.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) {
    return (
      <>
        <PageHeader
          eyebrow={isEdit ? "Plans · Edit" : "Plans · New"}
          title="This catalogue is read-only."
          description="Only owners and admins can create or edit plans."
        />
        <Card className="mt-9 p-6">
          <Alert tone="info">
            Your role gives you read access to this workspace. Ask an owner or
            admin if you need to change the plan catalogue.
          </Alert>
          <Link
            to={planId ? `/plans/${planId}` : "/plans"}
            className={buttonClassName({ variant: "secondary", size: "sm", className: "mt-4" })}
          >
            <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
            Go back
          </Link>
        </Card>
      </>
    );
  }

  if (loadState.status === "loading") {
    return (
      <div role="status" aria-live="polite" className="space-y-7">
        <span className="sr-only">Loading plan form</span>
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-14 w-full max-w-xl rounded-2xl" />
        <Card className="p-6">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-6 h-12 w-full rounded-xl" />
          <Skeleton className="mt-4 h-12 w-full rounded-xl" />
          <Skeleton className="mt-4 h-24 w-full rounded-xl" />
        </Card>
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <>
        <PageHeader
          eyebrow="Plans · Edit"
          title="Plan unavailable."
          description="The form could not load this plan."
        />
        <Card className="mt-9 p-6">
          <Alert tone="error">{loadState.message}</Alert>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.location.reload()}
            >
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
              Reload
            </Button>
            <Link to="/plans" className={buttonClassName({ variant: "ghost", size: "sm" })}>
              Back to plans
            </Link>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <Link
        to={isEdit && planId ? `/plans/${planId}` : "/plans"}
        className="inline-flex items-center gap-2 text-[11px] font-medium text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
        {isEdit ? "Back to plan" : "All plans"}
      </Link>

      <div className="mt-5">
        <PageHeader
          eyebrow={isEdit ? "Plans · Edit" : "Plans · New"}
          title={isEdit ? "Reshape the offer." : "Shape the offer."}
          description={
            isEdit
              ? "Change pricing, cadence, and trial terms. Subscription records always keep the plan they reference."
              : "Define one clear price, interval, and trial. Currency is explicit - no hidden two-decimal assumptions."
          }
          actions={
            <Link
              to={isEdit && planId ? `/plans/${planId}` : "/plans"}
              className={buttonClassName({ variant: "secondary" })}
            >
              Cancel
            </Link>
          }
        />
      </div>

      <form noValidate onSubmit={(event) => void handleSubmit(event)} className="mt-8">
        {formError ? <Alert tone="error" className="mb-4">{formError}</Alert> : null}

        <div className="grid gap-4 xl:grid-cols-12">
          <div className="space-y-4 xl:col-span-8">
            <Card className="p-6 sm:p-7">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink text-lime">
                  <Layers aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <div>
                  <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
                    Plan identity
                  </h2>
                  <p className="mt-0.5 text-[10.5px] text-muted">
                    A name and description customers can understand at a glance.
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-4">
                <TextField
                  label="Plan name"
                  value={values.name}
                  onChange={(value) => updateField("name", value)}
                  name="name"
                  placeholder="Growth"
                  error={fieldErrors.name}
                  maxLength={120}
                  required
                />
                <TextAreaField
                  label="Description"
                  value={values.description}
                  onChange={(value) => updateField("description", value)}
                  name="description"
                  placeholder="What this plan includes and who it is for."
                  error={fieldErrors.description}
                  maxLength={1000}
                  rows={3}
                  hint="Optional. Shown in the catalogue and plan detail."
                />
              </div>
            </Card>

            <Card className="p-6 sm:p-7">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-lime text-ink">
                  <Coins aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <div>
                  <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
                    Pricing and cadence
                  </h2>
                  <p className="mt-0.5 text-[10.5px] text-muted">
                    Stored as integer minor units in the selected currency.
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <SelectField
                  label="Currency"
                  value={values.currency}
                  onChange={(value) => updateField("currency", value)}
                  options={currencyOptions}
                  error={fieldErrors.currency}
                  hint="Any ISO 4217 currency supported by your browser."
                  required
                />
                <TextField
                  label="Amount"
                  value={values.amount}
                  onChange={(value) => updateField("amount", value)}
                  name="amount"
                  inputMode="decimal"
                  placeholder={fractionDigits === 0 ? "0" : "0.00"}
                  error={fieldErrors.amount}
                  hint={
                    fractionDigits === 0
                      ? `${currency} uses whole units.`
                      : `${currency} accepts up to ${fractionDigits} decimal places.`
                  }
                  required
                />
                <SelectField
                  label="Billing interval"
                  value={values.interval}
                  onChange={(value) =>
                    updateField("interval", value as BillingInterval)
                  }
                  options={intervalOptions}
                  error={fieldErrors.interval}
                  required
                />
                <TextField
                  label="Trial days"
                  value={values.trialDays}
                  onChange={(value) => updateField("trialDays", value)}
                  name="trialDays"
                  inputMode="numeric"
                  placeholder="14"
                  error={fieldErrors.trialDays}
                  hint="Between 0 and 365 days."
                  maxLength={3}
                  required
                />
              </div>
            </Card>
          </div>

          <div className="xl:col-span-4">
            <Card className="relative overflow-hidden p-6 sm:p-7 xl:sticky xl:top-24">
              <span
                aria-hidden="true"
                className="absolute -right-12 -top-14 h-40 w-40 rounded-full bg-lime/35 blur-2xl"
              />
              <div className="relative">
                <div className="flex items-center gap-2">
                  <Sparkles
                    aria-hidden="true"
                    className="h-3.5 w-3.5 text-muted"
                    strokeWidth={1.9}
                  />
                  <p className="eyebrow">Live preview</p>
                </div>
                <p className="mt-5 break-words font-display text-[clamp(2.6rem,5vw,4rem)] leading-[0.9] tracking-[-0.05em] text-ink">
                  {formatMoney(previewAmount, currency)}
                </p>
                <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-muted">
                  per {values.interval === "MONTH" ? "month" : "year"} · {currency}
                </p>
                <div className="mt-6 flex flex-wrap gap-2">
                  <Badge tone="dark">
                    {billingIntervalLabels[values.interval]}
                  </Badge>
                  <Badge tone="outline">{getTrialLabel(previewTrial)}</Badge>
                </div>
                <p className="mt-6 border-t border-line pt-4 text-[10.5px] leading-5 text-muted">
                  {values.name.trim() || "Untitled plan"} ·{" "}
                  {formatMoney(previewAmount, currency)}{" "}
                  {values.interval === "MONTH" ? "monthly" : "yearly"}
                </p>
              </div>
            </Card>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : isEdit ? "Save changes" : "Create plan"}
          </Button>
          <Link
            to={isEdit && planId ? `/plans/${planId}` : "/plans"}
            className={buttonClassName({ variant: "ghost" })}
          >
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
