# Revenue analytics

Subscript analytics are organization-scoped, computed on request from the same
subscriptions, plans, customers, invoices, payments, and refunds that power the
rest of the product. Nothing is cached and every response sends
`Cache-Control: no-store`.

## Money and percentages

- Amounts are integer **minor units** (`2900` = `$29.00` for USD) and always
  carry an explicit currency.
- Currencies are never summed together. Every response groups amounts by
  currency. The dashboard adds a currency switch instead of converting.
- Ratios and churn values are **basis points** (`1% = 100 bps`).
- A ratio is `null` when its denominator is zero or negative. The UI renders
  `null` as an em dash rather than `0%`.

## Reporting windows and timezones

- `from` and `to` are inclusive calendar dates in the requested IANA timezone.
- `fromIso` is local midnight at the start of `from`; `toIso` is local midnight
  *after* `to`, so `to` is an exclusive instant boundary.
- Buckets are clipped to the selected range. Day buckets split at local
  midnight; week buckets start on Monday; month buckets start on the first of
  the month. A range may produce at most 400 buckets and span at most five
  years.
- PostgreSQL sessions are pinned to UTC so `timestamptz` values round-trip
  without being shifted by the database server's local timezone.
- Defaults: trailing 12 whole months, `month` grouping, `UTC`.

## Subscription activity

A subscription has two distinct timelines:

- **Access** starts at `startedAt` and ends at `endedAt` or `canceledAt`
  (whichever comes first). This drives subscription counts, customer counts,
  churn, and retention.
- **Revenue** starts at max(`startedAt`, `trialEndsAt`) and ends at the earliest
  of `endedAt`, `canceledAt`, or `pausedAt` (when paused). This drives MRR, ARR,
  new MRR, churned MRR, and expansion MRR. Trials therefore never contribute
  recurring revenue.

A subscription that starts exactly on `from` is active at the start of the
range and is also new in the range. A cancellation takes effect at its recorded
end instant, not at the following bucket.

## Recurring revenue

- Monthly MRR: `unitAmountMinor * quantity`.
- Annual MRR: `round(unitAmountMinor * quantity / 12)`.
- ARR: `MRR * 12`.
- Snapshot MRR uses subscriptions that are revenue-active at the bucket end
  (clipped to the range end).
- New MRR counts subscriptions whose **revenue start** falls inside the bucket.
- Churned MRR counts subscriptions that were revenue-active at the bucket or
  period start and whose access ended inside the bucket/period.
- Expansion MRR counts a new subscription for a customer that already had a
  different revenue-active subscription at the period start. It is a
  conservative proxy: plan upgrades on the same subscription are not modelled
  as expansion because subscriptions store a price snapshot.
- Net new MRR: `new MRR - churned MRR`.

## Churn and retention

- Customer churn: customers access-active at the period start whose last
  access-active subscription ended inside the period, divided by customers
  active at the start.
- Subscription churn: subscriptions access-active at the start that ended in
  the period, divided by subscriptions active at the start.
- Subscription retention: `(starting - churned) / starting`.
- Revenue churn: `churned MRR / starting MRR`.
- Gross revenue retention: `(starting MRR - churned MRR) / starting MRR`.
- Net revenue retention: `(starting MRR - churned MRR + expansion MRR) /
  starting MRR`.
- `canceledInRange` on the overview is intentionally broader: it counts every
  cancellation or expiry inside the range, including subscriptions that started
  and ended inside the same window. Churn rates use start-of-period
  denominators and are therefore usually smaller.
- New vs. returning customers are based on whether the customer's first
  subscription ever started inside the range.

## Cash, invoices, and outstanding balances

- **Invoiced** recognizes `totalMinor` for invoices issued in the range,
  excluding drafts and voids.
- **Cash collected** counts successful payments received in the range, including
  payments against older invoices. Refunds reduce net cash when they are
  processed; manual refunds use `refundedAt`, gateway refunds use the succeeded
  `PaymentRefund.processedAt`.
- **Outstanding** for the overview and customer/plan rows is the current open
  balance `max(totalMinor - amountPaidMinor, 0)` across all open invoices.
  Invoice and revenue endpoints scope open balances to invoices issued in the
  selected range/bucket. Historical balances are not reconstructed because
  invoices do not store a balance history.
- **Overdue** is the open balance of invoices whose due date is before now;
  **uncollectible** is the balance of invoices marked uncollectible.
- Collection rate: `collected / invoiced` for the selected range/currency, or
  `null` when nothing was invoiced.
- Aging buckets: current (not due), 1-30, 31-60, 61-90, and 90+ days overdue.

## Customers and plans

- ARPC: net cash collected in the range divided by active customers in the
  selected currency.
- Average subscription value: snapshot MRR divided by active subscriptions.
- Customer lifetime value: all-time net cash for customers who ever paid,
  divided by the number of paying customers.
- Plan rows group by the subscription's price snapshot (`planId`, `planName`,
  `planCode`, interval, currency). Historical snapshots remain visible even if
  the stored plan changes later.

## CSV exports

Revenue and subscription reports accept the same `from`, `to`, `timezone`, and
`grouping` filters as the JSON endpoints. They are tenant-scoped, use
currency-specific fraction digits, quote text fields, and prefix spreadsheet
formula prefixes (including ones hidden behind leading whitespace) with an
apostrophe.
