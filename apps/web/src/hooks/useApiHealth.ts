import { useEffect, useState } from "react";
import { getApiHealth } from "@/lib/api";

export type ApiHealthState =
  | { status: "checking" }
  | { status: "online"; version: string }
  | { status: "offline" };

export function useApiHealth(): ApiHealthState {
  const [state, setState] = useState<ApiHealthState>({ status: "checking" });

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3_000);
    let active = true;

    getApiHealth(controller.signal)
      .then((health) => {
        if (active) {
          setState({ status: "online", version: health.version });
        }
      })
      .catch(() => {
        if (active) {
          setState({ status: "offline" });
        }
      })
      .finally(() => {
        window.clearTimeout(timeout);
      });

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  return state;
}
