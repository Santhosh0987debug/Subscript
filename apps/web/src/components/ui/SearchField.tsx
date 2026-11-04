import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
}

export function SearchField({
  value,
  onChange,
  label,
  placeholder = "Search",
  className,
}: SearchFieldProps) {
  return (
    <div className={cn("relative", className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
        strokeWidth={2}
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        placeholder={placeholder}
        className="h-10 w-full rounded-full border border-line-strong bg-surface pl-9 pr-9 text-[12px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-muted/60 focus:border-ink focus:ring-2 focus:ring-lime/65"
      />
      {value.length > 0 ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted transition-colors hover:bg-ink/[0.055] hover:text-ink"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}
