import { useEffect, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  BellRing,
  CircleCheck,
  CircleX,
  Clock3,
  RefreshCw,
  RotateCcw,
  Send,
  ServerCog,
  TriangleAlert,
} from "lucide-react";
import { Link } from "react-router-dom";
import type {
  AutomationHealth,
  AutomationJobListResponse,
  AutomationJobStatus,
  AutomationJobStatusFilter,
  AutomationJobType,
  AutomationJobTypeFilter,
  AutomationNotificationListResponse,
  AutomationOverviewResponse,
  AutomationWorkerStatus,
  NotificationStatus,
  NotificationStatusFilter,
  NotificationType,
  NotificationTypeFilter,
} from "@subscript/shared";
import { useAuth } from "@/auth/AuthProvider";
import { Alert } from "@/components/ui/Alert";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { SelectField } from "@/components/ui/SelectField";
import { Skeleton } from "@/components/ui/Skeleton";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  dispatchAutomationOutbox,
  getAutomationOverview,
  listAutomationJobs,
  listAutomationNotifications,
  retryAutomationJob,
  retryAutomationNotification,
} from "@/lib/api";
import {
  formatActivityTime,
  formatBillingDate,
  subscriptionStatusLabels,
  subscriptionStatusTones,
} from "@/lib/billing";
import { getErrorMessage, isUnauthorizedError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";

type View = "renewals" | "jobs" | "notifications";

type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

const VIEW_OPTIONS: ReadonlyArray<{ value: View; label: string }> = [
  { value: "renewals", label: "Upcoming renewals" },
  { value: "jobs", label: "Scheduled jobs" },
  { value: "notifications", label: "Notifications" },
];

const jobStatusLabels: Record<AutomationJobStatus, string> = {
  PENDING: "Pending",
  QUEUED: "Queued",
  RUNNING: "Running",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
  DEAD_LETTER: "Dead letter",
  CANCELED: "Canceled",
};

const jobStatusTones: Record<AutomationJobStatus, BadgeTone> = {
  PENDING: "neutral",
  QUEUED: "outline",
  RUNNING: "lime",
  SUCCEEDED: "dark",
  FAILED: "coral",
  DEAD_LETTER: "coral",
  CANCELED: "outline",
};

const jobTypeLabels: Record<AutomationJobType, string> = {
  RENEWAL_REMINDER: "Renewal reminder",
  TRIAL_ENDING_REMINDER: "Trial ending reminder",
  TRIAL_ACTIVATION: "Trial activation",
  RECURRING_INVOICE: "Recurring invoice",
  CANCEL_AT_PERIOD_END: "Cancel at period end",
  STATUS_SYNC: "Status sync",
  PAYMENT_RECOVERY: "Payment recovery",
  SUBSCRIPTION_EXPIRATION: "Subscription expiration",
};

const notificationStatusLabels: Record<NotificationStatus, string> = {
  PENDING: "Pending",
  QUEUED: "Queued",
  SENDING: "Sending",
  SENT: "Sent",
  FAILED: "Failed",
  DEAD_LETTER: "Dead letter",
  SKIPPED: "Skipped",
};

const notificationStatusTones: Record<
  NotificationStatus,
  BadgeTone
> = {
  PENDING: "neutral",
  QUEUED: "outline",
  SENDING: "lime",
  SENT: "dark",
  FAILED: "coral",
  DEAD_LETTER: "coral",
  SKIPPED: "outline",
};

const notificationTypeLabels: Record<NotificationType, string> = {
  RENEWAL_UPCOMING: "Renewal upcoming",
  TRIAL_ENDING: "Trial ending",
  INVOICE_GENERATED: "Invoice generated",
  PAYMENT_SUCCEEDED: "Payment succeeded",
  PAYMENT_FAILED: "Payment failed",
  SUBSCRIPTION_CANCELED: "Subscription canceled",
  REFUND_UPDATED: "Refund updated",
};

const workerStatusLabels: Record<AutomationWorkerStatus, string> = {
  online: "Worker online",
  degraded: "Worker degraded",
  offline: "Worker offline",
  unknown: "Worker unknown",
};

const workerStatusTones: Record<AutomationWorkerStatus, BadgeTone> = {
  online: "lime",
  degraded: "coral",
  offline: "coral",
  unknown: "outline",
};

const jobStatusOptions: ReadonlyArray<{
  value: AutomationJobStatusFilter;
  label: string;
}> = [
  { value: "ALL", label: "All statuses" },
  ...(Object.keys(jobStatusLabels) as AutomationJobStatus[]).map((value) => ({
    value,
    label: jobStatusLabels[value],
  })),
];

const jobTypeOptions: ReadonlyArray<{
  value: AutomationJobTypeFilter;
  label: string;
}> = [
  { value: "ALL", label: "All job types" },
  ...(Object.keys(jobTypeLabels) as AutomationJobType[]).map((value) => ({
    value,
    label: jobTypeLabels[value],
  })),
];

const notificationStatusOptions: ReadonlyArray<{
  value: NotificationStatusFilter;
  label: string;
}> = [
  { value: "ALL", label: "All statuses" },
  ...(Object.keys(notificationStatusLabels) as NotificationStatus[]).map(
    (value) => ({
      value,
      label: notificationStatusLabels[value],
    }),
  ),
];

const notificationTypeOptions: ReadonlyArray<{
  value: NotificationTypeFilter;
  label: string;
}> = [
  { value: "ALL", label: "All notification types" },
  ...(Object.keys(notificationTypeLabels) as NotificationType[]).map(
    (value) => ({
      value,
      label: notificationTypeLabels[value],
    }),
  ),
];

function SummaryTile({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: number;
  detail: string;
  tone?: "neutral" | "coral";
}) {
  return (
    <Card className="px-4 py-4">
      <p className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-muted">
        {label}
      </p>
      <p
        className={
          tone === "coral"
            ? "mt-2 font-display text-3xl leading-none tracking-[-0.03em] text-coral"
            : "mt-2 font-display text-3xl leading-none tracking-[-0.03em] text-ink"
        }
      >
        {value}
      </p>
      <p className="mt-2 text-[11px] leading-5 text-muted">{detail}</p>
    </Card>
  );
}

function QueueCard({
  queue,
}: {
  queue: AutomationHealth["queues"][number];
}) {
  return (
    <Card className="px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-ink">
            {queue.displayName}
          </p>
          <p className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted">
            {queue.name} queue
          </p>
        </div>
        <Badge tone={queue.connected ? "lime" : "coral"}>
          {queue.connected ? "Connected" : "Unavailable"}
        </Badge>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3">
        {(
          [
            ["Waiting", queue.counts.waiting],
            ["Active", queue.counts.active],
            ["Delayed", queue.counts.delayed],
            ["Completed", queue.counts.completed],
            ["Failed", queue.counts.failed],
            ["Workers", queue.workers],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
              {label}
            </dt>
            <dd className="mt-0.5 text-[13px] font-semibold text-ink">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {queue.error ? (
        <p className="mt-3 text-[11px] leading-5 text-coral">{queue.error}</p>
      ) : null}
    </Card>
  );
}

function LoadingRows() {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex items-center gap-4 px-5 py-5">
          <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-44 max-w-full" />
            <Skeleton className="mt-2 h-3 w-60 max-w-full" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export default function AutomationPage() {
  useDocumentTitle("Operations");
  const { activeOrganization, refresh } = useAuth();
  const organizationId = activeOrganization?.id;
  const isAdmin =
    activeOrganization?.role === "OWNER" || activeOrganization?.role === "ADMIN";
  const [view, setView] = useState<View>("renewals");
  const [reloadKey, setReloadKey] = useState(0);
  const [overview, setOverview] = useState<LoadState<AutomationOverviewResponse>>({
    status: "loading",
  });
  const [jobs, setJobs] = useState<LoadState<AutomationJobListResponse>>({
    status: "loading",
  });
  const [notifications, setNotifications] = useState<
    LoadState<AutomationNotificationListResponse>
  >({ status: "loading" });
  const [jobStatus, setJobStatus] = useState<AutomationJobStatusFilter>("ALL");
  const [jobType, setJobType] = useState<AutomationJobTypeFilter>("ALL");
  const [jobPage, setJobPage] = useState(1);
  const [notificationStatus, setNotificationStatus] =
    useState<NotificationStatusFilter>("ALL");
  const [notificationType, setNotificationType] =
    useState<NotificationTypeFilter>("ALL");
  const [notificationPage, setNotificationPage] = useState(1);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setJobPage(1);
    setNotificationPage(1);
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId) {
      setOverview({ status: "error", message: "No active organization." });
      return;
    }

    const controller = new AbortController();
    setOverview({ status: "loading" });

    getAutomationOverview(controller.signal)
      .then((data) => {
        setOverview({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (isUnauthorizedError(error)) {
          void refresh();
        }

        setOverview({
          status: "error",
          message: getErrorMessage(error, "Automation health could not be loaded."),
        });
      });

    return () => {
      controller.abort();
    };
  }, [organizationId, reloadKey, refresh]);

  useEffect(() => {
    if (!organizationId) {
      setJobs({ status: "error", message: "No active organization." });
      return;
    }

    const controller = new AbortController();
    setJobs({ status: "loading" });

    listAutomationJobs(
      {
        status: jobStatus,
        type: jobType,
        page: jobPage,
        pageSize: 10,
      },
      controller.signal,
    )
      .then((data) => {
        setJobs({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setJobs({
          status: "error",
          message: getErrorMessage(error, "Scheduled jobs could not be loaded."),
        });
      });

    return () => {
      controller.abort();
    };
  }, [organizationId, jobStatus, jobType, jobPage, reloadKey]);

  useEffect(() => {
    if (!organizationId) {
      setNotifications({ status: "error", message: "No active organization." });
      return;
    }

    const controller = new AbortController();
    setNotifications({ status: "loading" });

    listAutomationNotifications(
      {
        status: notificationStatus,
        type: notificationType,
        page: notificationPage,
        pageSize: 10,
      },
      controller.signal,
    )
      .then((data) => {
        setNotifications({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setNotifications({
          status: "error",
          message: getErrorMessage(
            error,
            "Notification history could not be loaded.",
          ),
        });
      });

    return () => {
      controller.abort();
    };
  }, [organizationId, notificationStatus, notificationType, notificationPage, reloadKey]);

  function reload(): void {
    setReloadKey((current) => current + 1);
  }

  async function handleRetryJob(jobId: string): Promise<void> {
    setPendingAction(`job:${jobId}`);
    setActionError(null);
    setNotice(null);

    try {
      await retryAutomationJob(jobId);
      setNotice("The automation job was reset for another attempt.");
      reload();
    } catch (error) {
      setActionError(getErrorMessage(error, "The job could not be retried."));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleRetryNotification(notificationId: string): Promise<void> {
    setPendingAction(`notification:${notificationId}`);
    setActionError(null);
    setNotice(null);

    try {
      await retryAutomationNotification(notificationId);
      setNotice("The notification was queued for another delivery attempt.");
      reload();
    } catch (error) {
      setActionError(
        getErrorMessage(error, "The notification could not be retried."),
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function handleDispatch(): Promise<void> {
    setPendingAction("dispatch");
    setActionError(null);
    setNotice(null);

    try {
      const result = await dispatchAutomationOutbox();
      setNotice(
        `Dispatched ${result.queuedJobs} job${
          result.queuedJobs === 1 ? "" : "s"
        } and ${result.queuedNotifications} notification${
          result.queuedNotifications === 1 ? "" : "s"
        }.`,
      );
      reload();
    } catch (error) {
      setActionError(
        getErrorMessage(error, "Pending automation work could not be dispatched."),
      );
    } finally {
      setPendingAction(null);
    }
  }

  const health = overview.status === "ready" ? overview.data.health : null;
  const summary = overview.status === "ready" ? overview.data.summary : null;

  return (
    <>
      <PageHeader
        eyebrow="Automation / Operations"
        title={
          <>
            The quiet engine
            <br className="hidden sm:block" /> behind every{" "}
            <span className="relative isolate inline-block italic">
              renewal
              <span
                aria-hidden="true"
                className="absolute bottom-1.5 left-0 -z-10 h-[0.2em] w-full rounded-full bg-lime"
              />
            </span>
            .
          </>
        }
        description={`Scheduled billing work, payment recovery, and delivery history for ${
          activeOrganization?.name ?? "your workspace"
        }. Jobs are durable, retried with bounded backoff, and scoped to this organization.`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={reload}>
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
              Refresh
            </Button>
            {isAdmin ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleDispatch()}
                disabled={pendingAction === "dispatch"}
              >
                <Send aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                {pendingAction === "dispatch" ? "Dispatching..." : "Dispatch pending"}
              </Button>
            ) : null}
          </>
        }
      />

      {actionError ? (
        <Alert tone="error" className="mt-6">
          {actionError}
        </Alert>
      ) : null}

      {notice ? (
        <Alert tone="success" className="mt-6">
          {notice}
        </Alert>
      ) : null}

      <section className="mt-8" aria-labelledby="automation-health-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="automation-health-heading"
            className="font-display text-xl tracking-[-0.02em] text-ink"
          >
            Queue health
          </h2>
          {health ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={workerStatusTones[health.workerStatus]}>
                <Activity aria-hidden="true" className="h-3 w-3" strokeWidth={2} />
                {workerStatusLabels[health.workerStatus]}
              </Badge>
              <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted">
                Last seen {formatActivityTime(health.lastWorkerSeenAt)}
              </span>
            </div>
          ) : null}
        </div>

        {overview.status === "loading" ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-36 rounded-card" />
            ))}
          </div>
        ) : overview.status === "error" ? (
          <Alert tone="error" className="mt-4">
            {overview.message}
          </Alert>
        ) : (
          <>
            {!overview.data.health.enabled ? (
              <Alert tone="info" className="mt-4">
                Background automation is disabled. Configure{" "}
                <code className="font-mono text-[10.5px]">DATABASE_URL</code> and{" "}
                <code className="font-mono text-[10.5px]">REDIS_URL</code>, run the
                Prisma migrations, then start the worker with{" "}
                <code className="font-mono text-[10.5px]">npm run dev:worker -w
                @subscript/server</code>. Scheduled work stays durable in PostgreSQL
                until a worker is available.
              </Alert>
            ) : null}

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {overview.data.health.queues.map((queue) => (
                <QueueCard key={queue.name} queue={queue} />
              ))}
              <Card className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-semibold text-ink">
                      Worker heartbeat
                    </p>
                    <p className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted">
                      Independent process
                    </p>
                  </div>
                  <ServerCog
                    aria-hidden="true"
                    className="h-4 w-4 text-muted"
                    strokeWidth={1.8}
                  />
                </div>
                <p className="mt-4 text-[12px] leading-6 text-muted">
                  {overview.data.health.redisConfigured
                    ? "Redis is configured. Run the worker to process scheduled jobs and deliver notifications."
                    : "Redis is not configured, so no workers can report a heartbeat."}
                </p>
                <p className="mt-2 text-[11px] leading-5 text-muted">
                  Heartbeat generated {formatActivityTime(overview.data.health.generatedAt)}.
                </p>
              </Card>
            </div>
          </>
        )}
      </section>

      {summary ? (
        <section
          className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          aria-label="Automation summary"
        >
          <SummaryTile
            label="Pending jobs"
            value={summary.pendingJobs}
            detail="Durable intent waiting to be queued."
          />
          <SummaryTile
            label="Running jobs"
            value={summary.runningJobs}
            detail="Claimed by a worker right now."
          />
          <SummaryTile
            label="Failed / dead letter"
            value={summary.failedJobs + summary.deadLetterJobs}
            detail="Bounded retries; dead-letter jobs need review."
            tone={summary.failedJobs + summary.deadLetterJobs > 0 ? "coral" : "neutral"}
          />
          <SummaryTile
            label="Notifications waiting"
            value={summary.pendingNotifications}
            detail={`${summary.failedNotifications} failed delivery attempt${
              summary.failedNotifications === 1 ? "" : "s"
            }.`}
            tone={summary.failedNotifications > 0 ? "coral" : "neutral"}
          />
        </section>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center gap-2" role="tablist" aria-label="Operations views">
        {VIEW_OPTIONS.map((option) => (
          <Button
            key={option.value}
            role="tab"
            aria-selected={view === option.value}
            variant={view === option.value ? "primary" : "secondary"}
            size="sm"
            onClick={() => setView(option.value)}
          >
            {option.label}
          </Button>
        ))}
        {!isAdmin ? (
          <span className="ml-auto font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted">
            Read-only for your role
          </span>
        ) : null}
      </div>

      {view === "renewals" ? (
        <Card className="mt-4 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="font-display text-xl tracking-[-0.02em] text-ink">
                Upcoming renewals
              </h2>
              <p className="mt-1 text-[11.5px] leading-5 text-muted">
                Next {overview.status === "ready" ? overview.data.renewalWindowDays : 7} days of
                trial conversions and recurring renewals.
              </p>
            </div>
            <Badge tone="outline">
              {overview.status === "ready" ? overview.data.upcomingRenewals.length : 0} scheduled
            </Badge>
          </div>

          {overview.status === "loading" ? (
            <LoadingRows />
          ) : overview.status === "error" ? (
            <div className="p-5">
              <Alert tone="error">{overview.message}</Alert>
            </div>
          ) : overview.data.upcomingRenewals.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={Clock3}
                title="Nothing renews yet"
                description="Active and trialing subscriptions with a renewal date in the configured window will appear here."
              />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {overview.data.upcomingRenewals.map((renewal) => (
                <li
                  key={renewal.subscriptionId}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold text-ink">
                      {renewal.customerName}
                    </p>
                    <p className="mt-1 truncate text-[11.5px] text-muted">
                      {renewal.planName} - {renewal.customerEmail}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Badge tone={subscriptionStatusTones[renewal.status]}>
                      {subscriptionStatusLabels[renewal.status]}
                    </Badge>
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                      {formatBillingDate(renewal.renewalDate)}
                    </span>
                    <span className="text-[12.5px] font-semibold text-ink">
                      {formatMoney(renewal.amount.amountMinor, renewal.amount.currency)}
                    </span>
                    <Link
                      to={`/subscriptions/${renewal.subscriptionId}`}
                      className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-ink underline-offset-4 hover:underline"
                    >
                      View
                      <ArrowUpRight
                        aria-hidden="true"
                        className="h-3 w-3"
                        strokeWidth={2}
                      />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {view === "jobs" ? (
        <Card className="mt-4 overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-line px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="font-display text-xl tracking-[-0.02em] text-ink">
                Execution history
              </h2>
              <p className="mt-1 text-[11.5px] leading-5 text-muted">
                Scheduled work and retries. Job payloads are never exposed here.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:w-[420px]">
              <SelectField
                label="Status"
                value={jobStatus}
                onChange={(value) => {
                  setJobStatus(value as AutomationJobStatusFilter);
                  setJobPage(1);
                }}
                options={jobStatusOptions}
              />
              <SelectField
                label="Type"
                value={jobType}
                onChange={(value) => {
                  setJobType(value as AutomationJobTypeFilter);
                  setJobPage(1);
                }}
                options={jobTypeOptions}
              />
            </div>
          </div>

          {jobs.status === "loading" ? (
            <LoadingRows />
          ) : jobs.status === "error" ? (
            <div className="p-5">
              <Alert tone="error">{jobs.message}</Alert>
            </div>
          ) : jobs.data.jobs.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={Clock3}
                title="No scheduled work"
                description="The worker creates renewal, trial, invoice, and recovery jobs during each sweep. Nothing matches these filters yet."
              />
            </div>
          ) : (
            <>
              <ul className="divide-y divide-line">
                {jobs.data.jobs.map((job) => {
                  const canRetry =
                    isAdmin &&
                    (job.status === "FAILED" || job.status === "DEAD_LETTER");
                  const isPending = pendingAction === `job:${job.id}`;

                  return (
                    <li
                      key={job.id}
                      className="flex flex-col gap-3 px-5 py-4 xl:flex-row xl:items-center"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[13.5px] font-semibold text-ink">
                            {jobTypeLabels[job.type]}
                          </p>
                          <Badge tone={jobStatusTones[job.status]}>
                            {jobStatusLabels[job.status]}
                          </Badge>
                          <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted">
                            {job.queue}
                          </span>
                        </div>
                        <p className="mt-1 text-[11.5px] leading-5 text-muted">
                          Retry {job.attempts} of {job.maxAttempts} - run{" "}
                          {formatActivityTime(job.runAt)}
                          {job.finishedAt
                            ? ` - finished ${formatActivityTime(job.finishedAt)}`
                            : ""}
                        </p>
                        {job.lastError ? (
                          <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-5 text-coral">
                            <TriangleAlert
                              aria-hidden="true"
                              className="mt-0.5 h-3 w-3 shrink-0"
                              strokeWidth={2}
                            />
                            {job.lastError}
                          </p>
                        ) : job.resultSummary ? (
                          <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-5 text-muted">
                            <CircleCheck
                              aria-hidden="true"
                              className="mt-0.5 h-3 w-3 shrink-0"
                              strokeWidth={2}
                            />
                            {job.resultSummary}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted">
                          {formatBillingDate(job.createdAt)}
                        </span>
                        {canRetry ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void handleRetryJob(job.id)}
                            disabled={isPending}
                          >
                            <RotateCcw
                              aria-hidden="true"
                              className="h-3.5 w-3.5"
                              strokeWidth={2}
                            />
                            {isPending ? "Retrying..." : "Retry"}
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Pagination
                page={jobs.data.page}
                totalPages={jobs.data.totalPages}
                total={jobs.data.total}
                pageSize={jobs.data.pageSize}
                itemLabel="jobs"
                onPageChange={setJobPage}
              />
            </>
          )}
        </Card>
      ) : null}

      {view === "notifications" ? (
        <Card className="mt-4 overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-line px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="font-display text-xl tracking-[-0.02em] text-ink">
                Delivery history
              </h2>
              <p className="mt-1 text-[11.5px] leading-5 text-muted">
                Deduplicated customer notifications with bounded delivery retries.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:w-[440px]">
              <SelectField
                label="Status"
                value={notificationStatus}
                onChange={(value) => {
                  setNotificationStatus(
                    value as NotificationStatusFilter,
                  );
                  setNotificationPage(1);
                }}
                options={notificationStatusOptions}
              />
              <SelectField
                label="Type"
                value={notificationType}
                onChange={(value) => {
                  setNotificationType(
                    value as NotificationTypeFilter,
                  );
                  setNotificationPage(1);
                }}
                options={notificationTypeOptions}
              />
            </div>
          </div>

          {notifications.status === "loading" ? (
            <LoadingRows />
          ) : notifications.status === "error" ? (
            <div className="p-5">
              <Alert tone="error">{notifications.message}</Alert>
            </div>
          ) : notifications.data.notifications.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={BellRing}
                title="No notifications yet"
                description="Renewal reminders, invoice notices, payment updates, and recovery messages will appear here once the worker schedules them."
              />
            </div>
          ) : (
            <>
              <ul className="divide-y divide-line">
                {notifications.data.notifications.map((notification) => {
                  const canRetry =
                    isAdmin &&
                    (notification.status === "FAILED" ||
                      notification.status === "DEAD_LETTER");
                  const isPending =
                    pendingAction === `notification:${notification.id}`;

                  return (
                    <li
                      key={notification.id}
                      className="flex flex-col gap-3 px-5 py-4 xl:flex-row xl:items-center"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-[13.5px] font-semibold text-ink">
                            {notification.subject}
                          </p>
                          <Badge
                            tone={notificationStatusTones[notification.status]}
                          >
                            {notificationStatusLabels[notification.status]}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate text-[11.5px] leading-5 text-muted">
                          {notificationTypeLabels[notification.type]} to{" "}
                          {notification.recipientEmail}
                        </p>
                        <p className="mt-1 text-[11px] leading-5 text-muted">
                          Attempt {notification.attempts} of{" "}
                          {notification.maxAttempts}
                          {notification.sentAt
                            ? ` - sent ${formatActivityTime(notification.sentAt)}`
                            : notification.nextAttemptAt
                              ? ` - next attempt ${formatActivityTime(notification.nextAttemptAt)}`
                              : ""}
                        </p>
                        {notification.lastError ? (
                          <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-5 text-coral">
                            <CircleX
                              aria-hidden="true"
                              className="mt-0.5 h-3 w-3 shrink-0"
                              strokeWidth={2}
                            />
                            {notification.lastError}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted">
                          {formatActivityTime(notification.createdAt)}
                        </span>
                        {canRetry ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              void handleRetryNotification(notification.id)
                            }
                            disabled={isPending}
                          >
                            <RotateCcw
                              aria-hidden="true"
                              className="h-3.5 w-3.5"
                              strokeWidth={2}
                            />
                            {isPending ? "Retrying..." : "Retry"}
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Pagination
                page={notifications.data.page}
                totalPages={notifications.data.totalPages}
                total={notifications.data.total}
                pageSize={notifications.data.pageSize}
                itemLabel="notifications"
                onPageChange={setNotificationPage}
              />
            </>
          )}
        </Card>
      ) : null}
    </>
  );
}
