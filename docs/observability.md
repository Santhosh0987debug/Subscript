# Observability

Subscript emits structured logs, Prometheus metrics, and health/readiness
signals designed for a managed platform or a self-hosted collector.

## Health and readiness

| Endpoint | Purpose | Behavior |
| --- | --- | --- |
| `GET /api/health` | Liveness | Always `200` if the process can serve; includes service, version, timestamp, uptime |
| `GET /api/ready` | Readiness | Checks PostgreSQL (required) and Redis (optional); `200` for `ok`/`degraded`, `503` for `error` |
| `GET /api/metrics` | Prometheus scrape | `404` when `METRICS_TOKEN` is unset; otherwise requires `Authorization: Bearer <token>` |

Each check has a 3-second timeout and reports latency. A database failure returns
`status: "error"` and `503`. A Redis failure returns `status: "degraded"` and
`200`; route traffic but alert. Health responses never include connection
strings, credentials, or internal error messages.

Both endpoints set `Cache-Control: no-store`. They are registered before the
global API limiter so they remain reachable during load shedding.

### Platform configuration

- Render: `healthCheckPath: /api/ready`
- Kubernetes: liveness `/api/health`, readiness `/api/ready`
- Load balancers: use `/api/health` for instance liveness; use `/api/ready` for
  traffic routing
- Keep the load-balancer idle timeout above the API keep-alive timeout
  (default 5 seconds)

## Logs

The API and worker write one JSON object per line:

```json
{"level":"info","message":"HTTP request","timestamp":"2026-11-12T09:37:14.692Z","requestId":"f1960c25-...","method":"GET","path":"/api/customers","route":"/api/customers","status":200,"durationMs":12.4,"userId":null,"organizationId":null}
```

Fields:

- `level` — `info`, `warn`, or `error`
- `message` — stable, human-readable summary
- `timestamp` — ISO 8601 UTC
- `requestId` — UUID, echoed in `X-Request-Id`
- `correlationId` — caller-supplied trace identifier, echoed in
  `X-Correlation-Id`
- `method`, `path`, `route`, `status`, `durationMs` — request completion
- `userId`, `organizationId` — optional context for authenticated requests
- Job logs add job ID, type, queue, attempt, and outcome

Rules:

- Bodies and query strings are never logged.
- Operational endpoints are excluded from access logs but still counted in
  metrics.
- Emails, bearer tokens, Razorpay keys, and long tokens are redacted.
- Sensitive object keys are replaced with `[redacted]`.
- Stacks are included only outside production.
- Webhook payloads, notification bodies, session tokens, passwords, and SMTP
  credentials are never logged.

Set `LOG_REQUESTS=false` to silence access logs while keeping startup, error, and
job logs.

### Shipping

Forward stdout/stderr to your platform's log service. Do not write application
logs to local files inside containers. Retain at least 30 days for incident
review; longer if required by policy.

Recommended fields for alerts and searches: `level`, `requestId`, `route`,
`status`, `durationMs`, `organizationId`, `jobId`, `queue`.

## Metrics

`/api/metrics` renders Prometheus text format. Metrics are process-lifetime and
reset on restart.

### Request metrics

| Metric | Type | Labels |
| --- | --- | --- |
| `subscript_http_requests_total` | counter | `method`, `route`, `status` |
| `subscript_http_request_duration_ms` | histogram | `method`, `route` |
| `subscript_http_errors_total` | counter | `method`, `route`, `status` (5xx only) |

Latency buckets: 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000 ms,
plus `+Inf`.

Route labels use route templates (for example `/api/customers/:customerId`) so
cardinality stays bounded. Unknown paths replace UUID segments with `:id`.

### Dependency and process metrics

| Metric | Type | Labels |
| --- | --- | --- |
| `subscript_dependency_up` | gauge | `dependency` (`database`, `redis`) |
| `subscript_process_uptime_seconds` | gauge | — |
| `subscript_process_resident_memory_bytes` | gauge | — |

The dependency gauges are updated by readiness checks. Scrape readiness
regularly enough to keep them fresh.

### Scrape configuration

```yaml
scrape_configs:
  - job_name: subscript-api
    scheme: https
    metrics_path: /api/metrics
    authorization:
      credentials_file: /etc/prometheus/subscript-metrics-token
    static_configs:
      - targets: ["api.example.com"]
```

Use a dedicated long random `METRICS_TOKEN` (16–200 characters). Rotate it like
any other secret. Do not expose `/api/metrics` without a token or network
restriction.

## Suggested alerts

| Alert | Condition | Notes |
| --- | --- | --- |
| API down | `/api/health` fails for 2 minutes | Page |
| Database unavailable | `/api/ready` returns 503 for 2 minutes | Page |
| Redis degraded | `subscript_dependency_up{dependency="redis"} == 0` for 10 minutes | Ticket; automation unavailable |
| 5xx rate | `subscript_http_errors_total` grows > 2% of requests for 5 minutes | Page |
| Latency | p95 `subscript_http_request_duration_ms` > 1s for 10 minutes | Investigate |
| Worker heartbeat stale | No heartbeat for 2 minutes | Page if automation is expected |
| Queue backlog | Pending jobs grow for 15 minutes | Investigate worker/Redis |
| Dead letters | Any new `DEAD_LETTER` job or notification | Ticket; retry after fix |
| Payment webhook failures | `gateway_webhook_events.status = FAILED` grows | Investigate signatures/provider |
| Disk/connections | PostgreSQL connections > 80% of limit | Scale pool/database |

Tune thresholds to traffic. Avoid alerts on single 429s; rate limiting is
expected under abuse.

## Dashboards

A minimal API dashboard:

- Requests per second by route and status
- 5xx rate and latency p50/p95/p99
- Readiness status by dependency
- Process RSS and uptime (restart detection)
- PostgreSQL pool saturation (provider metrics)
- Redis availability and memory (provider metrics)
- Worker heartbeats and queue depth (Operations page or provider metrics)

## Request tracing

Every response includes:

- `X-Request-Id` — server-generated or validated caller UUID
- `X-Correlation-Id` — caller trace ID when supplied and safe

Pass `X-Correlation-Id` from an edge gateway or frontend to correlate browser
actions with API logs. The API does not propagate trace headers to Razorpay;
provider requests are correlated by internal payment/order IDs in logs.

## Runbook quick reference

### Elevated 5xx

1. Check `/api/health` and `/api/ready`.
2. Search logs for `level:error` and the affected `route`.
3. Check PostgreSQL connections, statement timeouts, and recent deploys.
4. Check Redis if errors involve checkout/automation.
5. Roll back if the error started with a deploy and readiness is degraded.

### Readiness degraded (Redis)

1. Confirm the API is still serving.
2. Check the Redis provider status and `REDIS_URL`.
3. Restart the worker after Redis recovers.
4. Confirm the worker heartbeat and a sweep in the logs.
5. No durable jobs are lost; pending rows are re-dispatched.

### Readiness error (database)

1. Treat as an outage for writes and authenticated reads.
2. Check the database provider, connection limit, and network.
3. Do not restart repeatedly if connections are exhausted; reduce replicas or
   pool size.
4. Restore from backup only if data is corrupted, not for a connectivity blip.

### Worker not processing

See [workers.md](./workers.md#common-incidents).

## Privacy

Metrics use route templates and dependency names, not customer identifiers.
Logs may include internal user/organization IDs but never emails, tokens,
passwords, card data, or raw provider payloads. Keep log retention and access
aligned with your privacy policy.
