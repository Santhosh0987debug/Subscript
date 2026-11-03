import { useEffect, useRef } from "react";
import { Link, NavLink } from "react-router-dom";
import { Settings2, X } from "lucide-react";
import { BrandLockup } from "@/components/layout/Brand";
import { ApiStatus } from "@/components/layout/ApiStatus";
import { cn } from "@/lib/cn";
import {
  primaryNavigation,
  secondaryNavigation,
  type NavigationItem,
} from "@/lib/navigation";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

function NavigationLink({ item, onNavigate }: { item: NavigationItem; onNavigate?: () => void }) {
  const Icon = item.icon;

  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium leading-none transition-colors duration-200",
          isActive
            ? "bg-lime text-ink shadow-[0_10px_24px_-18px_rgba(217,251,98,0.9)]"
            : "text-sidebar-muted hover:bg-white/[0.055] hover:text-sidebar-text",
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            aria-hidden="true"
            className={cn(
              "h-[17px] w-[17px] shrink-0 transition-opacity",
              isActive ? "opacity-100" : "opacity-70 group-hover:opacity-100",
            )}
            strokeWidth={1.8}
          />
          <span>{item.label}</span>
          {isActive ? (
            <span
              aria-hidden="true"
              className="ml-auto h-1 w-1 rounded-full bg-ink/55"
            />
          ) : null}
        </>
      )}
    </NavLink>
  );
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      closeButtonRef.current?.focus();
    }
  }, [open]);

  return (
    <aside
      id="app-sidebar"
      aria-label="Main navigation"
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-[17rem] flex-col overflow-hidden bg-sidebar text-sidebar-text transition-transform duration-300 ease-out",
        open
          ? "visible translate-x-0"
          : "invisible -translate-x-full lg:visible lg:translate-x-0",
      )}
    >
      <div
        aria-hidden="true"
        className="sidebar-texture pointer-events-none absolute inset-0 opacity-50"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-28 -top-32 h-[23rem] w-[23rem] rounded-full bg-lime/[0.06] blur-3xl"
      />

      <div className="relative flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between px-5 pb-5 pt-6">
          <BrandLockup light />
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="grid h-8 w-8 place-items-center rounded-full border border-sidebar-line text-sidebar-muted transition-colors hover:border-sidebar-text/25 hover:text-sidebar-text focus-visible:outline-lime lg:hidden"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <div className="px-3">
          <div className="rounded-2xl border border-sidebar-line bg-sidebar-raised/80 p-3">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-lime/20 bg-lime/10 font-mono text-[10px] font-medium tracking-[0.06em] text-lime">
                NW
              </span>
              <div className="min-w-0">
                <p className="truncate text-[12.5px] font-semibold tracking-[-0.01em] text-sidebar-text">
                  Northwind Labs
                </p>
                <p className="mt-0.5 truncate font-mono text-[8.5px] uppercase tracking-[0.14em] text-sidebar-muted">
                  Demo workspace
                </p>
              </div>
              <span
                aria-hidden="true"
                className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-lime"
              />
            </div>
          </div>
        </div>

        <nav className="sidebar-scroll relative mt-7 min-h-0 flex-1 overflow-y-auto px-3 pb-5">
          <p className="px-3 font-mono text-[8.5px] uppercase tracking-[0.22em] text-sidebar-muted/60">
            Workspace
          </p>
          <ul className="mt-2.5 space-y-1">
            {primaryNavigation.map((item) => (
              <li key={item.to}>
                <NavigationLink item={item} onNavigate={onClose} />
              </li>
            ))}
          </ul>

          <p className="mt-8 px-3 font-mono text-[8.5px] uppercase tracking-[0.22em] text-sidebar-muted/60">
            Configure
          </p>
          <ul className="mt-2.5 space-y-1">
            {secondaryNavigation.map((item) => (
              <li key={item.to}>
                <NavigationLink item={item} onNavigate={onClose} />
              </li>
            ))}
          </ul>
        </nav>

        <div className="relative px-6 pb-4">
          <ApiStatus />
        </div>

        <div className="relative border-t border-sidebar-line p-3">
          <Link
            to="/settings"
            onClick={onClose}
            className="group flex items-center gap-3 rounded-2xl px-2.5 py-2.5 transition-colors hover:bg-white/[0.055]"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#e9d9bf] text-[10px] font-semibold tracking-[0.03em] text-[#594831]">
              AM
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[12px] font-semibold text-sidebar-text">
                Alex Morgan
              </span>
              <span className="mt-0.5 block truncate font-mono text-[8.5px] uppercase tracking-[0.13em] text-sidebar-muted">
                Workspace owner
              </span>
            </span>
            <Settings2
              aria-hidden="true"
              className="ml-auto h-3.5 w-3.5 text-sidebar-muted/60 transition-colors group-hover:text-sidebar-text"
              strokeWidth={1.7}
            />
          </Link>
        </div>
      </div>
    </aside>
  );
}
