import type { ReactNode } from "react";
import { CheckCircle2, CircleAlert, Info } from "lucide-react";
import { cn } from "@/lib/cn";

export type AlertTone = "error" | "success" | "info";

const toneClassNames: Record<AlertTone, string> = {
  error: "border-coral/20 bg-coral-soft text-coral",
  success: "border-moss/15 bg-moss/[0.07] text-moss",
  info: "border-line-strong bg-surface-raised/70 text-ink-soft",
};

const icons = {
  error: CircleAlert,
  success: CheckCircle2,
  info: Info,
} as const;

interface AlertProps {
  tone?: AlertTone;
  children: ReactNode;
  className?: string;
}

export function Alert({ tone = "info", children, className }: AlertProps) {
  const Icon = icons[tone];

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-3.5 py-3",
        toneClassNames[tone],
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0"
        strokeWidth={2}
      />
      <div className="min-w-0 text-[11.5px] leading-5">{children}</div>
    </div>
  );
}
