import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

export function PageFallback() {
  return (
    <div role="status" aria-live="polite" className="space-y-7">
      <span className="sr-only">Loading page</span>
      <div className="space-y-4">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-14 w-full max-w-xl rounded-2xl" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index} className="p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-6 h-10 w-32 rounded-xl" />
            <Skeleton className="mt-5 h-3 w-40" />
          </Card>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="p-6 xl:col-span-8">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="mt-6 h-[260px] w-full rounded-2xl" />
        </Card>
        <Card className="p-6 xl:col-span-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-6 h-3 w-full" />
          <Skeleton className="mt-3 h-3 w-5/6" />
          <Skeleton className="mt-8 h-36 w-full rounded-2xl" />
        </Card>
      </div>
    </div>
  );
}
