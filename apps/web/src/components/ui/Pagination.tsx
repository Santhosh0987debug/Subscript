import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  itemLabel,
  onPageChange,
}: PaginationProps) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = total === 0 ? 0 : Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col gap-3 border-t border-line px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <p className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted">
        Showing {start}-{end} of {total} {itemLabel}
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1 || totalPages === 0}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
          Prev
        </Button>
        <span className="min-w-16 text-center font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
          {totalPages === 0 ? "0 / 0" : `${page} / ${totalPages}`}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= totalPages || totalPages === 0}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          Next
          <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
        </Button>
      </div>
    </div>
  );
}
