import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Layers,
  Plus,
  RefreshCw,
  SearchX,
} from "lucide-react";

import type {
  PlanIntervalFilter,
  PlanListResponse,
  PlanSortField,
  PlanStatusFilter,
  SortDirection,
} from "@subscript/shared";
import { useAuth } from "@/auth/AuthProvider";
import { Alert } from "@/components/ui/Alert";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { SearchField } from "@/components/ui/SearchField";
import { Skeleton } from "@/components/ui/Skeleton";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { listPlans } from "@/lib/api";
import {
  billingIntervalLabels,
  getTrialLabel,
  planStatusLabels,
} from "@/lib/catalogue";
import { cn } from "@/lib/cn";
import { getErrorMessage, isUnauthorizedError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";

type PlanListState =
  | { status: "loading" }
  | { status: "ready"; data: PlanListResponse }
  | { status: "error"; message: string };

const STATUS_FILTERS: ReadonlyArray<{
  value: PlanStatusFilter;
  label: string;
}> = [
  { value: "ALL", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "ARCHIVED", label: "Archived" },
];

const INTERVAL_FILTERS: ReadonlyArray<{
  value: PlanIntervalFilter;
  label: string;
}> = [
  { value: "ALL", label: "All intervals" },
  { value: "MONTH", label: "Monthly" },
  { value: "YEAR", label: "Yearly" },
];

const SORT_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
  sort: PlanSortField;
  direction: SortDirection;
}> = [
  { value: "createdAt:desc", label: "Newest first", sort: "createdAt", direction: "desc" },
  { value: "name:asc", label: "Name A-Z", sort: "name", direction: "asc" },
  { value: "price:asc", label: "Price low-high", sort: "price", direction: "asc" },
  { value: "price:desc", label: "Price high-low", sort: "price", direction: "desc" },
  { value: "updatedAt:desc", label: "Recently updated", sort: "updatedAt", direction: "desc" },
];

const statusTone: Record<"ACTIVE" | "ARCHIVED", BadgeTone> = {
  ACTIVE: "lime",
  ARCHIVED: "outline",
};

function PlanTableSkeleton() {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex items-center gap-4 px-5 py-5">
          <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-40 max-w-full" />
            <Skeleton className="mt-2 h-3 w-56 max-w-full" />
          </div>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="hidden h-5 w-16 rounded-full sm:block" />
        </div>
      ))}
    </div>
  );
}

export default function PlansPage() {
  useDocumentTitle("Plans");
  const { activeOrganization, refresh } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationState = location.state as { notice?: string } | null;
  const [notice] = useState<string | null>(navigationState?.notice ?? null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<PlanStatusFilter>("ACTIVE");
  const [interval, setInterval] = useState<PlanIntervalFilter>("ALL");
  const [sort, setSort] = useState<PlanSortField>("createdAt");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<PlanListState>({ status: "loading" });
  const organizationId = activeOrganization?.id;
  const canManage =
    activeOrganization?.role === "OWNER" || activeOrganization?.role === "ADMIN";
  const hasFilters =
    status !== "ACTIVE" ||
    interval !== "ALL" ||
    debouncedSearch.trim().length > 0;

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

    listPlans(
      {
        query: debouncedSearch,
        status,
        interval,
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
          message: getErrorMessage(error, "Plans could not be loaded."),
        });
      });

    return () => {
      controller.abort();
    };
  }, [
    organizationId,
    debouncedSearch,
    status,
    interval,
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
    setStatus("ACTIVE");
    setInterval("ALL");
    setPage(1);
  }

  return (
    <>
      <PageHeader
        eyebrow="Plans · Catalogue"
        title={
          <>
            Packaging that
            <br className="hidden sm:block" /> holds its{" "}
            <span className="relative isolate inline-block italic">
              shape
              <span
                aria-hidden="true"
                className="absolute bottom-1.5 left-0 -z-10 h-[0.2em] w-full rounded-full bg-lime"
              />
            </span>
            .
          </>
        }
        description={`Pricing for ${activeOrganization?.name ?? "your workspace"} - explicit currencies, billing intervals, and trial periods that later subscriptions can rely on.`}
        actions={
          canManage ? (
            <Link to="/plans/new" className={buttonClassName()}>
              <Plus aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.2} />
              New plan
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
            label="Search plans"
            placeholder="Search plan name, code, or description"
            className="w-full lg:max-w-sm"
          />

          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Filter plans by status"
              className="flex rounded-full border border-line bg-surface-raised p-1"
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

            <label className="sr-only" htmlFor="plan-interval-filter">
              Filter plans by billing interval
            </label>
            <select
              id="plan-interval-filter"
              value={interval}
              onChange={(event) => {
                setInterval(event.target.value as PlanIntervalFilter);
                setPage(1);
              }}
              className="h-9 rounded-full border border-line bg-surface px-3 font-mono text-[8.5px] uppercase tracking-[0.08em] text-muted outline-none transition-colors hover:border-line-strong focus:border-ink focus:ring-2 focus:ring-lime/65"
            >
              {INTERVAL_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <label className="sr-only" htmlFor="plan-sort">
              Sort plans
            </label>
            <select
              id="plan-sort"
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
            <span className="sr-only">Loading plans</span>
            <PlanTableSkeleton />
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="px-4 py-8 sm:px-5">
            <Alert tone="error">
              <p className="font-semibold">Plans could not load.</p>
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

        {state.status === "ready" && state.data.plans.length === 0 ? (
          <div className="px-4 py-8 sm:px-5">
            <EmptyState
              icon={hasFilters ? SearchX : Layers}
              title={hasFilters ? "No plans match." : "No plans yet."}
              description={
                hasFilters
                  ? "Try a different search term, interval, or status filter."
                  : "Add the first plan so customers have something clear to subscribe to."
              }
              action={
                hasFilters ? (
                  <Button variant="secondary" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : canManage ? (
                  <Link to="/plans/new" className={buttonClassName({ size: "sm" })}>
                    <Plus aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.2} />
                    New plan
                  </Link>
                ) : undefined
              }
            />
          </div>
        ) : null}

        {state.status === "ready" && state.data.plans.length > 0 ? (
          <>
            <div className="hidden md:block">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-line bg-surface-raised/55 text-left">
                    <th className="px-5 py-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                      Plan
                    </th>
                    <th className="px-5 py-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                      Price
                    </th>
                    <th className="px-5 py-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                      Billing
                    </th>
                    <th className="px-5 py-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                      Trial
                    </th>
                    <th className="px-5 py-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                      Status
                    </th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {state.data.plans.map((plan) => (
                    <tr
                      key={plan.id}
                      className="group transition-colors hover:bg-surface-raised/65"
                    >
                      <td className="max-w-[300px] px-5 py-4">
                        <Link to={`/plans/${plan.id}`} className="block min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-[12.5px] font-semibold text-ink group-hover:underline">
                              {plan.name}
                            </span>
                            {plan.subscriptionCount > 0 ? (
                              <Badge tone="outline" className="shrink-0">
                                {plan.subscriptionCount} sub
                                {plan.subscriptionCount === 1 ? "" : "s"}
                              </Badge>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block truncate font-mono text-[8.5px] uppercase tracking-[0.1em] text-muted">
                            {plan.code}
                          </span>
                          {plan.description ? (
                            <span className="mt-1 block truncate text-[10.5px] text-muted">
                              {plan.description}
                            </span>
                          ) : null}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4">
                        <p className="text-[14px] font-semibold tracking-[-0.015em] text-ink">
                          {formatMoney(plan.price.amountMinor, plan.price.currency)}
                        </p>
                        <p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.1em] text-muted">
                          per {plan.interval === "MONTH" ? "month" : "year"}
                        </p>
                      </td>
                      <td className="px-5 py-4 text-[11.5px] text-ink-soft">
                        {billingIntervalLabels[plan.interval]}
                      </td>
                      <td className="px-5 py-4 text-[11px] text-muted">
                        {getTrialLabel(plan.trialDays)}
                      </td>
                      <td className="px-5 py-4">
                        <Badge tone={statusTone[plan.status]}>
                          {planStatusLabels[plan.status]}
                        </Badge>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <Link
                          to={`/plans/${plan.id}`}
                          aria-label={`Open ${plan.name}`}
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
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-line md:hidden">
              {state.data.plans.map((plan) => (
                <li key={plan.id}>
                  <Link
                    to={`/plans/${plan.id}`}
                    className="flex items-center gap-3 px-4 py-4 transition-colors hover:bg-surface-raised/65"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lime text-ink">
                      <Layers aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[12.5px] font-semibold text-ink">
                          {plan.name}
                        </span>
                        <Badge tone={statusTone[plan.status]}>
                          {planStatusLabels[plan.status]}
                        </Badge>
                      </span>
                      <span className="mt-1 block text-[12px] font-semibold text-ink-soft">
                        {formatMoney(plan.price.amountMinor, plan.price.currency)}{" "}
                        <span className="font-normal text-muted">
                          / {plan.interval === "MONTH" ? "mo" : "yr"}
                        </span>
                      </span>
                      <span className="mt-0.5 block font-mono text-[8.5px] uppercase tracking-[0.08em] text-muted/80">
                        {getTrialLabel(plan.trialDays)} ·{" "}
                        {billingIntervalLabels[plan.interval]}
                      </span>
                    </span>
                    <ArrowUpRight
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-muted"
                      strokeWidth={1.8}
                    />
                  </Link>
                </li>
              ))}
            </ul>

            <Pagination
              page={state.data.page}
              totalPages={state.data.totalPages}
              total={state.data.total}
              pageSize={state.data.pageSize}
              itemLabel="plans"
              onPageChange={setPage}
            />
          </>
        ) : null}
      </Card>
    </>
  );
}
