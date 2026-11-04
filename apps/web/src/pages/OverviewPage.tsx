import { Download, Sparkles, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { RenewalsCard } from "@/components/dashboard/RenewalsCard";
import { RevenueChart } from "@/components/dashboard/RevenueChart";
import { RevenueMixCard } from "@/components/dashboard/RevenueMixCard";
import { Button, buttonClassName } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  overviewData,
  planMixTotalMrr,
  upcomingRenewalTotal,
  type OverviewData,
} from "@/data/overview";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useOverviewPreview } from "@/hooks/useOverviewPreview";
import { downloadTextFile, toRevenueCsv } from "@/lib/csv";
import { getFirstName } from "@/lib/identity";

function exportRevenueReport(): void {
  const csv = toRevenueCsv(overviewData.revenue);
  downloadTextFile(
    "subscript-revenue-october-2026.csv",
    `\uFEFF${csv}`,
  );
}

function OverviewContent({ data }: { data: OverviewData }) {
  return (
    <div className="mt-9 space-y-4">
      <section aria-label="Key revenue metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <MetricCard
            key={metric.id}
            metric={metric}
            highlighted={metric.id === "mrr"}
          />
        ))}
      </section>

      <section aria-label="Revenue performance" className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <RevenueChart data={data.revenue} />
        </div>
        <div className="xl:col-span-4">
          <RevenueMixCard
            plans={data.planMix}
            retention={data.retention}
            totalMrr={planMixTotalMrr}
          />
        </div>
      </section>

      <section aria-label="Workspace activity and renewals" className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <ActivityFeed items={data.activity} />
        </div>
        <div className="xl:col-span-5">
          <RenewalsCard renewals={data.renewals} total={upcomingRenewalTotal} />
        </div>
      </section>

      <div className="flex items-center gap-2 px-1 pt-2 text-[10px] leading-5 text-muted/75">
        <Sparkles aria-hidden="true" className="h-3 w-3 shrink-0" strokeWidth={1.7} />
        <p>
          Revenue figures are illustrative preview data. Your session and workspace
          membership are live and organization-scoped.
        </p>
      </div>
    </div>
  );
}

export default function OverviewPage() {
  useDocumentTitle("Overview");
  const overview = useOverviewPreview();
  const { user, activeOrganization } = useAuth();
  const organizationName = activeOrganization?.name ?? "your workspace";
  const firstName = user ? getFirstName(user.name) : "there";

  return (
    <>
      <PageHeader
        eyebrow="Overview · October 2026"
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
        description={`Welcome back, ${firstName}. A clear read on how ${organizationName} is growing - the subscriptions behind the number, the customers driving it, and the revenue that compounds over time.`}
        actions={
          <>
            <Button variant="secondary" onClick={exportRevenueReport}>
              <Download aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.9} />
              Export report
            </Button>
            <Link to="/subscriptions" className={buttonClassName()}>
              View subscriptions
              <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
            </Link>
          </>
        }
      />

      {overview.status === "loading" ? (
        <div className="mt-9">
          <DashboardSkeleton />
        </div>
      ) : (
        <OverviewContent data={overview.data} />
      )}
    </>
  );
}
