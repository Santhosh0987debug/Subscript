import { ArrowLeft, ArrowUpRight, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { buttonClassName } from "@/components/ui/Button";

interface PlannedCapability {
  title: string;
  description: string;
}

interface PlaceholderPageProps {
  eyebrow: string;
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  icon: LucideIcon;
  capabilities: readonly PlannedCapability[];
}

export function PlaceholderPage({
  eyebrow,
  title,
  description,
  emptyTitle,
  emptyDescription,
  icon: Icon,
  capabilities,
}: PlaceholderPageProps) {
  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          <Link to="/" className={buttonClassName({ variant: "secondary" })}>
            <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.9} />
            Back to overview
          </Link>
        }
      />

      <div className="relative mt-9 overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(217,251,98,0.25),transparent_48%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full border border-line/80"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-6 -top-10 h-40 w-40 rounded-full border border-line/80"
        />

        <div className="relative flex flex-col items-center px-6 py-14 text-center sm:px-10 sm:py-16">
          <Badge tone="lime">
            <span aria-hidden="true" className="h-1 w-1 rounded-full bg-ink/50" />
            Phase 2 preview
          </Badge>

          <span className="mt-7 grid h-16 w-16 rotate-[-3deg] place-items-center rounded-2xl bg-lime text-ink shadow-[0_18px_34px_-22px_rgba(23,23,18,0.5)]">
            <Icon aria-hidden="true" className="h-6 w-6" strokeWidth={1.7} />
          </span>

          <h2 className="mt-6 max-w-xl text-balance font-display text-[clamp(2rem,3.5vw,2.8rem)] leading-[1.02] tracking-[-0.035em] text-ink">
            {emptyTitle}
          </h2>
          <p className="mt-4 max-w-lg text-pretty text-sm leading-6 text-muted">
            {emptyDescription}
          </p>

          <Link
            to="/"
            className={buttonClassName({
              variant: "primary",
              className: "mt-7",
            })}
          >
            Explore the overview
            <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
          </Link>
        </div>

        <div className="relative grid border-t border-line md:grid-cols-3">
          {capabilities.map((capability, index) => (
            <div
              key={capability.title}
              className="border-b border-line px-6 py-6 last:border-b-0 md:border-b-0 md:border-r md:px-7 md:last:border-r-0"
            >
              <p className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-muted/70">
                0{index + 1}
              </p>
              <h3 className="mt-3 text-[13px] font-semibold tracking-[-0.01em] text-ink">
                {capability.title}
              </h3>
              <p className="mt-1.5 text-[11.5px] leading-5 text-muted">
                {capability.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
