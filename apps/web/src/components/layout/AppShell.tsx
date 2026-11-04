import { Suspense, useCallback, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { PageFallback } from "@/components/layout/PageFallback";

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const closeSidebar = useCallback((restoreFocus = false) => {
    setSidebarOpen(false);

    if (restoreFocus) {
      window.requestAnimationFrame(() => {
        document.getElementById("mobile-menu-button")?.focus();
      });
    }
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    if (!sidebarOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeSidebar(true);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [sidebarOpen, closeSidebar]);

  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <Sidebar open={sidebarOpen} onClose={() => closeSidebar(true)} />

      {sidebarOpen ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close navigation"
          onClick={() => closeSidebar(true)}
          className="fixed inset-0 z-40 bg-ink/50 backdrop-blur-[2px] lg:hidden"
        />
      ) : null}

      <div className="flex min-h-dvh flex-col lg:pl-[17rem]">
        <Topbar
          onOpenMenu={() => setSidebarOpen(true)}
          sidebarOpen={sidebarOpen}
        />

        <main
          id="main-content"
          className="mx-auto w-full max-w-[1480px] flex-1 px-4 pb-10 pt-7 sm:px-6 lg:px-9 lg:pt-9 xl:px-12"
        >
          <div key={location.pathname} className="page-enter">
            <Suspense fallback={<PageFallback />}>
              <Outlet />
            </Suspense>
          </div>
        </main>

        <footer className="mx-auto flex w-full max-w-[1480px] flex-col gap-1.5 px-4 pb-6 pt-2 font-mono text-[8.5px] uppercase tracking-[0.14em] text-muted/70 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-9 xl:px-12">
          <p>Subscript · Phase 2 workspace</p>
          <p>Illustrative revenue data · Authenticated session</p>
        </footer>
      </div>
    </>
  );
}
