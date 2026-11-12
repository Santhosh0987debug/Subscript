type MetricLabels = Record<string, string | number>;

interface HistogramState {
  counts: number[];
  sum: number;
  count: number;
}

const HTTP_DURATION_BUCKETS = [
  5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000,
] as const;

const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const histograms = new Map<string, HistogramState>();

function labelKey(labels: MetricLabels = {}): string {
  const entries = Object.entries(labels).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return entries.map(([key, value]) => `${key}="${value}"`).join(",");
}

function metricKey(name: string, labels: MetricLabels = {}): string {
  const labelsKey = labelKey(labels);
  return labelsKey ? `${name}{${labelsKey}}` : name;
}

export function incrementCounter(
  name: string,
  labels: MetricLabels = {},
  amount = 1,
): void {
  const key = metricKey(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + amount);
}

export function setGauge(
  name: string,
  value: number,
  labels: MetricLabels = {},
): void {
  gauges.set(metricKey(name, labels), value);
}

export function observeHistogram(
  name: string,
  value: number,
  labels: MetricLabels = {},
): void {
  const key = metricKey(name, labels);
  const existing = histograms.get(key) ?? {
    counts: HTTP_DURATION_BUCKETS.map(() => 0),
    sum: 0,
    count: 0,
  };

  existing.sum += value;
  existing.count += 1;

  for (let index = 0; index < HTTP_DURATION_BUCKETS.length; index += 1) {
    if (value <= HTTP_DURATION_BUCKETS[index]!) {
      existing.counts[index] = (existing.counts[index] ?? 0) + 1;
    }
  }

  histograms.set(key, existing);
}

export function recordHttpRequest(input: {
  method: string;
  route: string;
  status: number;
  durationMs: number;
}): void {
  const labels = {
    method: input.method,
    route: input.route,
    status: input.status,
  };

  incrementCounter("subscript_http_requests_total", labels);
  observeHistogram(
    "subscript_http_request_duration_ms",
    input.durationMs,
    { method: input.method, route: input.route },
  );

  if (input.status >= 500) {
    incrementCounter("subscript_http_errors_total", labels);
  }
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function renderKey(key: string): string {
  return key.replace(
    /"([^"]*)"/g,
    (_match, value: string) => `"${escapeLabelValue(value)}"`,
  );
}

export function renderMetrics(): string {
  const lines: string[] = [];

  for (const [key, value] of counters) {
    lines.push(`${renderKey(key)} ${value}`);
  }

  for (const [key, value] of gauges) {
    lines.push(`${renderKey(key)} ${value}`);
  }

  for (const [key, state] of histograms) {
    const name = key.split("{")[0] ?? key;
    const labels = key.includes("{") ? key.slice(key.indexOf("{") + 1, -1) : "";
    const labelPrefix = labels.length > 0 ? `${labels},` : "";

    for (let index = 0; index < HTTP_DURATION_BUCKETS.length; index += 1) {
      lines.push(
        `${name}_bucket{${labelPrefix}le="${HTTP_DURATION_BUCKETS[index]}"} ${state.counts[index] ?? 0}`,
      );
    }

    lines.push(`${name}_bucket{${labelPrefix}le="+Inf"} ${state.count}`);
    lines.push(`${name}_sum${labels ? `{${labels}}` : ""} ${state.sum}`);
    lines.push(`${name}_count${labels ? `{${labels}}` : ""} ${state.count}`);
  }

  lines.push(`subscript_process_uptime_seconds ${process.uptime()}`);
  lines.push(`subscript_process_resident_memory_bytes ${process.memoryUsage().rss}`);

  return `${lines.join("\n")}\n`;
}

/** Test helper; production metrics are process-lifetime counters. */
export function resetMetrics(): void {
  counters.clear();
  gauges.clear();
  histograms.clear();
}
