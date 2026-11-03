import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Menu } from "lucide-react";
import { BrandLockup } from "@/components/layout/Brand";
import { Badge } from "@/components/ui/Badge";
import { getPageTitle } from "@/lib/navigation";

interface TopbarProps {
  onOpenMenu: () => void;
  sidebarOpen: boolean;
}

export function Topbar({ onOpenMenu, sidebarOpen }: TopbarProps) {
  const location = useLocation();
  const pageTitle = getPageTitle(location.pathname);

  return (
    <header className="sticky top-0 z-30 border-b border-line/75 bg-canvas/85 backdrop-blur-xl">
      <div className="flex h-[68px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-9 xl:px-12">
        <div className="flex min-w-0 items-center gap-3">
          <button
            id="mobile-menu-button"
            type="button"
            onClick={onOpenMenu}
            aria-label="Open navigation"
            aria-controls="app-sidebar"
            aria-expanded={sidebarOpen}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line-strong bg-surface text-ink transition-colors hover:bg-surface-raised lg:hidden"
          >
            <Menu aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
          </button>

          <div className="sm:hidden">
            <BrandLockup compact />
          </div>

          <div className="hidden min-w-0 items-center gap-2 text-[12px] sm:flex">
            <span className="text-muted">Northwind Labs</span>
            <ChevronRight
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 text-line-strong"
              strokeWidth={2}
            />
            <span className="truncate font-medium text-ink">{pageTitle}</span>
          </div>

          <span className="truncate text-sm font-semibold tracking-[-0.01em] text-ink sm:hidden">
            {pageTitle}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <Badge
            tone="outline"
            className="hidden border-line bg-surface/75 text-muted backdrop-blur-sm md:inline-flex"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-lime-deep" />
            Preview data
          </Badge>
          <span aria-hidden="true" className="hidden h-5 w-px bg-line sm:block" />
          <Link
            to="/settings"
            aria-label="AM - Open workspace settings"
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[#e9d9bf] text-[10px] font-semibold tracking-[0.03em] text-[#594831] ring-1 ring-ink/5 transition-transform hover:scale-105">
              AM
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}
