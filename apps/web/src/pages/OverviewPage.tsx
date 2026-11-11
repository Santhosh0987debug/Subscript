import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  BarChart3,
  Download,
  LoaderCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { API_PATHS } from "@subscript/shared";
import type {
  AnalyticsChurnResponse,
  AnalyticsMrrResponse,
  AnalyticsOverviewResponse,
  AnalyticsRangeParams,
  AnalyticsRevenueResponse,
  AnalyticsSubscriptionGrowthResponse,
} from "@subscript/shared";
import { useAuth } from "@/auth/AuthProvider";
import { AnalyticsBarChart } from "@/components/analytics/AnalyticsBarChart";
import { AnalyticsLineChart } from "@/components/analytics/AnalyticsLineChart";
import { AnalyticsMetricCard } from "@/components/analytics/AnalyticsMetricCard";
import { AnalyticsRetentionCard } from "@/components/analytics/AnalyticsRetentionCard";
import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  defaultAnalyticsFilters,
  formatBps,
  type AnalyticsFilterState,
} from "@/lib/analytics";
import {
  fetchAnalyticsCsv,
  getAnalyticsChurn,
  getAnalyticsMrr,
  getAnalyticsOverview,
  getAnalyticsRevenue,
  getAnalyticsSubscriptions,
} from "@/lib/api";
import { formatBillingDate } from "@/lib/billing";
import { downloadTextFile } from "@/lib/csv";
import { getErrorMessage, isUnauthorizedError } from "@/lib/errors";
import { formatNumber } from "@/lib/format";
import { getFirstName } from "@/lib/identity";
import { formatMoney } from "@/lib/money";

interface DashboardData {
  overview: AnalyticsOverviewResponse;
  revenue: AnalyticsRevenueResponse;
  mrr: AnalyticsMrrResponse;
  subscriptions: AnalyticsSubscriptionGrowthResponse;
  churn: AnalyticsChurnResponse;
}

type DashboardState =
  | { status: "loading" }
  | { status: "ready"; data: DashboardData }
  | { status: "error"; message: string };

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

function GlanceRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/70 py-2.5 last:border-b-0">
      <span className="text-[11.5px] text-muted">{label}</span>
      <span className="font-mono text-[10.5px] font-medium text-ink">{value}</span>
    </div>
  );
}

function DashboardContent({ data }: { data: DashboardData }) {
  const { overview, revenue, mrr, subscriptions, churn } = data;
  const currency = overview.defaultCurrency;
  const currencyRow =
    overview.currencies.find((row) => row.currency === currency) ??
    overview.currencies[0];
  const mrrLatest = mrr.latest.find((row) => row.currency === currency);
  const labels = revenue.points.map((point) => point.label);
  const revenueInvoiced = revenue.points.map(
    (point) =>
      point.currencies.find((row) => row.currency === currency)
        ?.invoicedMinor ?? 0,
  );
  const revenueNet = revenue.points.map(
    (point) =>
      point.currencies.find((row) => row.currency === currency)
        ?.netCollectedMinor ?? 0,
  );
  const mrrValues = mrr.points.map(
    (point) =>
      point.currencies.find((row) => row.currency === currency)?.mrrMinor ?? 0,
  );
  const activeSubscriptionSeries = mrr.points.map(
    (point) => point.activeSubscriptions,
  );
  const growthLabels = subscriptions.points.map((point) => point.label);
  const newSubscriptions = subscriptions.points.map(
    (point) => point.newSubscriptions,
  );
  const canceledSubscriptions = subscriptions.points.map(
    (point) => point.canceledSubscriptions,
  );
  const currentMrr = mrrLatest?.mrrMinor ?? currencyRow?.mrrMinor ?? 0;
  const currentArr = currentMrr * 12;
  const previousMrr = mrrValues[mrrValues.length - 2] ?? 0;
  const mrrChange = percentChange(currentMrr, previousMrr);
  const previousCollected = revenueNet[revenueNet.length - 2] ?? 0;
  const collectedChange = percentChange(
    currencyRow?.netCollectedMinor ?? 0,
    previousCollected,
  );
  const activeChange = percentChange(
    overview.subscriptions.activeAtEnd,
    overview.subscriptions.activeAtStart,
  );
  const customerRetention =
    overview.retention.customerChurnRateBps === null
      ? null
      : 10_000 - overview.retention.customerChurnRateBps;
  const hasData =
    overview.currencies.length > 0 ||
    overview.customers.total > 0 ||
    overview.subscriptions.active > 0 ||
    overview.subscriptions.trialing > 0 ||
    overview.subscriptions.paused > 0;

  if (!hasData) {
    return (
      <div className="mt-9">
        <Card className="p-5 sm:p-8">
          <EmptyState
            icon={BarChart3}
            title="Your revenue story starts here."
            description="Create a customer and subscription to unlock live recurring revenue, collection, and retention metrics for this workspace."
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
      </div>
    );
  }

  const arpc = currencyRow?.averageRevenuePerCustomerMinor;
  const lifetimeValue = currencyRow?.customerLifetimeValueMinor;
  const averageSubscriptionValue = currencyRow?.averageSubscriptionValueMinor;

  return (
    <div className="mt-9 space-y-4">
      <section
        aria-label="Key revenue metrics"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <AnalyticsMetricCard
          label="Monthly recurring revenue"
          value={formatMoney(currentMrr, currency)}
          note={`ARR ${formatMoney(currentArr, currency)} annualized`}
          change={mrrChange}
          sentiment={
            mrrChange === null ? "neutral" : mrrChange >= 0 ? "positive" : "negative"
          }
          sparkline={mrrValues}
          comparison={`${formatNumber(
            currencyRow?.activeSubscriptions ?? 0,
          )} paying subscriptions`}
          highlighted
        />
        <AnalyticsMetricCard
          label="Net cash collected"
          value={formatMoney(currencyRow?.netCollectedMinor ?? 0, currency)}
          note={`Gross ${formatMoney(
            currencyRow?.grossCollectedMinor ?? 0,
            currency,
          )} · Refunded ${formatMoney(
            currencyRow?.refundedMinor ?? 0,
            currency,
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
            overview.customers.newInRange,
          )} new · ${formatNumber(
            overview.customers.returningInRange,
          )} returning customers`}
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
          )} at range end · ${formatNumber(
            overview.subscriptions.activeAtStart,
          )} at start`}
        />
        <AnalyticsMetricCard
          label="Customer retention"
          value={formatBps(customerRetention)}
          note={`${formatNumber(
            overview.retention.churnedCustomers,
          )} of ${formatNumber(
            overview.retention.startingCustomers,
          )} customers churned`}
          sparkline={activeSubscriptionSeries}
          comparison={`${formatBps(
            overview.retention.subscriptionRetentionBps,
          )} subscription retention`}
        />
      </section>

      <section
        aria-label="Revenue performance"
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
                counted when a payment lands, net of refunds.
              </p>
            </div>
            <Badge tone="outline">{currency}</Badge>
          </div>

          <div className="mt-6 flex-1">
            <AnalyticsLineChart
              labels={labels}
              currency={currency}
              ariaLabel={`Invoiced and net collected revenue for ${currency}`}
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

          <p className="mt-5 border-t border-line/80 pt-4 text-[10.5px] leading-5 text-muted">
            {formatIsoDate(overview.range.from)} –{" "}
            {formatIsoDate(overview.range.to)} · {overview.range.timezone} ·{" "}
            {overview.range.grouping} buckets ·{" "}
            {formatMoney(currencyRow?.outstandingMinor ?? 0, currency)} currently
            outstanding
          </p>
        </Card>

        <div className="xl:col-span-4">
          <AnalyticsRetentionCard summary={churn.summary} currency={currency} />
        </div>
      </section>

      <section
        aria-label="Subscription movement and customer economics"
        className="grid gap-4 xl:grid-cols-12"
      >
        <Card className="flex h-full flex-col p-5 sm:p-6 xl:col-span-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Movement</p>
              <h2 className="mt-2 font-display text-[27px] leading-none tracking-[-0.03em] text-ink">
                Subscription growth
              </h2>
              <p className="mt-2 text-xs leading-5 text-muted">
                Starts and cancellations inside each {overview.range.grouping}.
              </p>
            </div>
            <Badge tone="outline">
              {formatBps(subscriptions.summary.growthRateBps)} growth
            </Badge>
          </div>

          <div className="mt-6 flex-1">
            <AnalyticsBarChart
              labels={growthLabels}
              ariaLabel="New and canceled subscriptions by period"
              series={[
                {
                  id: "new",
                  label: "New",
                  values: newSubscriptions,
                  color: "#171712",
                },
                {
                  id: "canceled",
                  label: "Canceled",
                  values: canceledSubscriptions,
                  color: "#dd5c3d",
                },
              ]}
            />
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-line/80 pt-4">
            <div>
              <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                New
              </p>
              <p className="mt-1 font-display text-xl leading-none text-ink">
                {formatNumber(subscriptions.summary.newSubscriptions)}
              </p>
            </div>
            <div>
              <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                Canceled
              </p>
              <p className="mt-1 font-display text-xl leading-none text-ink">
                {formatNumber(subscriptions.summary.canceledSubscriptions)}
              </p>
            </div>
            <div>
              <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                Net growth
              </p>
              <p className="mt-1 font-display text-xl leading-none text-ink">
                {subscriptions.summary.netGrowth > 0 ? "+" : ""}
                {formatNumber(subscriptions.summary.netGrowth)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="flex h-full flex-col p-5 sm:p-6 xl:col-span-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">At a glance</p>
              <h2 className="mt-2 font-display text-[27px] leading-none tracking-[-0.03em] text-ink">
                Who compounds
              </h2>
              <p className="mt-2 text-xs leading-5 text-muted">
                Customer economics for {currency}.
              </p>
            </div>
            <Badge tone="outline">{currency}</Badge>
          </div>

          <div className="mt-5">
            <GlanceRow
              label="New customers"
              value={formatNumber(overview.customers.newInRange)}
            />
            <GlanceRow
              label="Returning customers"
              value={formatNumber(overview.customers.returningInRange)}
            />
            <GlanceRow
              label="Active customers"
              value={formatNumber(currencyRow?.activeCustomers ?? 0)}
            />
            <GlanceRow
              label="Average revenue per customer"
              value={
                arpc == null ? "\u2014" : formatMoney(arpc, currency)
              }
            />
            <GlanceRow
              label="Average subscription value"
              value={
                averageSubscriptionValue == null
                  ? "\u2014"
                  : formatMoney(averageSubscriptionValue, currency)
              }
            />
            <GlanceRow
              label="Customer lifetime value"
              value={
                lifetimeValue == null
                  ? "\u2014"
                  : formatMoney(lifetimeValue, currency)
              }
            />
          </div>

          <div className="mt-auto pt-5">
            <Link
              to="/analytics"
              className={buttonClassName({
                variant: "secondary",
                size: "sm",
                className: "w-full",
              })}
            >
              Explore the full analytics workspace
              <ArrowUpRight
                aria-hidden="true"
                className="h-3.5 w-3.5"
                strokeWidth={2}
              />
            </Link>
          </div>
        </Card>
      </section>

      <div className="flex items-start gap-2 px-1 pt-1 text-[10px] leading-5 text-muted/80">
        <Sparkles
          aria-hidden="true"
          className="mt-0.5 h-3 w-3 shrink-0"
          strokeWidth={1.7}
        />
        <p>
          All figures are computed live from this workspace&apos;s subscriptions
          and invoices.{" "}
          {overview.currencies.length > 1
            ? `${overview.currencies.length} currencies are reported separately; this card shows ${currency}.`
            : "Amounts are shown in their original currency."}{" "}
          Revenue begins after a trial and stops at pause, cancellation, or
          expiry.
        </p>
      </div>
    </div>
  );
}

export default function OverviewPage() {
  useDocumentTitle("Overview");
  const { user, activeOrganization, refresh } = useAuth();
  const organizationName = activeOrganization?.name ?? "your workspace";
  const firstName = user ? getFirstName(user.name) : "there";
  const [filters] = useState<AnalyticsFilterState>(defaultAnalyticsFilters);
  const [reloadKey, setReloadKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [state, setState] = useState<DashboardState>({ status: "loading" });
  const organizationId = activeOrganization?.id;

  useEffect(() => {
    if (!organizationId) {
      setState({ status: "error", message: "No active organization." });
      return;
    }

    const controller = new AbortController();
    const params = toRangeParams(filters);
    setState({ status: "loading" });

    Promise.all([
      getAnalyticsOverview(params, controller.signal),
      getAnalyticsRevenue(params, controller.signal),
      getAnalyticsMrr(params, controller.signal),
      getAnalyticsSubscriptions(params, controller.signal),
      getAnalyticsChurn(params, controller.signal),
    ])
      .then(([overview, revenue, mrr, subscriptions, churn]): void => {
        setState({
          status: "ready",
          data: { overview, revenue, mrr, subscriptions, churn },
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (isUnauthorizedError(error)) {
          void refresh();
        }

        setState({
          status: "error",
          message: getErrorMessage(
            error,
            "Your revenue overview could not be loaded.",
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

  async function exportRevenueReport(): Promise<void> {
    setExporting(true);
    setExportError(null);
    setExportNotice(null);

    try {
      const result = await fetchAnalyticsCsv(
        API_PATHS.analyticsRevenueCsv,
        toRangeParams(filters),
        "revenue-report.csv",
      );

      downloadTextFile(result.filename, `\uFEFF${result.text}`);
      setExportNotice("Revenue report downloaded.");
    } catch (error) {
      setExportError(
        getErrorMessage(error, "The revenue report could not be exported."),
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={`Overview · ${formatIsoDate(filters.from)} – ${formatIsoDate(
          filters.to,
        )}`}
        title={
          <>
            Your revenue,
            <br className="hidden sm:block" /> in{" "}
            <span className="relative isolate inline-block italic">
              focus
              <span
                aria-hidden="true"
                className="absolute bottom-1.5 left-0 -z-10 h-[0.2em] w-full rounded-full bg-lime"
              />
            </span>
            .
          </>
        }
        description={`Welcome back, ${firstName}. A live read on how ${organizationName} is growing - the recurring revenue, the cash behind it, and the customers who stay.`}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => void exportRevenueReport()}
              disabled={exporting || state.status === "loading"}
            >
              {exporting ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin"
                  strokeWidth={2}
                />
              ) : (
                <Download
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  strokeWidth={1.9}
                />
              )}
              Export report
            </Button>
            <Link to="/analytics" className={buttonClassName()}>
              Open analytics
              <ArrowUpRight
                aria-hidden="true"
                className="h-3.5 w-3.5"
                strokeWidth={2}
              />
            </Link>
          </>
        }
      />

      {exportNotice ? (
        <Alert tone="success" className="mt-7">
          {exportNotice}
        </Alert>
      ) : null}

      {exportError ? (
        <Alert tone="error" className="mt-7">
          {exportError}
        </Alert>
      ) : null}

      {state.status === "loading" ? (
        <div className="mt-9">
          <DashboardSkeleton />
        </div>
      ) : null}

      {state.status === "error" ? (
        <Card className="mt-9 p-5 sm:p-6">
          <Alert tone="error">
            <p className="font-semibold">Overview could not load.</p>
            <p className="mt-1 text-coral/85">{state.message}</p>
          </Alert>
          <Button
            variant="secondary"
            className="mt-4"
            onClick={() => setReloadKey((current) => current + 1)}
          >
            <RefreshCw
              aria-hidden="true"
              className="h-3.5 w-3.5"
              strokeWidth={2}
            />
            Try again
          </Button>
        </Card>
      ) : null}

      {state.status === "ready" ? (
        <DashboardContent data={state.data} />
      ) : null}
    </>
  );
}
