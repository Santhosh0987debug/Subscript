import { useId } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/cn";

interface TextAreaFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  name?: string;
  placeholder?: string;
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean;
  disabled?: boolean;
  rows?: number;
  maxLength?: number;
  className?: string;
}

export function TextAreaField({
  label,
  value,
  onChange,
  name,
  placeholder,
  error,
  hint,
  required = false,
  disabled = false,
  rows = 4,
  maxLength,
  className,
}: TextAreaFieldProps) {
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

      <textarea
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        rows={rows}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "mt-2 w-full resize-y rounded-xl border bg-surface px-3.5 py-3 text-[14px] leading-6 text-ink shadow-[inset_0_1px_0_rgba(23,23,18,0.02)] outline-none transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-muted/55 disabled:cursor-not-allowed disabled:bg-canvas-deep/50 disabled:text-muted",
          error
            ? "border-coral/65 focus:border-coral focus:ring-2 focus:ring-coral/20"
            : "border-line-strong focus:border-ink focus:ring-2 focus:ring-lime/65",
        )}
      />

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
