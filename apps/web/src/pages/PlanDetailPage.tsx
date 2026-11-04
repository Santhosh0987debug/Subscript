import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Archive,
  CheckCircle2,
  Layers,
  Pencil,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import type { PlanResponse } from "@subscript/shared";
import { useAuth } from "@/auth/AuthProvider";
import { Alert } from "@/components/ui/Alert";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  ApiClientError,
  archivePlan,
  deletePlan,
  getPlan,
  restorePlan,
} from "@/lib/api";
import {
  billingIntervalLabels,
  getTrialLabel,
  planStatusLabels,
} from "@/lib/catalogue";
import { getErrorMessage, isUnauthorizedError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";

type DetailState =
  | { status: "loading" }
  | { status: "ready"; data: PlanResponse }
  | { status: "notfound" }
  | { status: "error"; message: string };

const statusTone: Record<"ACTIVE" | "ARCHIVED", BadgeTone> = {
  ACTIVE: "lime",
  ARCHIVED: "outline",
};

function DetailSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-8">
      <span className="sr-only">Loading plan</span>
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

export default function PlanDetailPage() {
  const { planId = "" } = useParams();
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
  const [actionPending, setActionPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const organizationId = activeOrganization?.id;
  const canManage =
    activeOrganization?.role === "OWNER" || activeOrganization?.role === "ADMIN";
  const plan = state.status === "ready" ? state.data.plan : null;

  useDocumentTitle(plan?.name ?? "Plan");

  useEffect(() => {
    if (navigationState?.notice) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, navigate, navigationState]);

  useEffect(() => {
    if (!organizationId || !planId) {
      setState({ status: "notfound" });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading" });

    getPlan(planId, controller.signal)
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
          message: getErrorMessage(error, "This plan could not be loaded."),
        });
      });

    return () => {
      controller.abort();
    };
  }, [organizationId, planId, reloadKey, refresh]);

  async function handleStatusChange(): Promise<void> {
    if (!plan) {
      return;
    }

    setActionPending(true);
    setActionError(null);
    setNotice(null);

    try {
      if (plan.status === "ACTIVE") {
        await archivePlan(plan.id);
        setNotice("Plan archived. Existing references remain intact.");
      } else {
        await restorePlan(plan.id);
        setNotice("Plan restored to active.");
      }

      setReloadKey((current) => current + 1);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        void refresh();
        return;
      }

      setActionError(
        getErrorMessage(error, "The plan status could not be changed."),
      );
    } finally {
      setActionPending(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!plan) {
      return;
    }

    setActionPending(true);
    setActionError(null);

    try {
      await deletePlan(plan.id);
      navigate("/plans", {
        state: { notice: `${plan.name} was permanently deleted.` },
      });
    } catch (error) {
      if (isUnauthorizedError(error)) {
        void refresh();
        return;
      }

      setActionError(
        getErrorMessage(error, "The plan could not be deleted."),
      );
      setConfirmDelete(false);
    } finally {
      setActionPending(false);
    }
  }

  if (state.status === "loading") {
    return (
      <>
        <Link
          to="/plans"
          className="inline-flex items-center gap-2 text-[11px] font-medium text-muted transition-colors hover:text-ink"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
          All plans
        </Link>
        <div className="mt-7">
          <DetailSkeleton />
        </div>
      </>
    );
  }

  if (state.status === "notfound") {
    return (
      <>
        <PageHeader
          eyebrow="Plans · Record"
          title="This plan is not here."
          description="It may have been deleted, or it belongs to another workspace."
        />
        <Card className="mt-9 p-6">
          <EmptyState
            icon={Layers}
            title="Plan not found"
            description="Return to the catalogue and choose a plan from this organization."
            action={
              <Link
                to="/plans"
                className={buttonClassName({ variant: "secondary", size: "sm" })}
              >
                <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                Back to plans
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  if (state.status === "error") {
    return (
      <>
        <PageHeader
          eyebrow="Plans · Record"
          title="Plan unavailable."
          description="The workspace could not return this plan."
        />
        <Card className="mt-9 px-6 py-10">
          <Alert tone="error">{state.message}</Alert>
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
      </>
    );
  }

  const record = state.data.plan;
  const hasSubscriptions = record.subscriptionCount > 0;

  return (
    <>
      <Link
        to="/plans"
        className="inline-flex items-center gap-2 text-[11px] font-medium text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
        All plans
      </Link>

      <div className="mt-5">
        <PageHeader
          eyebrow="Plans · Record"
          title={record.name}
          description={
            record.description ??
            `${billingIntervalLabels[record.interval]} billing · ${getTrialLabel(
              record.trialDays,
            )}`
          }
          actions={
            canManage ? (
              <>
                <Link
                  to={`/plans/${record.id}/edit`}
                  className={buttonClassName({ variant: "secondary" })}
                >
                  <Pencil aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                  Edit
                </Link>
                <Button
                  variant={record.status === "ACTIVE" ? "primary" : "secondary"}
                  disabled={actionPending}
                  onClick={() => void handleStatusChange()}
                >
                  {record.status === "ACTIVE" ? (
                    <Archive aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                  ) : (
                    <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                  )}
                  {actionPending
                    ? "Saving..."
                    : record.status === "ACTIVE"
                      ? "Archive"
                      : "Restore"}
                </Button>
              </>
            ) : (
              <Badge tone="outline" className="h-8 px-3">
                Read-only access
              </Badge>
            )
          }
        />
      </div>

      <div className="mt-7 space-y-3">
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {actionError ? <Alert tone="error">{actionError}</Alert> : null}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-12">
        <Card className="relative overflow-hidden p-6 sm:p-7 xl:col-span-5">
          <span
            aria-hidden="true"
            className="absolute -right-10 -top-12 h-40 w-40 rounded-full bg-lime/35 blur-2xl"
          />
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <p className="eyebrow">List price</p>
              <Badge tone={statusTone[record.status]}>
                {planStatusLabels[record.status]}
              </Badge>
            </div>

            <p className="mt-5 font-display text-[clamp(3rem,6vw,4.6rem)] leading-[0.9] tracking-[-0.05em] text-ink">
              {formatMoney(record.price.amountMinor, record.price.currency)}
            </p>
            <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-muted">
              per {record.interval === "MONTH" ? "month" : "year"} ·{" "}
              {record.price.currency}
            </p>

            <div className="mt-7 flex flex-wrap gap-2">
              <Badge tone="dark">
                {billingIntervalLabels[record.interval]}
              </Badge>
              <Badge tone="outline">{getTrialLabel(record.trialDays)}</Badge>
              <Badge tone="outline">
                {record.subscriptionCount}{" "}
                {record.subscriptionCount === 1 ? "subscription" : "subscriptions"}
              </Badge>
            </div>
          </div>
        </Card>

        <Card className="p-6 sm:p-7 xl:col-span-7">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-lime">
              <Layers aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.7} />
            </span>
            <div>
              <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">
                Plan details
              </h2>
              <p className="mt-0.5 text-[11px] text-muted">
                The catalogue record behind this price.
              </p>
            </div>
          </div>

          <dl className="mt-6 space-y-3 text-[12px]">
            <div className="flex items-center justify-between gap-4 border-b border-line/70 pb-3">
              <dt className="text-muted">Plan code</dt>
              <dd className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-soft">
                {record.code}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-line/70 pb-3">
              <dt className="text-muted">Billing interval</dt>
              <dd className="text-ink-soft">
                {billingIntervalLabels[record.interval]}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-line/70 pb-3">
              <dt className="text-muted">Trial period</dt>
              <dd className="text-ink-soft">{getTrialLabel(record.trialDays)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-line/70 pb-3">
              <dt className="text-muted">Currency</dt>
              <dd className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-soft">
                {record.price.currency}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-line/70 pb-3">
              <dt className="text-muted">Created</dt>
              <dd className="text-ink-soft">
                {new Intl.DateTimeFormat("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                }).format(new Date(record.createdAt))}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted">Last updated</dt>
              <dd className="text-ink-soft">
                {new Intl.DateTimeFormat("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                }).format(new Date(record.updatedAt))}
              </dd>
            </div>
          </dl>

          <div className="mt-6 rounded-2xl border border-line bg-surface-raised/65 px-4 py-3.5">
            <p className="font-mono text-[8px] uppercase tracking-[0.13em] text-muted">
              Description
            </p>
            <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-6 text-ink-soft">
              {record.description || "No description recorded yet."}
            </p>
          </div>
        </Card>

        <Card className="p-6 xl:col-span-12">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-3">
              <span
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                  hasSubscriptions
                    ? "bg-coral-soft text-coral"
                    : "bg-[#dde8dc] text-moss"
                }`}
              >
                {hasSubscriptions ? (
                  <ShieldAlert aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.8} />
                ) : (
                  <ShieldCheck aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.8} />
                )}
              </span>
              <div>
                <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
                  Deletion safety
                </h2>
                <p className="mt-1 max-w-xl text-[11.5px] leading-5 text-muted">
                  {hasSubscriptions
                    ? `This plan is referenced by ${record.subscriptionCount} ${
                        record.subscriptionCount === 1 ? "subscription" : "subscriptions"
                      }. Archive it to retire it from the catalogue without breaking those records.`
                    : "No subscriptions reference this plan. Archiving is still the safer default; permanent deletion is available because the catalogue record is unused."}
                </p>
              </div>
            </div>

            {canManage ? (
              confirmDelete ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={actionPending}
                    onClick={() => void handleDelete()}
                    className="border-coral bg-coral text-white hover:bg-coral/90"
                  >
                    <Trash2 aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                    {actionPending ? "Deleting..." : "Delete permanently"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={actionPending}
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
                  {!hasSubscriptions ? (
                    <p className="max-w-xs text-[10.5px] leading-4 text-muted">
                      Deleting cannot be undone. Prefer archive when you only need
                      to stop offering the plan.
                    </p>
                  ) : null}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={hasSubscriptions || actionPending}
                    title={
                      hasSubscriptions
                        ? "Archive this plan instead; subscriptions still reference it."
                        : undefined
                    }
                    onClick={() => setConfirmDelete(true)}
                    className="border-coral/30 text-coral hover:border-coral/60 hover:bg-coral-soft"
                  >
                    <Trash2 aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                    Delete plan
                  </Button>
                </div>
              )
            ) : null}
          </div>

          {hasSubscriptions ? (
            <Alert tone="info" className="mt-4">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                Archive keeps historical subscriptions and invoices intact.
              </span>
            </Alert>
          ) : null}
        </Card>
      </div>
    </>
  );
}
