import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";

interface BrandMarkProps {
  className?: string | undefined;
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-lime text-ink shadow-[0_8px_20px_-12px_rgba(217,251,98,0.9)]",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="h-[21px] w-[21px]" fill="none">
        <path
          d="M16.9 7.5c-1.1-1.4-2.8-2.2-4.8-2.2-2.9 0-5 1.6-5 4.1 0 5.4 9.5 3.3 9.5 8 0 2.3-2 3.8-4.9 3.8-2.1 0-3.9-.8-5.1-2.2"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <circle cx="17.8" cy="17.6" r="1.4" fill="currentColor" />
      </svg>
    </span>
  );
}

interface BrandLockupProps {
  light?: boolean;
  compact?: boolean;
  className?: string;
}

export function BrandLockup({ light = false, compact = false, className }: BrandLockupProps) {
  return (
    <Link
      to="/"
      aria-label="Subscript overview"
      className={cn("group flex items-center gap-2.5", className)}
    >
      <BrandMark className={compact ? "h-8 w-8 rounded-[10px]" : undefined} />
      <span className="flex flex-col">
        <span
          className={cn(
            "flex items-baseline font-semibold leading-none tracking-[-0.045em]",
            compact ? "text-[17px]" : "text-[21px]",
            light ? "text-sidebar-text" : "text-ink",
          )}
        >
          subscript
          <span className="text-lime-deep">.</span>
        </span>
        {!compact ? (
          <span
            className={cn(
              "mt-1.5 font-mono text-[8px] uppercase tracking-[0.24em]",
              light ? "text-sidebar-muted" : "text-muted",
            )}
          >
            Revenue OS
          </span>
        ) : null}
      </span>
    </Link>
  );
}
