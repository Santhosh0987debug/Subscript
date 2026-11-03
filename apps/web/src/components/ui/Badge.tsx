import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "lime" | "dark" | "coral" | "outline";

const toneClassNames: Record<BadgeTone, string> = {
  neutral: "border-transparent bg-ink/[0.06] text-ink-soft",
  lime: "border-lime-deep/50 bg-lime text-ink",
  dark: "border-transparent bg-ink text-surface",
  coral: "border-coral/15 bg-coral-soft text-coral",
  outline: "border-line-strong bg-transparent text-ink-soft",
};

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}

export function Badge({ children, tone = "neutral", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9px] font-medium uppercase leading-none tracking-[0.14em]",
        toneClassNames[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
