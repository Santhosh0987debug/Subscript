import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  ReceiptText,
  RefreshCw,
  SearchX,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type {
  InvoiceListResponse,
  InvoiceSortField,
  InvoiceStatusFilter,
  SortDirection,
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
import { listInvoices } from "@/lib/api";
import {
  formatBillingDate,
  formatBillingPeriod,
  invoiceStatusLabels,
  invoiceStatusTones,
} from "@/lib/billing";
import { cn } from "@/lib/cn";
import { getErrorMessage, isUnauthorizedError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";

type InvoiceListState =
  | { status: "loading" }
  | { status: "ready"; data: InvoiceListResponse }
  | { status: "error"; message: string };

const STATUS_FILTERS: ReadonlyArray<{
  value: InvoiceStatusFilter;
  label: string;
}> = [
  { value: "ALL", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "OPEN", label: "Open" },
  { value: "PAID", label: "Paid" },
  { value: "VOID", label: "Void" },
  { value: "UNCOLLECTIBLE", label: "Uncollectible" },
];

const SORT_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
  sort: InvoiceSortField;
  direction: SortDirection;
}> = [
  {
    value: "createdAt:desc",
    label: "Newest first",
    sort: "createdAt",
    direction: "desc",
  },
  {
    value: "dueAt:asc",
    label: "Due soonest",
    sort: "dueAt",
    direction: "asc",
  },
  {
    value: "number:asc",
    label: "Invoice number",
    sort: "number",
    direction: "asc",
  },
  {
    value: "customer:asc",
    label: "Customer A-Z",
    sort: "customer",
    direction: "asc",
  },
  {
    value: "total:desc",
    label: "Largest total",
    sort: "total",
    direction: "desc",
  },
];

function InvoiceTableSkeleton() {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex items-center gap-4 px-5 py-5">
          <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-40 max-w-full" />
            <Skeleton className="mt-2 h-3 w-52 max-w-full" />
          </div>
          <Skeleton className="hidden h-4 w-24 sm:block" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export default function InvoicesPage() {
  useDocumentTitle("Invoices");
  const { activeOrganization, refresh } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationState = location.state as { notice?: string } | null;
  const [notice] = useState<string | null>(navigationState?.notice ?? null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<InvoiceStatusFilter>("ALL");
  const [sort, setSort] = useState<InvoiceSortField>("createdAt");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<InvoiceListState>({ status: "loading" });
  const organizationId = activeOrganization?.id;
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

    listInvoices(
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
          message: getErrorMessage(error, "Invoices could not be loaded."),
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
        eyebrow="Invoices · Ledger"
        title={
          <>
            A ledger that
            <br className="hidden sm:block" /> closes the{" "}
            <span className="relative isolate inline-block italic">
              loop
              <span
                aria-hidden="true"
                className="absolute bottom-1.5 left-0 -z-10 h-[0.2em] w-full rounded-full bg-lime"
              />
            </span>
            .
          </>
        }
        description={`Billing records for ${activeOrganization?.name ?? "your workspace"}. Every payment is a manual, internal record - no gateway is connected in this phase.`}
        actions={
          <Link
            to="/subscriptions"
            className={buttonClassName({ variant: "secondary" })}
          >
            <ReceiptText aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
            Generate from a subscription
          </Link>
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
            label="Search invoices"
            placeholder="Search invoice number or customer"
            className="w-full lg:max-w-sm"
          />

          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Filter invoices by status"
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

            <label className="sr-only" htmlFor="invoice-sort">
              Sort invoices
            </label>
            <select
              id="invoice-sort"
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
            <span className="sr-only">Loading invoices</span>
            <InvoiceTableSkeleton />
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="px-4 py-8 sm:px-5">
            <Alert tone="error">
              <p className="font-semibold">Invoices could not load.</p>
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

        {state.status === "ready" && state.data.invoices.length === 0 ? (
          <div className="px-4 py-8 sm:px-5">
            <EmptyState
              icon={hasFilters ? SearchX : ReceiptText}
              title={hasFilters ? "No invoices match." : "No invoices yet."}
              description={
                hasFilters
                  ? "Try a different search term or status filter."
                  : "Invoices are generated from a subscription period. Open a subscription to create the first draft."
              }
              action={
                hasFilters ? (
                  <Button variant="secondary" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : (
                  <Link
                    to="/subscriptions"
                    className={buttonClassName({ size: "sm" })}
                  >
                    View subscriptions
                  </Link>
                )
              }
            />
          </div>
        ) : null}

        {state.status === "ready" && state.data.invoices.length > 0 ? (
          <>
            <div className="hidden lg:block">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-line bg-surface-raised/55 text-left">
                    <th className="px-5 py-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                      Invoice
                    </th>
                    <th className="px-5 py-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                      Billing period
                    </th>
                    <th className="px-5 py-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                      Issued / due
                    </th>
                    <th className="px-5 py-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                      Status
                    </th>
                    <th className="px-5 py-3 text-right font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                      Total
                    </th>
                    <th className="px-5 py-3 text-right font-mono text-[8.5px] font-medium uppercase tracking-[0.13em] text-muted">
                      Due
                    </th>
                    <th className="px-5 py-3">
                      <span className="sr-only">Open invoice</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {state.data.invoices.map((invoice) => (
                    <tr
                      key={invoice.id}
                      className="group transition-colors hover:bg-surface-raised/65"
                    >
                      <td className="max-w-[280px] px-5 py-4">
                        <Link
                          to={`/invoices/${invoice.id}`}
                          className="flex min-w-0 items-center gap-3"
                        >
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink/[0.06] text-ink-soft">
                            <ReceiptText
                              aria-hidden="true"
                              className="h-4 w-4"
                              strokeWidth={1.8}
                            />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink group-hover:underline">
                              {invoice.number}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-muted">
                              {invoice.customerName}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-[10.5px] text-muted">
                        {formatBillingPeriod(
                          invoice.periodStart,
                          invoice.periodEnd,
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-4">
                        <p className="text-[10.5px] text-ink-soft">
                          {invoice.issuedAt
                            ? formatBillingDate(invoice.issuedAt)
                            : "Not issued"}
                        </p>
                        <p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-muted">
                          Due {formatBillingDate(invoice.dueAt)}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <Badge tone={invoiceStatusTones[invoice.status]}>
                          {invoiceStatusLabels[invoice.status]}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-right">
                        <p className="text-[12px] font-semibold text-ink">
                          {formatMoney(
                            invoice.total.amountMinor,
                            invoice.total.currency,
                          )}
                        </p>
                        <p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-muted">
                          {invoice.total.currency}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-right">
                        <p
                          className={cn(
                            "text-[11.5px] font-semibold",
                            invoice.amountDue.amountMinor > 0
                              ? "text-coral"
                              : "text-muted",
                          )}
                        >
                          {formatMoney(
                            invoice.amountDue.amountMinor,
                            invoice.amountDue.currency,
                          )}
                        </p>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <Link
                          to={`/invoices/${invoice.id}`}
                          aria-label={`Open invoice ${invoice.number}`}
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

            <ul className="divide-y divide-line lg:hidden">
              {state.data.invoices.map((invoice) => (
                <li key={invoice.id}>
                  <Link
                    to={`/invoices/${invoice.id}`}
                    className="flex items-start gap-3 px-4 py-4 transition-colors hover:bg-surface-raised/65"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink/[0.06] text-ink-soft">
                      <ReceiptText
                        aria-hidden="true"
                        className="h-4 w-4"
                        strokeWidth={1.8}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink">
                          {invoice.number}
                        </span>
                        <Badge tone={invoiceStatusTones[invoice.status]}>
                          {invoiceStatusLabels[invoice.status]}
                        </Badge>
                      </span>
                      <span className="mt-1 block truncate text-[11px] text-muted">
                        {invoice.customerName} ·{" "}
                        {formatBillingPeriod(
                          invoice.periodStart,
                          invoice.periodEnd,
                        )}
                      </span>
                      <span className="mt-1 block font-mono text-[8.5px] uppercase tracking-[0.08em] text-muted/80">
                        {formatMoney(
                          invoice.total.amountMinor,
                          invoice.total.currency,
                        )}{" "}
                        total · {formatMoney(
                          invoice.amountDue.amountMinor,
                          invoice.amountDue.currency,
                        )}{" "}
                        due
                      </span>
                    </span>
                    <ArrowUpRight
                      aria-hidden="true"
                      className="mt-1 h-4 w-4 shrink-0 text-muted"
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
              itemLabel="invoices"
              onPageChange={setPage}
            />
          </>
        ) : null}
      </Card>
    </>
  );
}
