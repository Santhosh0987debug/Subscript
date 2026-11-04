import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BrandLockup } from "@/components/layout/Brand";
import { Badge } from "@/components/ui/Badge";

interface AuthLayoutProps {
  eyebrow: string;
  title: ReactNode;
  description: string;
  children: ReactNode;
  footer: ReactNode;
  headerAction?: ReactNode;
}

const assurances = [
  {
    title: "HttpOnly sessions",
    description: "Tokens stay in secure cookies, never browser storage.",
  },
  {
    title: "Role-aware access",
    description: "Owner, admin, and member permissions are enforced by the API.",
  },
  {
    title: "Tenant-isolated",
    description: "Every request is checked against your active organization.",
  },
] as const;

export function AuthLayout({
  eyebrow,
  title,
  description,
  children,
  footer,
  headerAction,
}: AuthLayoutProps) {
  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_520px_at_88%_-8%,rgba(217,251,98,0.22),transparent_60%)]"
      />

      <div className="relative grid min-h-dvh lg:grid-cols-[1.04fr_0.96fr]">
        <aside className="relative hidden overflow-hidden bg-sidebar p-10 text-sidebar-text lg:flex lg:flex-col xl:p-14">
          <div
            aria-hidden="true"
            className="sidebar-texture pointer-events-none absolute inset-0 opacity-50"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-32 -top-40 h-[30rem] w-[30rem] rounded-full bg-lime/[0.07] blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-52 -right-32 h-[34rem] w-[34rem] rounded-full border border-sidebar-line/80"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-28 right-6 h-[20rem] w-[20rem] rounded-full border border-sidebar-line/70"
          />

          <div className="relative">
            <BrandLockup light />
          </div>

          <div className="relative mt-auto max-w-2xl pb-8 pt-16">
            <Badge className="border-lime/25 bg-lime/10 text-lime">
              <span aria-hidden="true" className="h-1 w-1 rounded-full bg-lime" />
              Secure workspace access
            </Badge>

            <h2 className="mt-7 text-balance font-display text-[clamp(3.1rem,4.7vw,4.9rem)] font-normal leading-[0.92] tracking-[-0.045em] text-sidebar-text">
              Every renewal,
              <br />
              in{" "}
              <span className="relative isolate inline-block italic">
                focus
                <span
                  aria-hidden="true"
                  className="absolute bottom-2 left-0 -z-10 h-[0.18em] w-full rounded-full bg-lime/80"
                />
              </span>
              .
            </h2>

            <p className="mt-6 max-w-md text-pretty text-[14px] leading-7 text-sidebar-muted">
              Sign in to the revenue workspace your team shares - one calm place for
              subscriptions, customers, and the numbers behind them.
            </p>

            <dl className="mt-10 grid gap-5 sm:grid-cols-3">
              {assurances.map((assurance) => (
                <div key={assurance.title} className="border-t border-sidebar-line pt-4">
                  <dt className="text-[11.5px] font-semibold text-sidebar-text">
                    {assurance.title}
                  </dt>
                  <dd className="mt-1.5 text-[10.5px] leading-5 text-sidebar-muted">
                    {assurance.description}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative mt-10 flex items-center justify-between border-t border-sidebar-line pt-5 font-mono text-[8.5px] uppercase tracking-[0.2em] text-sidebar-muted/80">
            <span>Subscript · Revenue OS</span>
            <span>Phase 2</span>
          </div>
        </aside>

        <main className="flex min-h-dvh flex-col px-5 py-6 sm:px-8 lg:px-12 lg:py-9 xl:px-16">
          <div className="flex items-center justify-between gap-4 lg:justify-end">
            <div className="lg:hidden">
              <BrandLockup compact />
            </div>
            {headerAction}
          </div>

          <div className="my-auto w-full max-w-[28rem] py-10 lg:mx-auto">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="h-px w-7 bg-line-strong" />
              <p className="eyebrow">{eyebrow}</p>
            </div>

            <h1 className="mt-4 text-balance font-display text-[clamp(2.65rem,5vw,3.65rem)] font-normal leading-[0.95] tracking-[-0.042em] text-ink">
              {title}
            </h1>
            <p className="mt-4 text-pretty text-[14px] leading-7 text-muted">
              {description}
            </p>

            <div className="mt-8">{children}</div>

            <div className="mt-7 border-t border-line pt-5 text-[13px] leading-6 text-muted">
              {footer}
            </div>
          </div>

          <p className="text-center font-mono text-[8.5px] uppercase tracking-[0.16em] text-muted/60">
            Cookie-based session · No tokens in browser storage
          </p>
        </main>
      </div>
    </div>
  );
}

export function AuthFooterLink({
  prompt,
  to,
  label,
}: {
  prompt: string;
  to: string;
  label: string;
}) {
  return (
    <p>
      {prompt}{" "}
      <Link
        to={to}
        className="font-semibold text-ink underline decoration-line-strong decoration-2 underline-offset-4 transition-colors hover:decoration-lime-deep"
      >
        {label}
      </Link>
    </p>
  );
}
