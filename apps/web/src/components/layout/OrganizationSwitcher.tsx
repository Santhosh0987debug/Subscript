import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, LoaderCircle } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { getErrorMessage } from "@/lib/errors";
import { getInitials, getOrganizationRoleLabel } from "@/lib/identity";

export function OrganizationSwitcher() {
  const { organizations, activeOrganization, switchOrganization } = useAuth();
  const [open, setOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!activeOrganization) {
    return (
      <div className="rounded-2xl border border-sidebar-line bg-sidebar-raised/80 p-3">
        <p className="text-[12.5px] font-semibold text-sidebar-text">No workspace</p>
        <p className="mt-1 text-[10.5px] leading-4 text-sidebar-muted">
          Ask an owner to add you to an organization.
        </p>
      </div>
    );
  }

  async function handleSelect(organizationId: string): Promise<void> {
    if (organizationId === activeOrganization?.id) {
      setOpen(false);
      return;
    }

    setSwitchingId(organizationId);
    setError(null);

    try {
      await switchOrganization(organizationId);
      setOpen(false);
    } catch (switchError) {
      setError(getErrorMessage(switchError, "Could not switch workspace."));
      setOpen(false);
    } finally {
      setSwitchingId(null);
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((current) => !current);
          setError(null);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Active workspace: ${activeOrganization.name}. Switch workspace.`}
        className="flex w-full items-center gap-2.5 rounded-2xl border border-sidebar-line bg-sidebar-raised/80 p-3 text-left transition-colors hover:border-sidebar-text/25 hover:bg-sidebar-raised focus-visible:outline-lime"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-lime/20 bg-lime/10 font-mono text-[10px] font-medium tracking-[0.06em] text-lime">
          {getInitials(activeOrganization.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold tracking-[-0.01em] text-sidebar-text">
            {activeOrganization.name}
          </span>
          <span className="mt-0.5 block truncate font-mono text-[8.5px] uppercase tracking-[0.14em] text-sidebar-muted">
            {getOrganizationRoleLabel(activeOrganization.role)} · {organizations.length}{" "}
            {organizations.length === 1 ? "workspace" : "workspaces"}
          </span>
        </span>
        <ChevronsUpDown
          aria-hidden="true"
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-sidebar-muted transition-transform duration-200",
            open ? "rotate-180 text-sidebar-text" : undefined,
          )}
          strokeWidth={1.8}
        />
      </button>

      {error ? (
        <p role="alert" className="mt-2 px-1 text-[10.5px] leading-4 text-[#f0a58f]">
          {error}
        </p>
      ) : null}

      {open ? (
        <div
          role="menu"
          aria-label="Switch workspace"
          className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-40 overflow-hidden rounded-2xl border border-sidebar-line bg-sidebar-raised p-1.5 shadow-[0_24px_50px_-24px_rgba(0,0,0,0.75)]"
        >
          <p className="px-2.5 pb-1.5 pt-1 font-mono text-[8px] uppercase tracking-[0.2em] text-sidebar-muted/70">
            Switch workspace
          </p>
          <div className="sidebar-scroll max-h-64 space-y-0.5 overflow-y-auto">
            {organizations.map((organization) => {
              const isActive = organization.id === activeOrganization.id;
              const isSwitching = switchingId === organization.id;

              return (
                <button
                  key={organization.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  disabled={switchingId !== null}
                  onClick={() => {
                    void handleSelect(organization.id);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors disabled:opacity-60",
                    isActive
                      ? "bg-lime text-ink"
                      : "text-sidebar-muted hover:bg-white/[0.055] hover:text-sidebar-text",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-7 w-7 shrink-0 place-items-center rounded-lg font-mono text-[9px] font-medium tracking-[0.04em]",
                      isActive
                        ? "bg-ink/10 text-ink"
                        : "border border-sidebar-line bg-sidebar text-sidebar-muted",
                    )}
                  >
                    {getInitials(organization.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold">
                      {organization.name}
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 block font-mono text-[8px] uppercase tracking-[0.14em]",
                        isActive ? "text-ink/60" : "text-sidebar-muted/70",
                      )}
                    >
                      {getOrganizationRoleLabel(organization.role)}
                    </span>
                  </span>
                  {isSwitching ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="h-3.5 w-3.5 animate-spin"
                      strokeWidth={2}
                    />
                  ) : isActive ? (
                    <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.2} />
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className="border-t border-sidebar-line/80 px-2.5 pb-1 pt-2 font-mono text-[8px] uppercase tracking-[0.14em] text-sidebar-muted/60">
            Tenant-scoped access
          </p>
        </div>
      ) : null}
    </div>
  );
}
