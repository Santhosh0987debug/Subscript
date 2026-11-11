import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

export function AnalyticsSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-4">
      <span className="sr-only">Loading analytics</span>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Card
            key={index}
            className={
              index === 0
                ? "min-h-[214px] border-lime-deep/30 bg-lime/25 p-5 sm:p-6"
                : "min-h-[214px] p-5 sm:p-6"
            }
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
            <Skeleton className="mt-7 h-9 w-32 rounded-xl" />
            <Skeleton className="mt-4 h-3 w-36" />
            <div className="mt-7 border-t border-line/70 pt-3.5">
              <Skeleton className="h-2.5 w-40" />
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="p-5 sm:p-6 xl:col-span-8">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="mt-3 h-6 w-52 rounded-lg" />
          <Skeleton className="mt-2.5 h-2.5 w-64" />
          <Skeleton className="mt-6 h-[264px] w-full rounded-2xl" />
        </Card>
        <Card className="p-5 sm:p-6 xl:col-span-4">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="mt-3 h-6 w-36 rounded-lg" />
          <div className="mt-6 space-y-5">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-2.5 w-28" />
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="p-5 sm:p-6 xl:col-span-7">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="mt-3 h-6 w-44 rounded-lg" />
          <Skeleton className="mt-6 h-[232px] w-full rounded-2xl" />
        </Card>
        <Card className="p-5 sm:p-6 xl:col-span-5">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="mt-3 h-6 w-40 rounded-lg" />
          <div className="mt-6 space-y-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex items-center justify-between gap-4">
                <Skeleton className="h-2.5 w-32" />
                <Skeleton className="h-2.5 w-16" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
