import { useId } from "react";
import { ChevronDown, CircleAlert } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  name?: string;
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  name,
  error,
  hint,
  required = false,
  disabled = false,
  className,
}: SelectFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="block text-[12px] font-semibold tracking-[-0.005em] text-ink"
      >
        {label}
      </label>

      <div className="relative mt-2">
        <select
          id={id}
          name={name}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "h-12 w-full appearance-none rounded-xl border bg-surface px-3.5 pr-10 text-[14px] text-ink shadow-[inset_0_1px_0_rgba(23,23,18,0.02)] outline-none transition-[border-color,box-shadow,background-color] duration-200 disabled:cursor-not-allowed disabled:bg-canvas-deep/50 disabled:text-muted",
            error
              ? "border-coral/65 focus:border-coral focus:ring-2 focus:ring-coral/20"
              : "border-line-strong focus:border-ink focus:ring-2 focus:ring-lime/65",
          )}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          strokeWidth={1.8}
        />
      </div>

      {error ? (
        <p
          id={errorId}
          className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-5 text-coral"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 h-3 w-3 shrink-0"
            strokeWidth={2}
          />
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-[11px] leading-5 text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
