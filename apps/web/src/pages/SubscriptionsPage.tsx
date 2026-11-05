import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  CreditCard,
  Plus,
  RefreshCw,
  SearchX,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type {
  SortDirection,
  SubscriptionListResponse,
  SubscriptionSortField,
  SubscriptionStatusFilter,
} from "@subscript/shared";
import { useAuth } from "@/auth/AuthProvider";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { SearchField } from "@/components/ui/SearchField";
import { Skeleton } from "@/components/ui/Skeleton";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { listSubscriptions } from "@/lib/api";
import {
  getNextBillingSummary,
  subscriptionStatusLabels,
  subscriptionStatusTones,
} from "@/lib/billing";
import { billingIntervalLabels } from "@/lib/catalogue";
import { cn } from "@/lib/cn";
import { getErrorMessage, isUnauthorizedError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";

type SubscriptionListState =
  | { status: "loading" }
  | { status: "ready"; data: SubscriptionListResponse }
  | { status: "error"; message: string };

const STATUS_FILTERS: ReadonlyArray<{
  value: SubscriptionStatusFilter;
  label: string;
}> = [
  { value: "ALL", label: "All" },
  { value: "TRIALING", label: "Trialing" },
  { value: "ACTIVE", label: "Active" },
  { value: "PAST_DUE", label: "Past due" },
  { value: "PAUSED", label: "Paused" },
  { value: "CANCELED", label: "Canceled" },
  { value: "EXPIRED", label: "Expired" },
];

const SORT_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
  sort: SubscriptionSortField;
  direction: SortDirection;
}> = [
  {
    value: "createdAt:desc",
    label: "Newest first",
    sort: "createdAt",
    direction: "desc",
  },
  {
    value: "nextBillingDate:asc",
    label: "Next billing",
    sort: "nextBillingDate",
    direction: "asc",
  },
  {
    value: "customer:asc",
    label: "Customer A-Z",
    sort: "customer",
    direction: "asc",
  },
  {
    value: "plan:asc",
    label: "Plan A-Z",
    sort: "plan",
    direction: "asc",
  },
  {
    value: "status:asc",
    label: "Status",
    sort: "status",
    direction: "asc",
  },
];

function SubscriptionTableSkeleton() {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex items-center gap-4 px-5 py-5">
          <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-44 max-w-full" />
            <Skeleton className="mt-2 h-3 w-56 max-w-full" />
          </div>
          <Skeleton className="hidden h-4 w-20 sm:block" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export default function SubscriptionsPage() {
  useDocumentTitle("Subscriptions");
  const { activeOrganization, refresh } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationState = location.state as { notice?: string } | null;
  const [notice] = useState<string | null>(navigationState?.notice ?? null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<SubscriptionStatusFilter>("ALL");
  const [sort, setSort] = useState<SubscriptionSortField>("createdAt");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<SubscriptionListState>({
    status: "loading",
  });
  const organizationId = activeOrganization?.id;
  const canManage =
    activeOrganization?.role === "OWNER" || activeOrganization?.role === "ADMIN";
  const hasFilters = status !== "ALL" || debouncedSearch.trim().length > 0;

  useEffect(() => {
    setPage(1);
  }, [organizationId]);

  useEffect(() => {
    if (navigationState?.notice) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, navigate, navigationState]);

  useEffect(() => {
    if (!organizationId) {
      setState({ status: "error", message: "No active organization." });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading" });

    listSubscriptions(
      {
        query: debouncedSearch,
        status,
        sort,
        direction,
        page,
        pageSize: 10,
      },
      controller.signal,
    )
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

        setState({
          status: "error",
          message: getErrorMessage(error, "Subscriptions could not be loaded."),
        });
      });

    return () => {
      controller.abort();
    };
  }, [
    organizationId,
    debouncedSearch,
    status,
    sort,
    direction,
    page,
    reloadKey,
    refresh,
  ]);

  function handleSortChange(value: string): void {
    const option = SORT_OPTIONS.find((candidate) => candidate.value === value);

    if (!option) {
      return;
    }

    setSort(option.sort);
    setDirection(option.direction);
    setPage(1);
  }

  function clearFilters(): void {
    setSearch("");
    setStatus("ALL");
    setPage(1);
  }

  return (
    <>
      <PageHeader
        eyebrow="Subscriptions · Lifecycle"
        title={
          <>
            Recurring revenue,
            <br className="hidden sm:block" /> kept in{" "}
            <span className="relative isolate inline-block italic">
              motion
              <span
                aria-hidden="true"
                className="absolute bottom-1.5 left-0 -z-10 h-[0.2em] w-full rounded-full bg-lime"
              />
            </span>
            .
          </>
        }
        description={`Every trial, renewal, pause, and cancellation for ${activeOrganization?.name ?? "your workspace"} in one tenant-scoped lifecycle.`}
        actions={
          canManage ? (
            <Link to="/subscriptions/new" className={buttonClassName()}>
              <Plus aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.2} />
              New subscription
            </Link>
          ) : (
            <Badge tone="outline" className="h-8 px-3">
              Read-only access
            </Badge>
          )
        }
      />

      {notice ? (
        <Alert tone="success" className="mt-7">
          {notice}
        </Alert>
      ) : null}

      <Card className="mt-9 overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-4 lg:flex-row lg:items-center lg:justify-between sm:px-5">
          <SearchField
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            label="Search subscriptions"
            placeholder="Search customer, plan, or code"
            className="w-full lg:max-w-sm"
          />

          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Filter subscriptions by status"
              className="flex flex-wrap rounded-full border border-line bg-surface-raised p-1"
            >
              {STATUS_FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={status === option.value}
                  onClick={() => {
                    setStatus(option.value);
                    setPage(1);
                  }}
                  className={cn(
                    "h-7 rounded-full px-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.08em] transition-colors",
                    status === option.value
                      ? "bg-ink text-surface"
                      : "text-muted hover:text-ink",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <label className="sr-only" htmlFor="subscription-sort">
              Sort subscriptions
            </label>
            <select
              id="subscription-sort"
              value={`${sort}:${direction}`}
              onChange={(event) => handleSortChange(event.target.value)}
              className="h-9 rounded-full border border-line bg-surface px-3 font-mono text-[8.5px] uppercase tracking-[0.08em] text-muted outline-none transition-colors hover:border-line-strong focus:border-ink focus:ring-2 focus:ring-lime/65"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {state.status === "loading" ? (
          <div role="status" aria-live="polite">
            <span className="sr-only">Loading subscriptions</span>
            <SubscriptionTableSkeleton />
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="px-4 py-8 sm:px-5">
            <Alert tone="error">
              <p className="font-semibold">Subscriptions could not load.</p>
              <p className="mt-1 text-coral/85">{state.message}</p>
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
          </div>
        ) : null}

        {state.status === "ready" && state.data.subscriptions.length === 0 ? (
          <div className="px-4 py-8 sm:px-5">
            <EmptyState
              icon={hasFilters ? SearchX : CreditCard}
              title={hasFilters ? "No subscriptions match." : "No subscriptions yet."}
              description={
                hasFilters
                  ? "Try a different search term or status filter."
                  : "Start a subscription from a customer and plan to begin tracking billing."
              }
              action={
                hasFilters ? (
                  <Button variant="secondary" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : canManage ? (
                  <Link
                    to="/subscriptions/new"
                    className={buttonClassName({ size: "sm" })}
                  >
                    <Plus aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.2} />
                    New subscription
                  </Link>
                ) : undefined
              }
            />
          </div>
        ) : null}

        {state.status === "ready" && state.data.subscriptions.length > 0 ? (
          <>
            <div className="hidden lg:block">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-line bg-surface-raised/55 text-left">
                    <th className="px-5 py-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                      Subscription
                    </th>
                    <th className="px-5 py-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                      Recurring
                    </th>
                    <th className="px-5 py-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                      Status
                    </th>
                    <th className="px-5 py-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                      Next billing
                    </th>
                    <th className="px-5 py-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                      Outstanding
                    </th>
                    <th className="px-5 py-3">
                      <span className="sr-only">Open subscription</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {state.data.subscriptions.map((subscription) => {
                    const nextBilling = getNextBillingSummary(subscription);

                    return (
                      <tr
                        key={subscription.id}
                        className="group transition-colors hover:bg-surface-raised/65"
                      >
                        <td className="max-w-[320px] px-5 py-4">
                          <Link
                            to={`/subscriptions/${subscription.id}`}
                            className="flex min-w-0 items-center gap-3"
                          >
                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lime text-ink">
                              <CreditCard
                                aria-hidden="true"
                                className="h-4 w-4"
                                strokeWidth={1.8}
                              />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-[12.5px] font-semibold text-ink group-hover:underline">
                                {subscription.customerName}
                              </span>
                              <span className="mt-0.5 block truncate text-[11px] text-muted">
                                {subscription.planName} ·{" "}
                                {billingIntervalLabels[subscription.interval]}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-5 py-4">
                          <p className="text-[13.5px] font-semibold tracking-[-0.015em] text-ink">
                            {formatMoney(
                              subscription.price.amountMinor * subscription.quantity,
                              subscription.price.currency,
                            )}
                          </p>
                          <p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.1em] text-muted">
                            {subscription.quantity} ×{" "}
                            {formatMoney(
                              subscription.price.amountMinor,
                              subscription.price.currency,
                            )}
                          </p>
                        </td>
                        <td className="px-5 py-4">
                          <Badge tone={subscriptionStatusTones[subscription.status]}>
                            {subscriptionStatusLabels[subscription.status]}
                          </Badge>
                          {subscription.cancelAtPeriodEnd ? (
                            <p className="mt-1.5 max-w-[130px] text-[9.5px] leading-4 text-muted">
                              Cancels at period end
                            </p>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4">
                          <p className="text-[11.5px] text-ink-soft">
                            {nextBilling.date}
                          </p>
                          <p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.1em] text-muted">
                            {nextBilling.label}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-5 py-4">
                          <p
                            className={cn(
                              "text-[11.5px] font-semibold",
                              subscription.outstanding.amountMinor > 0
                                ? "text-coral"
                                : "text-muted",
                            )}
                          >
                            {formatMoney(
                              subscription.outstanding.amountMinor,
                              subscription.outstanding.currency,
                            )}
                          </p>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <Link
                            to={`/subscriptions/${subscription.id}`}
                            aria-label={`Open subscription for ${subscription.customerName}`}
                            className="inline-grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-ink hover:text-surface"
                          >
                            <ArrowUpRight
                              aria-hidden="true"
                              className="h-3.5 w-3.5"
                              strokeWidth={2}
                            />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-line lg:hidden">
              {state.data.subscriptions.map((subscription) => {
                const nextBilling = getNextBillingSummary(subscription);

                return (
                  <li key={subscription.id}>
                    <Link
                      to={`/subscriptions/${subscription.id}`}
                      className="flex items-start gap-3 px-4 py-4 transition-colors hover:bg-surface-raised/65"
                    >
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lime text-ink">
                        <CreditCard
                          aria-hidden="true"
                          className="h-4 w-4"
                          strokeWidth={1.8}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-[12.5px] font-semibold text-ink">
                            {subscription.customerName}
                          </span>
                          <Badge
                            tone={subscriptionStatusTones[subscription.status]}
                          >
                            {subscriptionStatusLabels[subscription.status]}
                          </Badge>
                        </span>
                        <span className="mt-1 block truncate text-[11px] text-muted">
                          {subscription.planName} ·{" "}
                          {formatMoney(
                            subscription.price.amountMinor * subscription.quantity,
                            subscription.price.currency,
                          )}
                        </span>
                        <span className="mt-1 block font-mono text-[8.5px] uppercase tracking-[0.08em] text-muted/80">
                          {nextBilling.label} {nextBilling.date} · Outstanding{" "}
                          {formatMoney(
                            subscription.outstanding.amountMinor,
                            subscription.outstanding.currency,
                          )}
                        </span>
                      </span>
                      <ArrowUpRight
                        aria-hidden="true"
                        className="mt-1 h-4 w-4 shrink-0 text-muted"
                        strokeWidth={1.8}
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>

            <Pagination
              page={state.data.page}
              totalPages={state.data.totalPages}
              total={state.data.total}
              pageSize={state.data.pageSize}
              itemLabel="subscriptions"
              onPageChange={setPage}
            />
          </>
        ) : null}
      </Card>
    </>
  );
}
