import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  BarChart3,
  Download,
  Layers,
  LoaderCircle,
  RefreshCw,
  SearchX,
  Users,
  Wallet,
} from "lucide-react";
import { Link } from "react-router-dom";
import { API_PATHS } from "@subscript/shared";
import type {
  AnalyticsChurnResponse,
  AnalyticsCustomersResponse,
  AnalyticsInvoicesResponse,
  AnalyticsMrrResponse,
  AnalyticsOverviewResponse,
  AnalyticsPlansResponse,
  AnalyticsRangeParams,
  AnalyticsRevenueResponse,
  AnalyticsSubscriptionGrowthResponse,
} from "@subscript/shared";
import { useAuth } from "@/auth/AuthProvider";
import { AnalyticsBarChart } from "@/components/analytics/AnalyticsBarChart";
import { AnalyticsFilters } from "@/components/analytics/AnalyticsFilters";
import { AnalyticsLineChart } from "@/components/analytics/AnalyticsLineChart";
import { AnalyticsMetricCard } from "@/components/analytics/AnalyticsMetricCard";
import { AnalyticsRetentionCard } from "@/components/analytics/AnalyticsRetentionCard";
import { AnalyticsSkeleton } from "@/components/analytics/AnalyticsSkeleton";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton } from "@/components/ui/Skeleton";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  defaultAnalyticsFilters,
  formatBps,
  type AnalyticsFilterState,
} from "@/lib/analytics";
import {
  fetchAnalyticsCsv,
  getAnalyticsChurn,
  getAnalyticsCustomers,
  getAnalyticsInvoices,
  getAnalyticsMrr,
  getAnalyticsOverview,
  getAnalyticsPlans,
  getAnalyticsRevenue,
  getAnalyticsSubscriptions,
} from "@/lib/api";
import { formatActivityTime, formatBillingDate } from "@/lib/billing";
import { cn } from "@/lib/cn";
import { downloadTextFile } from "@/lib/csv";
import { getErrorMessage, isUnauthorizedError } from "@/lib/errors";
import { formatNumber } from "@/lib/format";
import { formatMoney } from "@/lib/money";

type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

interface AnalyticsBaseData {
  overview: AnalyticsOverviewResponse;
  revenue: AnalyticsRevenueResponse;
  mrr: AnalyticsMrrResponse;
  subscriptions: AnalyticsSubscriptionGrowthResponse;
  churn: AnalyticsChurnResponse;
  invoices: AnalyticsInvoicesResponse;
}

const INVOICE_AGING_LABELS = {
  current: "Current",
  "1-30": "1-30 days",
  "31-60": "31-60 days",
  "61-90": "61-90 days",
  "90+": "90+ days",
} as const;

function toRangeParams(filters: AnalyticsFilterState): AnalyticsRangeParams {
  return {
    from: filters.from,
    to: filters.to,
    timezone: filters.timezone,
    grouping: filters.grouping,
  };
}

function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) {
    return null;
  }

  return ((current - previous) / previous) * 100;
}

function formatIsoDate(value: string): string {
  return formatBillingDate(`${value}T12:00:00.000Z`);
}

function signedNumber(value: number): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatNumber(value)}`;
}

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="divide-y divide-line">
      <span className="sr-only">Loading analytics table</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 px-4 py-4 sm:px-5">
          <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-40 max-w-full" />
            <Skeleton className="mt-2 h-3 w-24 max-w-full" />
          </div>
          <Skeleton className="hidden h-3 w-24 sm:block" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

function TableCardHeader({
  eyebrow,
  title,
  description,
  aside,
}: {
  eyebrow: string;
  title: string;
  description: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="mt-1.5 font-display text-[25px] leading-none tracking-[-0.03em] text-ink">
          {title}
        </h2>
        <p className="mt-1.5 text-xs leading-5 text-muted">{description}</p>
      </div>
      {aside}
    </div>
  );
}

function ErrorBlock({
  message,
  label,
  onRetry,
}: {
  message: string;
  label: string;
  onRetry: () => void;
}) {
  return (
    <div className="px-4 py-7 sm:px-5">
      <Alert tone="error">
        <p className="font-semibold">{label}</p>
        <p className="mt-1 text-coral/85">{message}</p>
      </Alert>
      <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
        <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
        Try again
      </Button>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/70 py-2.5 last:border-b-0">
      <span className="text-[11.5px] text-muted">{label}</span>
      <span className="font-mono text-[10.5px] font-medium text-ink">{value}</span>
    </div>
  );
}

export default function AnalyticsPage() {
  useDocumentTitle("Analytics");
  const { activeOrganization, refresh } = useAuth();
  const organizationId = activeOrganization?.id;
  const [filters, setFilters] = useState<AnalyticsFilterState>(
    defaultAnalyticsFilters,
  );
  const [currency, setCurrency] = useState("USD");
  const [customerPage, setCustomerPage] = useState(1);
  const [planPage, setPlanPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [recurringView, setRecurringView] = useState<"mrr" | "arr">("mrr");
  const [exporting, setExporting] = useState<
    "revenue" | "subscriptions" | null
  >(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [base, setBase] = useState<LoadState<AnalyticsBaseData>>({
    status: "loading",
  });
  const [customers, setCustomers] = useState<
    LoadState<AnalyticsCustomersResponse>
  >({ status: "loading" });
  const [plans, setPlans] = useState<LoadState<AnalyticsPlansResponse>>({
    status: "loading",
  });

  useEffect(() => {
    setCustomerPage(1);
    setPlanPage(1);
    setExportNotice(null);
    setExportError(null);
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId) {
      setBase({ status: "error", message: "No active organization." });
      return;
    }

    const controller = new AbortController();
    const params = toRangeParams(filters);
    setBase({ status: "loading" });

    Promise.all([
      getAnalyticsOverview(params, controller.signal),
      getAnalyticsRevenue(params, controller.signal),
      getAnalyticsMrr(params, controller.signal),
      getAnalyticsSubscriptions(params, controller.signal),
      getAnalyticsChurn(params, controller.signal),
      getAnalyticsInvoices(params, controller.signal),
    ])
      .then(
        ([
          overview,
          revenue,
          mrr,
          subscriptions,
          churn,
          invoices,
        ]): void => {
          setBase({
            status: "ready",
            data: { overview, revenue, mrr, subscriptions, churn, invoices },
          });
        },
      )
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (isUnauthorizedError(error)) {
          void refresh();
        }

        setBase({
          status: "error",
          message: getErrorMessage(
            error,
            "Analytics could not be loaded for this workspace.",
          ),
        });
      });

    return () => controller.abort();
  }, [
    organizationId,
    filters,
    filters.from,
    filters.to,
    filters.timezone,
    filters.grouping,
    reloadKey,
    refresh,
  ]);

  useEffect(() => {
    if (!organizationId) {
      setCustomers({ status: "error", message: "No active organization." });
      return;
    }

    const controller = new AbortController();
    setCustomers({ status: "loading" });

    getAnalyticsCustomers(
      { ...toRangeParams(filters), page: customerPage, pageSize: 8 },
      controller.signal,
    )
      .then((data) => {
        setCustomers({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setCustomers({
          status: "error",
          message: getErrorMessage(
            error,
            "Customer performance could not be loaded.",
          ),
        });
      });

    return () => controller.abort();
  }, [
    organizationId,
    filters,
    filters.from,
    filters.to,
    filters.timezone,
    filters.grouping,
    customerPage,
    reloadKey,
  ]);

  useEffect(() => {
    if (!organizationId) {
      setPlans({ status: "error", message: "No active organization." });
      return;
    }

    const controller = new AbortController();
    setPlans({ status: "loading" });

    getAnalyticsPlans(
      { ...toRangeParams(filters), page: planPage, pageSize: 8 },
      controller.signal,
    )
      .then((data) => {
        setPlans({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setPlans({
          status: "error",
          message: getErrorMessage(error, "Plan performance could not be loaded."),
        });
      });

    return () => controller.abort();
  }, [
    organizationId,
    filters,
    filters.from,
    filters.to,
    filters.timezone,
    filters.grouping,
    planPage,
    reloadKey,
  ]);

  useEffect(() => {
    if (base.status !== "ready") {
      return;
    }

    const rows = base.data.overview.currencies;

    if (rows.length === 0 || rows.some((row) => row.currency === currency)) {
      return;
    }

    setCurrency(base.data.overview.defaultCurrency);
  }, [base, currency]);

  function handleFiltersChange(next: AnalyticsFilterState): void {
    setFilters(next);
    setCustomerPage(1);
    setPlanPage(1);
    setExportNotice(null);
    setExportError(null);
  }

  function retry(): void {
    setReloadKey((current) => current + 1);
  }

  async function exportCsv(kind: "revenue" | "subscriptions"): Promise<void> {
    setExporting(kind);
    setExportError(null);
    setExportNotice(null);

    try {
      const isRevenue = kind === "revenue";
      const result = await fetchAnalyticsCsv(
        isRevenue
          ? API_PATHS.analyticsRevenueCsv
          : API_PATHS.analyticsSubscriptionsCsv,
        toRangeParams(filters),
        isRevenue ? "revenue-report.csv" : "subscriptions-report.csv",
      );

      downloadTextFile(result.filename, `\uFEFF${result.text}`);
      setExportNotice(
        `${isRevenue ? "Revenue" : "Subscriptions"} report downloaded.`,
      );
    } catch (error) {
      setExportError(
        getErrorMessage(error, "The report could not be exported."),
      );
    } finally {
      setExporting(null);
    }
  }

  const activeCurrency =
    base.status === "ready" &&
    base.data.overview.currencies.some((row) => row.currency === currency)
      ? currency
      : base.status === "ready"
        ? base.data.overview.defaultCurrency
        : currency;

  return (
    <>
      <PageHeader
        eyebrow="Analytics · Revenue intelligence"
        title={
          <>
            The shape of
            <br className="hidden sm:block" /> your{" "}
            <span className="relative isolate inline-block italic">
              revenue
              <span
                aria-hidden="true"
                className="absolute bottom-1.5 left-0 -z-10 h-[0.2em] w-full rounded-full bg-lime"
              />
            </span>
            .
          </>
        }
        description={`How ${activeOrganization?.name ?? "your workspace"} earns, retains, and collects - computed live from subscriptions and invoices. Recurring revenue stays separate from cash, and currencies are never added together.`}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => void exportCsv("revenue")}
              disabled={exporting !== null}
            >
              {exporting === "revenue" ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin"
                  strokeWidth={2}
                />
              ) : (
                <Download aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.9} />
              )}
              Revenue CSV
            </Button>
            <Button
              variant="secondary"
              onClick={() => void exportCsv("subscriptions")}
              disabled={exporting !== null}
            >
              {exporting === "subscriptions" ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin"
                  strokeWidth={2}
                />
              ) : (
                <Download aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.9} />
              )}
              Subscriptions CSV
            </Button>
            <Link to="/subscriptions" className={buttonClassName()}>
              View subscriptions
              <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
            </Link>
          </>
        }
      />

      <div className="mt-7">
        <AnalyticsFilters value={filters} onChange={handleFiltersChange} />
      </div>

      {exportNotice ? (
        <Alert tone="success" className="mt-4">
          {exportNotice}
        </Alert>
      ) : null}

      {exportError ? (
        <Alert tone="error" className="mt-4">
          {exportError}
        </Alert>
      ) : null}

      {base.status === "loading" ? (
        <div className="mt-4">
          <AnalyticsSkeleton />
        </div>
      ) : null}

      {base.status === "error" ? (
        <Card className="mt-4">
          <ErrorBlock
            label="Analytics could not load."
            message={base.message}
            onRetry={retry}
          />
        </Card>
      ) : null}

      {base.status === "ready" ? (
        <AnalyticsContent
          data={base.data}
          activeCurrency={activeCurrency}
          onCurrencyChange={setCurrency}
          customers={customers}
          customerPage={customerPage}
          onCustomerPageChange={setCustomerPage}
          plans={plans}
          onPlanPageChange={setPlanPage}
          recurringView={recurringView}
          onRecurringViewChange={setRecurringView}
          onRetry={retry}
        />
      ) : null}
    </>
  );
}

interface AnalyticsContentProps {
  data: AnalyticsBaseData;
  activeCurrency: string;
  onCurrencyChange: (currency: string) => void;
  customers: LoadState<AnalyticsCustomersResponse>;
  customerPage: number;
  onCustomerPageChange: (page: number) => void;
  plans: LoadState<AnalyticsPlansResponse>;
  onPlanPageChange: (page: number) => void;
  recurringView: "mrr" | "arr";
  onRecurringViewChange: (view: "mrr" | "arr") => void;
  onRetry: () => void;
}

function AnalyticsContent({
  data,
  activeCurrency,
  onCurrencyChange,
  customers,
  customerPage,
  onCustomerPageChange,
  plans,
  onPlanPageChange,
  recurringView,
  onRecurringViewChange,
  onRetry,
}: AnalyticsContentProps) {
  const { overview, revenue, mrr, subscriptions, churn, invoices } = data;
  const range = overview.range;
  const overviewCurrency = overview.currencies.find(
    (row) => row.currency === activeCurrency,
  );
  const invoiceCurrency = invoices.currencies.find(
    (row) => row.currency === activeCurrency,
  );
  const revenueTotals = revenue.totals.find(
    (row) => row.currency === activeCurrency,
  );
  const mrrLatest = mrr.latest.find((row) => row.currency === activeCurrency);

  const labels = revenue.points.map((point) => point.label);
  const revenueInvoiced = revenue.points.map(
    (point) =>
      point.currencies.find((row) => row.currency === activeCurrency)
        ?.invoicedMinor ?? 0,
  );
  const revenueNet = revenue.points.map(
    (point) =>
      point.currencies.find((row) => row.currency === activeCurrency)
        ?.netCollectedMinor ?? 0,
  );
  const revenueOutstanding = revenue.points.map(
    (point) =>
      point.currencies.find((row) => row.currency === activeCurrency)
        ?.outstandingMinor ?? 0,
  );
  const mrrValues = mrr.points.map(
    (point) =>
      point.currencies.find((row) => row.currency === activeCurrency)
        ?.mrrMinor ?? 0,
  );
  const activeSubscriptionSeries = mrr.points.map(
    (point) => point.activeSubscriptions,
  );
  const newMrrValues = mrr.points.map(
    (point) =>
      point.currencies.find((row) => row.currency === activeCurrency)
        ?.newMrrMinor ?? 0,
  );
  const churnedMrrValues = mrr.points.map(
    (point) =>
      point.currencies.find((row) => row.currency === activeCurrency)
        ?.churnedMrrMinor ?? 0,
  );
  const growthLabels = subscriptions.points.map((point) => point.label);
  const newSubscriptionSeries = subscriptions.points.map(
    (point) => point.newSubscriptions,
  );
  const canceledSubscriptionSeries = subscriptions.points.map(
    (point) => point.canceledSubscriptions,
  );
  const currencyOptions = overview.currencies.length
    ? overview.currencies.map((row) => row.currency)
    : [activeCurrency];

  const currentMrr = mrrLatest?.mrrMinor ?? overviewCurrency?.mrrMinor ?? 0;
  const currentArr = currentMrr * 12;
  const previousMrr = mrrValues[mrrValues.length - 2] ?? 0;
  const mrrChange = percentChange(currentMrr, previousMrr);
  const previousCollected = revenueNet[revenueNet.length - 2] ?? 0;
  const collectedChange = percentChange(
    overviewCurrency?.netCollectedMinor ?? 0,
    previousCollected,
  );
  const activeChange = percentChange(
    overview.subscriptions.activeAtEnd,
    overview.subscriptions.activeAtStart,
  );
  const recurringScale = recurringView === "arr" ? 12 : 1;
  const recurringSeries = [
    {
      id: "recurring",
      label: recurringView === "arr" ? "ARR" : "MRR",
      values: mrrValues.map((value) => value * recurringScale),
      tone: "ink" as const,
      area: true,
    },
    {
      id: "new",
      label: "New",
      values: newMrrValues.map((value) => value * recurringScale),
      tone: "lime" as const,
    },
    {
      id: "churned",
      label: "Churned",
      values: churnedMrrValues.map((value) => value * recurringScale),
      tone: "coral" as const,
      dashed: true,
    },
  ];

  const hasAnyData =
    overview.currencies.length > 0 ||
    overview.customers.total > 0 ||
    overview.subscriptions.active > 0 ||
    overview.subscriptions.trialing > 0 ||
    overview.subscriptions.paused > 0 ||
    (plans.status === "ready" && plans.data.items.length > 0);

  const agingRows = invoices.aging.filter(
    (row) => row.currency === activeCurrency,
  );
  const agingMaximum = Math.max(
    ...agingRows.map((row) => row.amountMinor),
    1,
  );

  return (
    <div className="mt-4 space-y-4">
      <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div
            role="group"
            aria-label="Select reporting currency"
            className="flex flex-wrap items-center gap-1 rounded-full border border-line bg-surface-raised p-1"
          >
            {currencyOptions.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={activeCurrency === option}
                onClick={() => onCurrencyChange(option)}
                className={cn(
                  "h-7 rounded-full px-3 font-mono text-[9px] font-medium uppercase tracking-[0.1em] transition-colors",
                  activeCurrency === option
                    ? "bg-ink text-surface"
                    : "text-muted hover:text-ink",
                )}
              >
                {option}
              </button>
            ))}
          </div>
          <p className="text-[10.5px] leading-5 text-muted">
            {currencyOptions.length > 1
              ? `${currencyOptions.length} currencies · shown separately, never combined`
              : "Single reporting currency"}
          </p>
        </div>

        <p className="font-mono text-[8.5px] uppercase leading-5 tracking-[0.1em] text-muted">
          {formatIsoDate(range.from)} – {formatIsoDate(range.to)} · {range.timezone} ·{" "}
          {range.grouping}
        </p>
      </Card>

      {!hasAnyData ? (
        <Card className="p-5 sm:p-8">
          <EmptyState
            icon={BarChart3}
            title="Analytics starts with your first subscription."
            description="Create a customer and subscription to unlock recurring revenue, churn, retention, and collection reporting for this workspace."
            action={
              <Link
                to="/subscriptions/new"
                className={buttonClassName({ size: "sm" })}
              >
                <ArrowUpRight
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  strokeWidth={2}
                />
                Create a subscription
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <section
            aria-label="Key analytics metrics"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            <AnalyticsMetricCard
              label="Monthly recurring revenue"
              value={formatMoney(currentMrr, activeCurrency)}
              note={`ARR ${formatMoney(currentArr, activeCurrency)} annualized`}
              change={mrrChange}
              sentiment={
                mrrChange === null ? "neutral" : mrrChange >= 0 ? "positive" : "negative"
              }
              sparkline={mrrValues}
              comparison={`${formatNumber(
                overviewCurrency?.activeSubscriptions ?? 0,
              )} paying subscriptions in ${activeCurrency}`}
              highlighted
            />
            <AnalyticsMetricCard
              label="Annual recurring revenue"
              value={formatMoney(currentArr, activeCurrency)}
              note="Current MRR × 12 · normalized monthly"
              sparkline={mrrValues.map((value) => value * 12)}
              comparison={`Net new MRR ${formatMoney(
                mrrLatest?.netNewMrrMinor ?? 0,
                activeCurrency,
              )} in the latest bucket`}
            />
            <AnalyticsMetricCard
              label="Net cash collected"
              value={formatMoney(
                overviewCurrency?.netCollectedMinor ?? 0,
                activeCurrency,
              )}
              note={`Gross ${formatMoney(
                overviewCurrency?.grossCollectedMinor ?? 0,
                activeCurrency,
              )} · Refunded ${formatMoney(
                overviewCurrency?.refundedMinor ?? 0,
                activeCurrency,
              )}`}
              change={collectedChange}
              sentiment={
                collectedChange === null
                  ? "neutral"
                  : collectedChange >= 0
                    ? "positive"
                    : "negative"
              }
              sparkline={revenueNet}
              comparison={`${formatNumber(
                overviewCurrency?.activeCustomers ?? 0,
              )} active customers in ${activeCurrency}`}
            />
            <AnalyticsMetricCard
              label="Outstanding invoices"
              value={formatMoney(
                overviewCurrency?.outstandingMinor ?? 0,
                activeCurrency,
              )}
              note={`${formatBps(
                invoiceCurrency?.collectionRateBps ?? null,
              )} collection rate in range`}
              sparkline={revenueOutstanding}
              comparison={`Overdue ${formatMoney(
                invoiceCurrency?.overdueMinor ?? 0,
                activeCurrency,
              )} · Uncollectible ${formatMoney(
                invoiceCurrency?.uncollectibleMinor ?? 0,
                activeCurrency,
              )}`}
            />
            <AnalyticsMetricCard
              label="Active subscriptions"
              value={formatNumber(overview.subscriptions.active)}
              note={`${formatNumber(
                overview.subscriptions.trialing,
              )} trialing · ${formatNumber(overview.subscriptions.paused)} paused`}
              change={activeChange}
              sentiment={
                activeChange === null
                  ? "neutral"
                  : activeChange >= 0
                    ? "positive"
                    : "negative"
              }
              sparkline={activeSubscriptionSeries}
              comparison={`${formatNumber(
                overview.subscriptions.activeAtEnd,
              )} active at range end · ${formatNumber(
                overview.subscriptions.activeAtStart,
              )} at start`}
            />
            <AnalyticsMetricCard
              label="New subscriptions"
              value={formatNumber(overview.subscriptions.newInRange)}
              note="Started inside the reporting window"
              sparkline={newSubscriptionSeries}
              comparison={`${formatNumber(
                overview.customers.newInRange,
              )} new customers · ${formatNumber(
                overview.customers.returningInRange,
              )} returning`}
            />
            <AnalyticsMetricCard
              label="Canceled subscriptions"
              value={formatNumber(overview.subscriptions.canceledInRange)}
              note={`${formatBps(
                subscriptions.summary.churnRateBps,
              )} subscription churn rate`}
              sparkline={canceledSubscriptionSeries}
              comparison={`${formatBps(
                overview.retention.subscriptionRetentionBps,
              )} subscription retention · ${formatNumber(
                overview.retention.churnedSubscriptions,
              )} churned from start`}
            />
            <AnalyticsMetricCard
              label="Customer lifetime value"
              value={
                overviewCurrency?.customerLifetimeValueMinor == null
                  ? "\u2014"
                  : formatMoney(
                      overviewCurrency.customerLifetimeValueMinor,
                      activeCurrency,
                    )
              }
              note={`ARPC ${
                overviewCurrency?.averageRevenuePerCustomerMinor == null
                  ? "\u2014"
                  : formatMoney(
                      overviewCurrency.averageRevenuePerCustomerMinor,
                      activeCurrency,
                    )
              } · Avg subscription ${
                overviewCurrency?.averageSubscriptionValueMinor == null
                  ? "\u2014"
                  : formatMoney(
                      overviewCurrency.averageSubscriptionValueMinor,
                      activeCurrency,
                    )
              }`}
              comparison="Lifetime net revenue divided by customers who paid"
            />
          </section>

          <section
            aria-label="Revenue and retention"
            className="grid gap-4 xl:grid-cols-12"
          >
            <Card className="flex h-full flex-col p-5 sm:p-6 xl:col-span-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="eyebrow">Cash flow</p>
                  <h2 className="mt-2 font-display text-[27px] leading-none tracking-[-0.03em] text-ink">
                    Invoiced vs. collected
                  </h2>
                  <p className="mt-2 max-w-lg text-xs leading-5 text-muted">
                    Invoiced value is recognized when a bill is issued. Cash is
                    counted only when a payment lands, net of refunds.
                  </p>
                </div>
                <Badge tone="outline">{activeCurrency}</Badge>
              </div>

              <div className="mt-6 flex-1">
                <AnalyticsLineChart
                  labels={labels}
                  currency={activeCurrency}
                  ariaLabel={`Invoiced and net collected revenue by ${range.grouping} in ${activeCurrency}`}
                  series={[
                    {
                      id: "invoiced",
                      label: "Invoiced",
                      values: revenueInvoiced,
                      tone: "ink",
                    },
                    {
                      id: "collected",
                      label: "Net collected",
                      values: revenueNet,
                      tone: "lime",
                      area: true,
                    },
                  ]}
                />
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line/80 pt-4 sm:grid-cols-4">
                <div>
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                    Invoiced
                  </p>
                  <p className="mt-1 font-display text-lg leading-none text-ink">
                    {formatMoney(
                      revenueTotals?.invoicedMinor ?? 0,
                      activeCurrency,
                    )}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                    Net collected
                  </p>
                  <p className="mt-1 font-display text-lg leading-none text-ink">
                    {formatMoney(
                      revenueTotals?.netCollectedMinor ?? 0,
                      activeCurrency,
                    )}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                    Refunded
                  </p>
                  <p className="mt-1 font-display text-lg leading-none text-ink">
                    {formatMoney(
                      revenueTotals?.refundedMinor ?? 0,
                      activeCurrency,
                    )}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                    Outstanding
                  </p>
                  <p className="mt-1 font-display text-lg leading-none text-ink">
                    {formatMoney(
                      revenueTotals?.outstandingMinor ?? 0,
                      activeCurrency,
                    )}
                  </p>
                </div>
              </div>
            </Card>

            <div className="xl:col-span-4">
              <AnalyticsRetentionCard
                summary={churn.summary}
                currency={activeCurrency}
              />
            </div>
          </section>

          <section
            aria-label="Recurring revenue and subscription growth"
            className="grid gap-4 xl:grid-cols-12"
          >
            <Card className="flex h-full flex-col p-5 sm:p-6 xl:col-span-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="eyebrow">Recurring revenue</p>
                  <h2 className="mt-2 font-display text-[27px] leading-none tracking-[-0.03em] text-ink">
                    Monthly run rate
                  </h2>
                  <p className="mt-2 max-w-md text-xs leading-5 text-muted">
                    New MRR starts when billing starts, not on a trial. Churned
                    MRR only counts subscriptions that were paying at the start
                    of a bucket.
                  </p>
                </div>
                <div
                  role="group"
                  aria-label="Recurring revenue view"
                  className="flex rounded-full border border-line bg-surface-raised p-1"
                >
                  {(["mrr", "arr"] as const).map((view) => (
                    <button
                      key={view}
                      type="button"
                      aria-pressed={recurringView === view}
                      onClick={() => onRecurringViewChange(view)}
                      className={cn(
                        "h-7 rounded-full px-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.1em] transition-colors",
                        recurringView === view
                          ? "bg-ink text-surface"
                          : "text-muted hover:text-ink",
                      )}
                    >
                      {view}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-6 flex-1">
                <AnalyticsLineChart
                  labels={labels}
                  currency={activeCurrency}
                  ariaLabel={`${recurringView.toUpperCase()} history with new and churned recurring revenue in ${activeCurrency}`}
                  series={recurringSeries}
                />
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line/80 pt-4">
                {recurringSeries.map((series) => (
                  <span
                    key={series.id}
                    className="inline-flex items-center gap-2 text-[10.5px] text-muted"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-2 w-2 rounded-full",
                        series.tone === "ink"
                          ? "bg-ink"
                          : series.tone === "lime"
                            ? "bg-lime-deep"
                            : "bg-coral",
                      )}
                    />
                    {series.label}
                  </span>
                ))}
                <span className="ml-auto font-mono text-[8.5px] uppercase tracking-[0.1em] text-muted">
                  Latest {formatMoney(currentArr, activeCurrency)} ARR
                </span>
              </div>
            </Card>

            <Card className="flex h-full flex-col p-5 sm:p-6 xl:col-span-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="eyebrow">Movement</p>
                  <h2 className="mt-2 font-display text-[27px] leading-none tracking-[-0.03em] text-ink">
                    Subscription growth
                  </h2>
                  <p className="mt-2 text-xs leading-5 text-muted">
                    Starts and cancellations inside each bucket. Growth rate is
                    measured against subscriptions active at the start.
                  </p>
                </div>
                <Badge tone="outline">{range.grouping}</Badge>
              </div>

              <div className="mt-6 flex-1">
                <AnalyticsBarChart
                  labels={growthLabels}
                  ariaLabel="New and canceled subscriptions by period"
                  series={[
                    {
                      id: "new",
                      label: "New",
                      values: newSubscriptionSeries,
                      color: "#171712",
                    },
                    {
                      id: "canceled",
                      label: "Canceled",
                      values: canceledSubscriptionSeries,
                      color: "#dd5c3d",
                    },
                  ]}
                />
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3 border-t border-line/80 pt-4">
                <div>
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                    Net growth
                  </p>
                  <p className="mt-1 font-display text-xl leading-none text-ink">
                    {signedNumber(subscriptions.summary.netGrowth)}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                    Growth rate
                  </p>
                  <p className="mt-1 font-display text-xl leading-none text-ink">
                    {formatBps(subscriptions.summary.growthRateBps)}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                    Churn rate
                  </p>
                  <p className="mt-1 font-display text-xl leading-none text-ink">
                    {formatBps(subscriptions.summary.churnRateBps)}
                  </p>
                </div>
              </div>
            </Card>
          </section>

          <section aria-label="Plan performance" className="grid gap-4">
            <Card className="overflow-hidden p-0">
              <TableCardHeader
                eyebrow="Plans"
                title="What sells, what sticks"
                description={`Plan-level recurring revenue, cash, and churn for ${activeCurrency} and other currencies shown per row.`}
                aside={<Badge tone="outline">{activeCurrency} focus</Badge>}
              />

              {plans.status === "loading" ? <TableSkeleton /> : null}

              {plans.status === "error" ? (
                <ErrorBlock
                  label="Plan performance could not load."
                  message={plans.message}
                  onRetry={onRetry}
                />
              ) : null}

              {plans.status === "ready" && plans.data.items.length === 0 ? (
                <div className="px-4 py-7 sm:px-5">
                  <EmptyState
                    icon={Layers}
                    title="No plan activity in this window."
                    description="Plans appear here once subscriptions are created or billed inside the selected range."
                  />
                </div>
              ) : null}

              {plans.status === "ready" && plans.data.items.length > 0 ? (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] border-collapse">
                      <thead>
                        <tr className="border-b border-line bg-surface-raised/55 text-left">
                          <th className="px-5 py-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                            Plan
                          </th>
                          <th className="px-5 py-3 text-right font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                            MRR
                          </th>
                          <th className="px-5 py-3 text-right font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                            ARR
                          </th>
                          <th className="px-5 py-3 text-right font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                            Active
                          </th>
                          <th className="px-5 py-3 text-right font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                            New
                          </th>
                          <th className="px-5 py-3 text-right font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                            Canceled
                          </th>
                          <th className="px-5 py-3 text-right font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                            Collected
                          </th>
                          <th className="px-5 py-3 text-right font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                            Churn
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {plans.data.items.map((plan) => (
                          <tr
                            key={plan.planId}
                            className="transition-colors hover:bg-surface-raised/65"
                          >
                            <td className="px-5 py-4">
                              <Link
                                to={`/plans/${plan.planId}`}
                                className="font-medium text-ink underline-offset-4 hover:underline"
                              >
                                {plan.planName}
                              </Link>
                              <p className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.1em] text-muted">
                                {plan.planCode} · {plan.interval} · {plan.currency}
                              </p>
                            </td>
                            <td className="px-5 py-4 text-right font-mono text-[10.5px] text-ink">
                              {formatMoney(plan.mrrMinor, plan.currency)}
                            </td>
                            <td className="px-5 py-4 text-right font-mono text-[10.5px] text-ink-soft">
                              {formatMoney(plan.arrMinor, plan.currency)}
                            </td>
                            <td className="px-5 py-4 text-right font-mono text-[10.5px] text-ink">
                              {formatNumber(plan.activeSubscriptions)}
                            </td>
                            <td className="px-5 py-4 text-right font-mono text-[10.5px] text-ink-soft">
                              {formatNumber(plan.newSubscriptions)}
                            </td>
                            <td className="px-5 py-4 text-right font-mono text-[10.5px] text-ink-soft">
                              {formatNumber(plan.canceledSubscriptions)}
                            </td>
                            <td className="px-5 py-4 text-right">
                              <p className="font-mono text-[10.5px] text-ink">
                                {formatMoney(
                                  plan.netCollectedMinor,
                                  plan.currency,
                                )}
                              </p>
                              <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.08em] text-muted">
                                {formatMoney(
                                  plan.outstandingMinor,
                                  plan.currency,
                                )}{" "}
                                open
                              </p>
                            </td>
                            <td className="px-5 py-4 text-right font-mono text-[10.5px] text-ink-soft">
                              {formatBps(plan.churnRateBps)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <Pagination
                    page={plans.data.page}
                    totalPages={plans.data.totalPages}
                    total={plans.data.total}
                    pageSize={plans.data.pageSize}
                    itemLabel="plans"
                    onPageChange={onPlanPageChange}
                  />
                </>
              ) : null}
            </Card>
          </section>

          <section
            aria-label="Customer and invoice analytics"
            className="grid gap-4 xl:grid-cols-12"
          >
            <Card className="flex h-full flex-col overflow-hidden p-0 xl:col-span-7">
              <TableCardHeader
                eyebrow="Customers"
                title="Who compounds"
                description="Collected cash, open balance, and active subscriptions by customer in this window."
                aside={
                  <Badge tone="outline">{customerPage} of{" "}
                    {customers.status === "ready"
                      ? Math.max(customers.data.topCustomers.totalPages, 1)
                      : 1}
                  </Badge>
                }
              />

              {customers.status === "loading" ? <TableSkeleton /> : null}

              {customers.status === "error" ? (
                <ErrorBlock
                  label="Customer performance could not load."
                  message={customers.message}
                  onRetry={onRetry}
                />
              ) : null}

              {customers.status === "ready" &&
              customers.data.topCustomers.items.length === 0 ? (
                <div className="px-4 py-7 sm:px-5">
                  <EmptyState
                    icon={SearchX}
                    title="No customer revenue in this window."
                    description="Customers with payments or open invoices inside the selected range will appear here."
                  />
                </div>
              ) : null}

              {customers.status === "ready" &&
              customers.data.topCustomers.items.length > 0 ? (
                <>
                  <div className="flex-1 overflow-x-auto">
                    <table className="w-full min-w-[560px] border-collapse">
                      <thead>
                        <tr className="border-b border-line bg-surface-raised/55 text-left">
                          <th className="px-4 py-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted sm:px-5">
                            Customer
                          </th>
                          <th className="px-4 py-3 text-right font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted sm:px-5">
                            Net collected
                          </th>
                          <th className="px-4 py-3 text-right font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted sm:px-5">
                            Open
                          </th>
                          <th className="px-4 py-3 text-right font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted sm:px-5">
                            Active
                          </th>
                          <th className="hidden px-4 py-3 text-right font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted lg:table-cell sm:px-5">
                            Last payment
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {customers.data.topCustomers.items.map((customer) => (
                          <tr
                            key={`${customer.customerId}-${customer.currency}`}
                            className="transition-colors hover:bg-surface-raised/65"
                          >
                            <td className="px-4 py-4 sm:px-5">
                              <Link
                                to={`/customers/${customer.customerId}`}
                                className="font-medium text-ink underline-offset-4 hover:underline"
                              >
                                {customer.name}
                              </Link>
                              <p className="mt-1 truncate text-[11px] text-muted">
                                {customer.email} · {customer.currency}
                              </p>
                            </td>
                            <td className="px-4 py-4 text-right font-mono text-[10.5px] text-ink sm:px-5">
                              {formatMoney(
                                customer.netCollectedMinor,
                                customer.currency,
                              )}
                            </td>
                            <td className="px-4 py-4 text-right font-mono text-[10.5px] text-ink-soft sm:px-5">
                              {formatMoney(
                                customer.outstandingMinor,
                                customer.currency,
                              )}
                            </td>
                            <td className="px-4 py-4 text-right font-mono text-[10.5px] text-ink-soft sm:px-5">
                              {formatNumber(customer.activeSubscriptions)}
                            </td>
                            <td className="hidden px-4 py-4 text-right text-[11px] text-muted lg:table-cell sm:px-5">
                              {formatBillingDate(customer.lastPaymentAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-auto">
                    <Pagination
                      page={customers.data.topCustomers.page}
                      totalPages={customers.data.topCustomers.totalPages}
                      total={customers.data.topCustomers.total}
                      pageSize={customers.data.topCustomers.pageSize}
                      itemLabel="customers"
                      onPageChange={onCustomerPageChange}
                    />
                  </div>
                </>
              ) : null}
            </Card>

            <Card className="flex h-full flex-col p-5 sm:p-6 xl:col-span-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="eyebrow">Collections</p>
                  <h2 className="mt-2 font-display text-[27px] leading-none tracking-[-0.03em] text-ink">
                    Invoice performance
                  </h2>
                  <p className="mt-2 text-xs leading-5 text-muted">
                    Current open balances and aging for invoices issued in the
                    selected window.
                  </p>
                </div>
                <Badge tone="outline">{activeCurrency}</Badge>
              </div>

              <div className="mt-5">
                <StatRow
                  label="Invoiced"
                  value={formatMoney(
                    invoiceCurrency?.invoicedMinor ?? 0,
                    activeCurrency,
                  )}
                />
                <StatRow
                  label="Cash collected"
                  value={formatMoney(
                    invoiceCurrency?.cashCollectedMinor ?? 0,
                    activeCurrency,
                  )}
                />
                <StatRow
                  label="Refunded"
                  value={formatMoney(
                    invoiceCurrency?.refundedMinor ?? 0,
                    activeCurrency,
                  )}
                />
                <StatRow
                  label="Outstanding"
                  value={formatMoney(
                    invoiceCurrency?.outstandingMinor ?? 0,
                    activeCurrency,
                  )}
                />
                <StatRow
                  label="Overdue"
                  value={formatMoney(
                    invoiceCurrency?.overdueMinor ?? 0,
                    activeCurrency,
                  )}
                />
                <StatRow
                  label="Collection rate"
                  value={formatBps(invoiceCurrency?.collectionRateBps ?? null)}
                />
              </div>

              <div className="mt-6 border-t border-line/80 pt-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                    Receivables aging
                  </h3>
                  <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-muted">
                    {activeCurrency}
                  </span>
                </div>

                {agingRows.length === 0 ? (
                  <p className="mt-4 rounded-xl border border-dashed border-line px-4 py-5 text-center text-[11px] text-muted">
                    No open balances in this range.
                  </p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {agingRows.map((row) => (
                      <div key={row.bucket}>
                        <div className="flex items-baseline justify-between gap-4">
                          <span className="text-[11px] text-muted">
                            {INVOICE_AGING_LABELS[row.bucket]}
                          </span>
                          <span className="font-mono text-[10px] text-ink">
                            {formatMoney(row.amountMinor, activeCurrency)}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              row.bucket === "90+" ? "bg-coral" : "bg-ink",
                            )}
                            style={{
                              width: `${Math.min(
                                (row.amountMinor / agingMaximum) * 100,
                                100,
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-auto flex items-center gap-2 border-t border-line/80 pt-4 text-[10px] leading-5 text-muted">
                <Wallet
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0"
                  strokeWidth={1.7}
                />
                <p>
                  Generated {formatActivityTime(overview.generatedAt)} · invoice
                  totals scoped to {formatIsoDate(overview.range.from)} –{" "}
                  {formatIsoDate(overview.range.to)}
                </p>
              </div>
            </Card>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-1 text-[10px] leading-5 text-muted/80">
            <p className="inline-flex items-center gap-1.5">
              <Users aria-hidden="true" className="h-3 w-3" strokeWidth={1.8} />
              {formatNumber(customers.status === "ready"
                ? customers.data.summary.totalCustomers
                : overview.customers.total)}{" "}
              customers · {formatNumber(overview.subscriptions.trialing)} on trial ·{" "}
              {formatNumber(overview.customers.churnedInRange)} churned in range
            </p>
            <p>
              Revenue begins after a trial ends and stops at pause, cancellation,
              or expiry. Percentages are null when a denominator is zero.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
