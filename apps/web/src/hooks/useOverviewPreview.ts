import { useEffect, useState } from "react";
import { overviewData, type OverviewData } from "@/data/overview";

export type OverviewState =
  | { status: "loading" }
  | { status: "ready"; data: OverviewData };

/**
 * Phase 1 uses static preview data, but models the asynchronous shape the API
 * will have so the loading treatment is real rather than an afterthought.
 */
export function useOverviewPreview(): OverviewState {
  const [state, setState] = useState<OverviewState>({ status: "loading" });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setState({ status: "ready", data: overviewData });
    }, 520);

    return () => window.clearTimeout(timer);
  }, []);

  return state;
}
