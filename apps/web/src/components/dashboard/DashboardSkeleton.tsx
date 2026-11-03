import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

export function DashboardSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-5" aria-busy="true">
      <span className="sr-only">Loading revenue overview</span>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Card
            key={index}
            className={
              index === 0
                ? "min-h-[214px] border-lime-deep/30 bg-lime/25 p-5 sm:p-6"
                : "min-h-[214px] p-5 sm:p-6"
            }
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-2.5 w-14" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="mt-7 h-10 w-32 rounded-xl" />
            <Skeleton className="mt-5 h-3 w-36" />
            <div className="mt-7 flex items-center justify-between border-t border-line/70 pt-3.5">
              <Skeleton className="h-2.5 w-28" />
              <Skeleton className="h-2.5 w-16" />
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="p-5 sm:p-6 xl:col-span-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="mt-3 h-6 w-52 rounded-lg" />
              <Skeleton className="mt-2.5 h-2.5 w-64" />
            </div>
            <Skeleton className="h-8 w-24 rounded-full" />
          </div>
          <div className="mt-6 flex items-end justify-between">
            <Skeleton className="h-10 w-36 rounded-xl" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="mt-5 h-[260px] w-full rounded-2xl" />
        </Card>

        <Card className="p-5 sm:p-6 xl:col-span-4">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="mt-3 h-6 w-36 rounded-lg" />
          <Skeleton className="mt-2.5 h-2.5 w-48" />
          <Skeleton className="mt-7 h-2.5 w-full rounded-full" />
          <div className="mt-6 space-y-5">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="flex items-center gap-3">
                <Skeleton className="h-2.5 w-2.5 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-2.5 w-20" />
                  <Skeleton className="h-2 w-28" />
                </div>
                <Skeleton className="h-2.5 w-14" />
              </div>
            ))}
          </div>
          <Skeleton className="mt-7 h-28 w-full rounded-2xl" />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="p-5 sm:p-6 xl:col-span-7">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="mt-3 h-6 w-44 rounded-lg" />
          <div className="mt-6 space-y-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-2.5 w-56 max-w-full" />
                  <Skeleton className="h-2 w-32" />
                </div>
                <Skeleton className="h-2.5 w-14" />
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5 sm:p-6 xl:col-span-5">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="mt-3 h-6 w-40 rounded-lg" />
          <div className="mt-6 space-y-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex items-center gap-3">
                <Skeleton className="h-10 w-11 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-2.5 w-32" />
                  <Skeleton className="h-2 w-24" />
                </div>
                <Skeleton className="h-2.5 w-14" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
