import { cn } from "@/lib/cn";
import { useApiHealth } from "@/hooks/useApiHealth";

interface ApiStatusProps {
  className?: string;
}

export function ApiStatus({ className }: ApiStatusProps) {
  const health = useApiHealth();

  const label =
    health.status === "online"
      ? "API connected"
      : health.status === "offline"
        ? "API offline"
        : "Checking API";

  const dotClassName =
    health.status === "online"
      ? "bg-lime"
      : health.status === "offline"
        ? "bg-coral"
        : "bg-sidebar-muted";

  const title =
    health.status === "offline"
      ? "The frontend is running without the API. Start it with npm run dev at the repo root."
      : health.status === "online"
        ? `Local API v${health.version} is responding.`
        : "Checking the local API health endpoint.";

  return (
    <div
      className={cn(
        "flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em] text-sidebar-muted",
        className,
      )}
      title={title}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          dotClassName,
          health.status === "checking" && "animate-pulse",
        )}
      />
      <span>{label}</span>
      {health.status === "online" ? (
        <span className="ml-auto text-sidebar-muted/60">v{health.version}</span>
      ) : null}
    </div>
  );
}
