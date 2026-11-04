import { useId, useState } from "react";
import { CircleAlert, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/cn";

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  name?: string;
  type?: "text" | "email" | "password" | "tel";
  inputMode?: "text" | "decimal" | "numeric" | "tel";
  autoComplete?: string;
  placeholder?: string;
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
}

export function TextField({
  label,
  value,
  onChange,
  name,
  type = "text",
  inputMode,
  autoComplete,
  placeholder,
  error,
  hint,
  required = false,
  minLength,
  maxLength,
  autoFocus,
  disabled = false,
  className,
}: TextFieldProps) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const isPassword = type === "password";
  const inputType = isPassword && revealed ? "text" : type;

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="block text-[12px] font-semibold tracking-[-0.005em] text-ink"
      >
        {label}
      </label>

      <div className="relative mt-2">
        <input
          id={id}
          name={name}
          type={inputType}
          inputMode={inputMode}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
          autoFocus={autoFocus}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "h-12 w-full rounded-xl border bg-surface px-3.5 text-[14px] text-ink shadow-[inset_0_1px_0_rgba(23,23,18,0.02)] outline-none transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-muted/55 disabled:cursor-not-allowed disabled:bg-canvas-deep/50 disabled:text-muted",
            isPassword ? "pr-11" : undefined,
            error
              ? "border-coral/65 focus:border-coral focus:ring-2 focus:ring-coral/20"
              : "border-line-strong focus:border-ink focus:ring-2 focus:ring-lime/65",
          )}
        />

        {isPassword ? (
          <button
            type="button"
            onClick={() => setRevealed((current) => !current)}
            aria-label={revealed ? "Hide password" : "Show password"}
            className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-muted transition-colors hover:bg-ink/[0.055] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            tabIndex={-1}
          >
            {revealed ? (
              <EyeOff aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
            ) : (
              <Eye aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
            )}
          </button>
        ) : null}
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
