import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Plus,
  RefreshCw,
  SearchX,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import type {
  CustomerListResponse,
  CustomerSortField,
  CustomerStatusFilter,
  SortDirection,
} from "@subscript/shared";
import { useAuth } from "@/auth/AuthProvider";
import { Alert } from "@/components/ui/Alert";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { buttonClassName, Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { SearchField } from "@/components/ui/SearchField";
import { Skeleton } from "@/components/ui/Skeleton";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { listCustomers } from "@/lib/api";
import { customerStatusLabels } from "@/lib/catalogue";
import { cn } from "@/lib/cn";
import {
  getErrorMessage,
  isUnauthorizedError,
} from "@/lib/errors";
import { formatWorkspaceDate, getInitials } from "@/lib/identity";

type CustomerListState =
  | { status: "loading" }
  | { status: "ready"; data: CustomerListResponse }
  | { status: "error"; message: string };

const STATUS_FILTERS: ReadonlyArray<{
  value: CustomerStatusFilter;
  label: string;
}> = [
  { value: "ALL", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "ARCHIVED", label: "Archived" },
];

const SORT_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
  sort: CustomerSortField;
  direction: SortDirection;
}> = [
  { value: "createdAt:desc", label: "Newest first", sort: "createdAt", direction: "desc" },
  { value: "createdAt:asc", label: "Oldest first", sort: "createdAt", direction: "asc" },
  { value: "name:asc", label: "Name A-Z", sort: "name", direction: "asc" },
  { value: "name:desc", label: "Name Z-A", sort: "name", direction: "desc" },
  { value: "company:asc", label: "Company A-Z", sort: "company", direction: "asc" },
  { value: "updatedAt:desc", label: "Recently updated", sort: "updatedAt", direction: "desc" },
];

const statusTone: Record<"ACTIVE" | "ARCHIVED", BadgeTone> = {
  ACTIVE: "lime",
  ARCHIVED: "outline",
};

function CustomerTableSkeleton() {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-4 px-4 py-4 sm:px-5"
        >
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-40 max-w-full" />
            <Skeleton className="mt-2 h-3 w-56 max-w-full" />
          </div>
          <Skeleton className="hidden h-5 w-16 rounded-full sm:block" />
          <Skeleton className="hidden h-3 w-20 lg:block" />
        </div>
      ))}
    </div>
  );
}

export default function CustomersPage() {
  useDocumentTitle("Customers");
  const { activeOrganization, refresh } = useAuth();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<CustomerStatusFilter>("ACTIVE");
  const [sort, setSort] = useState<CustomerSortField>("createdAt");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<CustomerListState>({ status: "loading" });
  const organizationId = activeOrganization?.id;
  const canManage =
    activeOrganization?.role === "OWNER" || activeOrganization?.role === "ADMIN";

  const sortValue = `${sort}:${direction}`;
  const hasFilters = status !== "ACTIVE" || debouncedSearch.trim().length > 0;

  useEffect(() => {
    setPage(1);
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId) {
      setState({ status: "error", message: "No active organization." });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading" });

    listCustomers(
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
          message: getErrorMessage(error, "Customers could not be loaded."),
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

  const summary = useMemo(() => {
    if (state.status !== "ready") {
      return null;
    }

    return `${state.data.total} ${
      state.data.total === 1 ? "customer" : "customers"
    }`;
  }, [state]);

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
    setPage(1);
  }

  return (
    <>
      <PageHeader
        eyebrow="Customers · Directory"
        title={
          <>
            Every account,
            <br className="hidden sm:block" /> in clear{" "}
            <span className="relative isolate inline-block italic">
              view
              <span
                aria-hidden="true"
                className="absolute bottom-1.5 left-0 -z-10 h-[0.2em] w-full rounded-full bg-lime"
              />
            </span>
            .
          </>
        }
        description={`The people and businesses behind ${activeOrganization?.name ?? "your workspace"} - contact details, billing context, and a timeline of every change.`}
        actions={
          canManage ? (
            <Link to="/customers/new" className={buttonClassName()}>
              <Plus aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.2} />
              New customer
            </Link>
          ) : (
            <Badge tone="outline" className="h-8 px-3">
              Read-only access
            </Badge>
          )
        }
      />

      <Card className="mt-9 overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-4 lg:flex-row lg:items-center lg:justify-between sm:px-5">
          <SearchField
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            label="Search customers"
            placeholder="Search name, email, or company"
            className="w-full lg:max-w-sm"
          />

          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Filter customers by status"
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

            <label className="sr-only" htmlFor="customer-sort">
              Sort customers
            </label>
            <select
              id="customer-sort"
              value={sortValue}
              onChange={(event) => handleSortChange(event.target.value)}
              className="h-9 rounded-full border border-line bg-surface px-3 font-mono text-[8.5px] uppercase tracking-[0.08em] text-muted outline-none transition-colors hover:border-line-strong focus:border-ink focus:ring-2 focus:ring-lime/65"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            {summary ? (
              <Badge tone="outline" className="hidden xl:inline-flex">
                {summary}
              </Badge>
            ) : null}
          </div>
        </div>

        {state.status === "loading" ? (
          <div role="status" aria-live="polite">
            <span className="sr-only">Loading customers</span>
            <CustomerTableSkeleton />
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="px-4 py-8 sm:px-5">
            <Alert tone="error">
              <p className="font-semibold">Customers could not load.</p>
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

        {state.status === "ready" && state.data.customers.length === 0 ? (
          <div className="px-4 py-8 sm:px-5">
            <EmptyState
              icon={hasFilters ? SearchX : Users}
              title={hasFilters ? "No customers match." : "No customers yet."}
              description={
                hasFilters
                  ? "Try a different search term or widen the status filter."
                  : "Add the first account to start building a shared customer history."
              }
              action={
                hasFilters ? (
                  <Button variant="secondary" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : canManage ? (
                  <Link to="/customers/new" className={buttonClassName({ size: "sm" })}>
                    <Plus aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.2} />
                    New customer
                  </Link>
                ) : undefined
              }
            />
          </div>
        ) : null}

        {state.status === "ready" && state.data.customers.length > 0 ? (
          <>
            <div className="hidden md:block">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-line bg-surface-raised/55 text-left">
                    <th className="px-5 py-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                      Customer
                    </th>
                    <th className="px-5 py-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                      Company
                    </th>
                    <th className="px-5 py-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                      Status
                    </th>
                    <th className="px-5 py-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                      Added
                    </th>
                    <th className="px-5 py-3">
                      <span className="sr-only">Open customer</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {state.data.customers.map((customer) => (
                    <tr
                      key={customer.id}
                      className="group transition-colors hover:bg-surface-raised/65"
                    >
                      <td className="px-5 py-4">
                        <Link
                          to={`/customers/${customer.id}`}
                          className="flex min-w-0 items-center gap-3"
                        >
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#e9d9bf] text-[10px] font-semibold tracking-[0.03em] text-[#594831]">
                            {getInitials(customer.name)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[12.5px] font-semibold text-ink group-hover:underline">
                              {customer.name}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-muted">
                              {customer.email}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="max-w-[220px] px-5 py-4">
                        <p className="truncate text-[11.5px] text-ink-soft">
                          {customer.company || "—"}
                        </p>
                        {customer.phone ? (
                          <p className="mt-0.5 truncate font-mono text-[9px] text-muted">
                            {customer.phone}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-5 py-4">
                        <Badge tone={statusTone[customer.status]}>
                          {customerStatusLabels[customer.status]}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-[11px] text-muted">
                        {formatWorkspaceDate(customer.createdAt)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <Link
                          to={`/customers/${customer.id}`}
                          aria-label={`Open ${customer.name}`}
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
              {state.data.customers.map((customer) => (
                <li key={customer.id}>
                  <Link
                    to={`/customers/${customer.id}`}
                    className="flex items-center gap-3 px-4 py-4 transition-colors hover:bg-surface-raised/65"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#e9d9bf] text-[10px] font-semibold tracking-[0.03em] text-[#594831]">
                      {getInitials(customer.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[12.5px] font-semibold text-ink">
                          {customer.name}
                        </span>
                        <Badge tone={statusTone[customer.status]}>
                          {customerStatusLabels[customer.status]}
                        </Badge>
                      </span>
                      <span className="mt-1 block truncate text-[11px] text-muted">
                        {customer.email}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[8.5px] uppercase tracking-[0.08em] text-muted/80">
                        {customer.company || "No company"} ·{" "}
                        {formatWorkspaceDate(customer.createdAt)}
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
              itemLabel="customers"
              onPageChange={setPage}
            />
          </>
        ) : null}
      </Card>
    </>
  );
}
