# Razorpay

Subscript supports two payment paths that share one ledger:

- **Manual** — cash, bank transfer, card, check, or other offline collection.
- **Gateway** — Razorpay Checkout for open invoices, with signed webhook
  reconciliation and full or partial refunds.

With no Razorpay credentials, the gateway is disabled and manual recording still
works. Configure Test Mode keys to exercise checkout locally.

## Configuration

All three values are required together:

```dotenv
RAZORPAY_KEY_ID="rzp_test_..."
RAZORPAY_KEY_SECRET="..."
RAZORPAY_WEBHOOK_SECRET="..."
```

Rules enforced at startup:

- `RAZORPAY_KEY_ID` must start with `rzp_test_` or `rzp_live_`.
- Live keys are rejected unless `NODE_ENV=production`.
- Secrets must be 8–200 characters and are never logged or returned.
- Partial configuration fails fast.

## Test Mode setup

1. Create a Razorpay account and switch the dashboard to **Test Mode**.
2. Generate a Test Key ID and Key Secret under **Account & Settings → API Keys**.
3. Choose a webhook secret and create a webhook under **Account & Settings →
   Webhooks**:
   - URL: `https://<public-api-host>/api/webhooks/razorpay`
   - Events: `payment.captured`, `payment.failed`, `order.paid`,
     `refund.created`, `refund.processed`, `refund.failed`
4. Put the three values in `apps/server/.env` and restart the API and worker.
5. For local webhook delivery, expose the API with a tunnel such as ngrok; the
   provider must reach an HTTPS URL.

No real charge occurs in Test Mode.

## Checkout flow

1. An owner or admin opens an `OPEN` invoice with a positive balance and calls
   `POST /api/invoices/:invoiceId/checkout`.
2. The server derives the amount and currency from the invoice, locks the
   invoice row, and reserves a `PENDING` gateway payment before calling
   Razorpay. This prevents two simultaneous checkout orders for one invoice.
3. The browser opens Razorpay Checkout with the returned order ID and
   publishable key.
4. On success, the browser calls
   `POST /api/payments/:paymentId/gateway/verify` with the order ID, Razorpay
   payment ID, and signature.
5. The server verifies the HMAC-SHA256 checkout signature with the key secret,
   fetches the provider payment, and checks the order, amount, currency, and
   captured status before changing any balance.
6. If the customer closes the modal, the browser calls
   `POST /api/payments/:paymentId/gateway/cancel`, which fails the reservation
   and frees the invoice. A later signed webhook can still settle the payment if
   the provider captured it despite the closed modal.

A frontend success callback alone never marks an invoice paid.

## Webhooks

`POST /api/webhooks/razorpay` is mounted before the global JSON parser so the
raw body is available for signature verification.

- The `X-Razorpay-Signature` header is verified over the exact raw body with
  `RAZORPAY_WEBHOOK_SECRET`, using a timing-safe comparison.
- `X-Razorpay-Event-Id` is required and persisted with a unique
  `(provider, providerEventId)` constraint.
- A completed duplicate returns `200 {"status":"duplicate"}` without
  reapplying the change. A concurrent duplicate returns `409` so Razorpay
  retries later.
- Unsupported events return `200 {"status":"ignored"}`.
- Malformed payloads, bad signatures, and missing event IDs return `400`.
- Failed processing is recorded and can be retried.

Events are matched by internal IDs in notes, provider order ID, and provider
payment/refund ID, so out-of-order deliveries are safe:

- Capture is terminal; a late `payment.failed` for a captured payment is
  ignored.
- A failed attempt can be recovered by a later capture under the same order,
  including a different provider payment ID.
- A processed refund is terminal; a later failure event is ignored. A failure
  before processing releases the reservation.

## Refunds

`POST /api/payments/:paymentId/gateway/refund` supports full and partial
refunds.

1. The requested amount is reserved as a `PENDING` refund ledger entry.
2. Pending reservations count against the refundable balance, preventing
   over-refunds and duplicate concurrent requests.
3. The provider is called.
4. A `processed` response settles immediately. A `pending` response remains
   `PENDING` until a signed webhook settles it.
5. An explicit provider rejection (4xx) marks the reservation `FAILED` and
   releases the balance.
6. An uncertain outcome (network error, timeout, or 5xx) leaves the reservation
   `PENDING` to avoid issuing a duplicate refund. Refresh the invoice and wait
   for the provider webhook before retrying.

Provider-originated refunds created in the Razorpay dashboard are also
reconciled into the ledger.

## Failure handling

- Checkout order creation failures release the reservation.
- Invalid or mismatched signatures, amounts, currencies, or payment states are
  rejected without a balance change.
- Duplicate checkout clicks and repeated verification calls are idempotent.
- Gateway endpoints and webhooks have dedicated rate limits.
- All gateway actions are organization-scoped; cross-tenant IDs resolve as not
  found.

## Go-live checklist

1. Complete Razorpay account/KYC requirements.
2. Switch to live keys and set `NODE_ENV=production`.
3. Create the live webhook with a new strong secret and subscribe to the six
   events listed above.
4. Set `CORS_ORIGINS` to the production HTTPS web origin.
5. Serve the API over HTTPS so the `Secure` / `__Host-` cookie is accepted.
6. Confirm `/api/gateway/config` reports the expected mode without exposing
   secrets.
7. Run a small live transaction and verify:
   - checkout creates a `PENDING` gateway payment
   - verification marks it `SUCCEEDED`
   - the invoice balance reaches zero
   - the webhook is stored and deduplicated
8. Test a partial refund and confirm the payment/invoice totals.
9. Configure alerts for webhook failures, gateway errors, and dead-letter
   notifications.

## Security notes

- Amounts and currencies always come from the invoice, never from the browser.
- Key secrets and webhook secrets stay server-side.
- Logs and API responses never include secrets, signatures, raw provider
  payloads, or full webhook bodies.
- The webhook route must receive the unmodified raw body. Do not put a proxy or
  body-rewriting middleware in front of it.
