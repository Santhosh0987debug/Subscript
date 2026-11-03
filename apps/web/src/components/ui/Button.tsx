import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md";

const baseClassName =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-[background-color,color,border-color,transform,box-shadow] duration-200 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas active:translate-y-px";

const variantClassNames: Record<ButtonVariant, string> = {
  primary:
    "border border-ink bg-ink text-surface shadow-[0_10px_24px_-16px_rgba(23,23,18,0.8)] hover:bg-ink-soft",
  secondary:
    "border border-line-strong bg-surface text-ink hover:border-ink/35 hover:bg-surface-raised",
  ghost: "border border-transparent text-ink hover:bg-ink/[0.055]",
};

const sizeClassNames: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-[13px]",
  md: "h-11 px-5 text-sm",
};

export interface ButtonClassNameOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string | undefined;
}

export function buttonClassName({
  variant = "primary",
  size = "md",
  className,
}: ButtonClassNameOptions = {}): string {
  return cn(baseClassName, variantClassNames[variant], sizeClassNames[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName({ variant, size, className })}
      {...props}
    />
  );
}
