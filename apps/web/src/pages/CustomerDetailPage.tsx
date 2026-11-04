import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Archive,
  Building2,
  CalendarDays,
  CircleAlert,
  Mail,
  NotebookPen,
  Pencil,
  PencilLine,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  UserRound,
  Users,
} from "lucide-react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import type {
  CustomerActivityType,
  CustomerResponse,
} from "@subscript/shared";
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
  archiveCustomer,
  getCustomer,
  restoreCustomer,
} from "@/lib/api";
import { customerStatusLabels } from "@/lib/catalogue";
import { cn } from "@/lib/cn";
import {
  getErrorMessage,
  isUnauthorizedError,
} from "@/lib/errors";
import {
  formatWorkspaceDate,
  getInitials,
} from "@/lib/identity";

type DetailState =
  | { status: "loading" }
  | { status: "ready"; data: CustomerResponse }
  | { status: "notfound" }
  | { status: "error"; message: string };

const statusTone: Record<"ACTIVE" | "ARCHIVED", BadgeTone> = {
  ACTIVE: "lime",
  ARCHIVED: "outline",
};

const activityStyles: Record<
  CustomerActivityType,
  { icon: typeof Plus; className: string }
> = {
  CREATED: { icon: Plus, className: "bg-lime text-ink" },
  UPDATED: { icon: PencilLine, className: "bg-ink/[0.07] text-ink-soft" },
  ARCHIVED: { icon: Archive, className: "bg-coral-soft text-coral" },
  RESTORED: { icon: RotateCcw, className: "bg-[#dde8dc] text-moss" },
};

function formatActivityTime(isoDate: string): string {
  const date = new Date(isoDate);

  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function DetailSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-8">
      <span className="sr-only">Loading customer</span>
      <div className="space-y-4">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-16 w-full max-w-xl rounded-2xl" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>
      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="p-6 xl:col-span-8">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-6 h-24 w-full rounded-2xl" />
          <Skeleton className="mt-6 h-40 w-full rounded-2xl" />
        </Card>
        <Card className="p-6 xl:col-span-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-6 h-3 w-full" />
          <Skeleton className="mt-3 h-3 w-5/6" />
          <Skeleton className="mt-3 h-3 w-4/5" />
          <Skeleton className="mt-6 h-20 w-full rounded-2xl" />
        </Card>
      </div>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Mail;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface-raised/55 px-4 py-3.5">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink/[0.055] text-ink-soft">
        <Icon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.9} />
      </span>
      <div className="min-w-0">
        <p className="font-mono text-[8px] uppercase tracking-[0.13em] text-muted">
          {label}
        </p>
        <div className="mt-1 break-words text-[12px] leading-5 text-ink">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function CustomerDetailPage() {
  const { customerId = "" } = useParams();
  const { activeOrganization, refresh } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationState = location.state as { notice?: string } | null;
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(
    navigationState?.notice ?? null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const organizationId = activeOrganization?.id;
  const canManage =
    activeOrganization?.role === "OWNER" || activeOrganization?.role === "ADMIN";
  const customer = state.status === "ready" ? state.data.customer : null;

  useDocumentTitle(customer?.name ?? "Customer");

  useEffect(() => {
    if (navigationState?.notice) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, navigate, navigationState]);

  useEffect(() => {
    if (!organizationId || !customerId) {
      setState({ status: "notfound" });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading" });

    getCustomer(customerId, controller.signal)
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
          message: getErrorMessage(error, "This customer could not be loaded."),
        });
      });

    return () => {
      controller.abort();
    };
  }, [organizationId, customerId, reloadKey, refresh]);

  async function handleStatusChange(): Promise<void> {
    if (!customer) {
      return;
    }

    setActionPending(true);
    setActionError(null);
    setNotice(null);

    try {
      if (customer.status === "ACTIVE") {
        await archiveCustomer(customer.id);
        setNotice("Customer archived. Their history is preserved.");
      } else {
        await restoreCustomer(customer.id);
        setNotice("Customer restored to active.");
      }

      setReloadKey((current) => current + 1);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        void refresh();
        return;
      }

      setActionError(
        getErrorMessage(error, "The customer status could not be changed."),
      );
    } finally {
      setActionPending(false);
    }
  }

  if (state.status === "loading") {
    return (
      <>
        <Link
          to="/customers"
          className="inline-flex items-center gap-2 text-[11px] font-medium text-muted transition-colors hover:text-ink"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
          All customers
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
          eyebrow="Customers · Record"
          title="This customer is not here."
          description="The record may have been removed, or it belongs to another workspace."
        />
        <Card className="mt-9 p-6">
          <EmptyState
            icon={Users}
            title="Customer not found"
            description="Return to the directory and choose an account that belongs to this organization."
            action={
              <Link
                to="/customers"
                className={buttonClassName({ variant: "secondary", size: "sm" })}
              >
                <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                Back to customers
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
          eyebrow="Customers · Record"
          title="Customer unavailable."
          description="The workspace could not return this customer record."
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

  const { customer: record, activities } = state.data;
  const addressLines = [
    record.billingAddress.line1,
    record.billingAddress.line2,
    [record.billingAddress.city, record.billingAddress.region]
      .filter(Boolean)
      .join(", "),
    record.billingAddress.postalCode,
    record.billingAddress.country,
  ].filter((line) => line.trim().length > 0);

  return (
    <>
      <Link
        to="/customers"
        className="inline-flex items-center gap-2 text-[11px] font-medium text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
        All customers
      </Link>

      <div className="mt-5">
        <PageHeader
          eyebrow="Customers · Record"
          title={record.name}
          description={
            record.company
              ? `${record.company} · ${record.email}`
              : record.email
          }
          actions={
            canManage ? (
              <>
                <Link
                  to={`/customers/${record.id}/edit`}
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
        <div className="space-y-4 xl:col-span-8">
          <Card className="p-6 sm:p-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-[#e9d9bf] text-[13px] font-semibold tracking-[0.03em] text-[#594831]">
                  {getInitials(record.name)}
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">
                      Customer profile
                    </h2>
                    <Badge tone={statusTone[record.status]}>
                      {customerStatusLabels[record.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-muted">
                    Added {formatWorkspaceDate(record.createdAt)} · Updated{" "}
                    {formatWorkspaceDate(record.updatedAt)}
                  </p>
                </div>
              </div>
              <Badge tone="outline" className="self-start sm:self-auto">
                {activities.length} {activities.length === 1 ? "event" : "events"}
              </Badge>
            </div>

            <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
              <InfoRow icon={Mail} label="Email">
                <a
                  href={`mailto:${record.email}`}
                  className="underline decoration-line-strong underline-offset-2 hover:decoration-ink"
                >
                  {record.email}
                </a>
              </InfoRow>
              <InfoRow icon={Phone} label="Phone">
                {record.phone || <span className="text-muted">Not provided</span>}
              </InfoRow>
              <InfoRow icon={Building2} label="Company">
                {record.company || <span className="text-muted">Not provided</span>}
              </InfoRow>
              <InfoRow icon={UserRound} label="Status">
                {customerStatusLabels[record.status]}
              </InfoRow>
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-6">
              <div className="flex items-center gap-2">
                <CalendarDays
                  aria-hidden="true"
                  className="h-4 w-4 text-muted"
                  strokeWidth={1.8}
                />
                <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
                  Billing address
                </h2>
              </div>
              {addressLines.length > 0 ? (
                <address className="mt-4 space-y-0.5 text-[12px] not-italic leading-6 text-ink-soft">
                  {addressLines.map((line, index) => (
                    <p key={`${line}-${index}`}>{line}</p>
                  ))}
                </address>
              ) : (
                <p className="mt-4 text-[12px] text-muted">
                  No billing address recorded yet.
                </p>
              )}
            </Card>

            <Card className="p-6">
              <div className="flex items-center gap-2">
                <NotebookPen
                  aria-hidden="true"
                  className="h-4 w-4 text-muted"
                  strokeWidth={1.8}
                />
                <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
                  Notes
                </h2>
              </div>
              <p className="mt-4 whitespace-pre-wrap text-[12px] leading-6 text-ink-soft">
                {record.notes || (
                  <span className="text-muted">No notes recorded yet.</span>
                )}
              </p>
            </Card>
          </div>
        </div>

        <Card className="flex flex-col p-6 xl:col-span-4">
          <div>
            <p className="eyebrow">History</p>
            <h2 className="mt-2 font-display text-[26px] leading-none tracking-[-0.03em]">
              Activity timeline
            </h2>
            <p className="mt-2 text-xs text-muted">
              A durable record of changes to this customer.
            </p>
          </div>

          {activities.length === 0 ? (
            <div className="mt-5 flex flex-1 items-center">
              <EmptyState
                icon={CircleAlert}
                title="No activity yet"
                description="Changes to this customer will appear here."
                className="w-full"
              />
            </div>
          ) : (
            <ol className="mt-6 space-y-0">
              {activities.map((activity, index) => {
                const style = activityStyles[activity.type];
                const Icon = style.icon;
                const isLast = index === activities.length - 1;

                return (
                  <li key={activity.id} className="relative flex gap-3.5 pb-5 last:pb-0">
                    {!isLast ? (
                      <span
                        aria-hidden="true"
                        className="absolute left-[17px] top-9 h-[calc(100%-2rem)] w-px bg-line"
                      />
                    ) : null}
                    <span
                      className={cn(
                        "relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-xl",
                        style.className,
                      )}
                    >
                      <Icon
                        aria-hidden="true"
                        className="h-3.5 w-3.5"
                        strokeWidth={2}
                      />
                    </span>
                    <div className="min-w-0 pt-0.5">
                      <p className="text-[12px] leading-5 text-ink">
                        {activity.message}
                      </p>
                      <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.1em] text-muted/80">
                        {activity.actorName ?? "System"} ·{" "}
                        {formatActivityTime(activity.createdAt)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
