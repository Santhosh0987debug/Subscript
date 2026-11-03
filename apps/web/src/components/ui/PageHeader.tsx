import type { ReactNode } from "react";

interface PageHeaderProps {
  eyebrow: string;
  title: ReactNode;
  description: string;
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-3xl">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="h-px w-7 bg-line-strong" />
          <p className="eyebrow">{eyebrow}</p>
        </div>
        <h1 className="mt-4 text-balance font-display text-[clamp(2.55rem,4.4vw,4.15rem)] font-normal leading-[0.94] tracking-[-0.04em] text-ink">
          {title}
        </h1>
        <p className="mt-5 max-w-2xl text-pretty text-[15px] leading-7 text-muted">
          {description}
        </p>
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2.5 lg:justify-end">{actions}</div>
      ) : null}
    </header>
  );
}
