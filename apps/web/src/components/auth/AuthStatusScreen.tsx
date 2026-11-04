import { RefreshCw, WifiOff } from "lucide-react";
import { BrandLockup } from "@/components/layout/Brand";
import { Button } from "@/components/ui/Button";

interface AuthStatusScreenProps {
  mode: "loading" | "error";
  message?: string | null | undefined;
  onRetry?: (() => void) | undefined;
}

export function AuthStatusScreen({ mode, message, onRetry }: AuthStatusScreenProps) {
  if (mode === "loading") {
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas px-5 py-12">
        <div
          role="status"
          aria-live="polite"
          className="flex w-full max-w-sm flex-col items-center text-center"
        >
          <BrandLockup />
          <span
            aria-hidden="true"
            className="mt-10 h-10 w-10 animate-spin rounded-full border-2 border-line-strong border-t-ink"
          />
          <p className="mt-6 font-mono text-[9px] uppercase tracking-[0.2em] text-muted">
            Restoring your workspace
          </p>
          <span className="sr-only">Loading your authenticated session.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-5 py-12">
      <div
        role="alert"
        className="relative w-full max-w-md overflow-hidden rounded-card border border-line bg-surface p-7 shadow-card sm:p-9"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_-12%,rgba(221,92,61,0.16),transparent_48%)]"
        />
        <div className="relative">
          <BrandLockup />
          <span className="mt-9 grid h-12 w-12 place-items-center rounded-2xl bg-coral-soft text-coral">
            <WifiOff aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <h1 className="mt-5 font-display text-3xl leading-[1.02] tracking-[-0.035em] text-ink">
            We can&apos;t reach the Subscript API.
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            {message ??
              "Your session could not be restored. Confirm the API is running, then try again."}
          </p>
          <p className="mt-4 rounded-xl border border-line bg-surface-raised px-3.5 py-3 font-mono text-[10px] leading-5 text-muted">
            Start the full stack with{" "}
            <span className="text-ink">npm run dev</span> at the repository root.
          </p>
          {onRetry ? (
            <Button onClick={onRetry} className="mt-6 w-full">
              <RefreshCw aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
              Try again
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
