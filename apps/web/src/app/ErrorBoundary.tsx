import { Component, type ErrorInfo, type ReactNode } from "react";
import { BrandMark } from "@/components/layout/Brand";
import { Button, buttonClassName } from "@/components/ui/Button";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled application error", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-12">
        <div
          role="alert"
          className="w-full max-w-lg rounded-card border border-line bg-surface p-7 shadow-card sm:p-9"
        >
          <BrandMark />
          <p className="mt-7 font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
            Something went sideways
          </p>
          <h1 className="mt-3 text-balance font-display text-[2.6rem] leading-[0.98] tracking-[-0.04em]">
            The page hit an unexpected snag.
          </h1>
          <p className="mt-4 text-sm leading-6 text-muted">
            Reload to try again. If the problem persists, the API status and local
            logs are the best place to start.
          </p>
          <div className="mt-7 flex flex-wrap gap-2.5">
            <Button onClick={() => window.location.reload()}>Reload page</Button>
            <a
              href="/"
              className={buttonClassName({ variant: "secondary" })}
            >
              Go to overview
            </a>
          </div>
        </div>
      </div>
    );
  }
}
