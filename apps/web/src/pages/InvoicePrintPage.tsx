import { useEffect, useState } from "react";
import { ArrowLeft, Printer, RefreshCw } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import type { InvoiceResponse } from "@subscript/shared";
import { useAuth } from "@/auth/AuthProvider";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { ApiClientError, getInvoice } from "@/lib/api";
import {
  formatBillingDate,
  formatBillingPeriod,
  formatTaxRateBps,
  invoiceStatusLabels,
  invoiceStatusTones,
  paymentMethodLabels,
  paymentStatusLabels,
} from "@/lib/billing";
import { getErrorMessage, isUnauthorizedError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";

type PrintState =
  | { status: "loading" }
  | { status: "ready"; data: InvoiceResponse }
  | { status: "notfound" }
  | { status: "error"; message: string };

export default function InvoicePrintPage() {
  const { invoiceId = "" } = useParams();
  const { activeOrganization, refresh } = useAuth();
  const [state, setState] = useState<PrintState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const organizationId = activeOrganization?.id;
  const invoice = state.status === "ready" ? state.data.invoice : null;

  useDocumentTitle(invoice ? `${invoice.number} · Print` : "Invoice print");

  useEffect(() => {
    if (!organizationId || !invoiceId) {
      setState({ status: "notfound" });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading" });

    getInvoice(invoiceId, controller.signal)
      .then((data) => {
        setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (isUnauthorizedError(error)) {
          void refresh();
        }

        if (error instanceof ApiClientError && error.status === 404) {
          setState({ status: "notfound" });
          return;
        }

        setState({
          status: "error",
          message: getErrorMessage(error, "This invoice could not be loaded."),
        });
      });

    return () => {
      controller.abort();
    };
  }, [organizationId, invoiceId, reloadKey, refresh]);

  if (state.status === "loading") {
    return (
      <div className="mx-auto max-w-[860px] px-4 py-10">
        <Skeleton className="h-9 w-40" />
        <Card className="mt-6 p-8">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="mt-4 h-4 w-72" />
          <Skeleton className="mt-10 h-40 w-full" />
        </Card>
      </div>
    );
  }

  if (state.status === "notfound") {
    return (
      <div className="mx-auto max-w-[860px] px-4 py-10">
        <EmptyState
          icon={Printer}
          title="Invoice not found."
          description="Return to the ledger and choose an invoice that belongs to this workspace."
          action={
            <Link to="/invoices" className={buttonClassName({ size: "sm" })}>
              Back to invoices
            </Link>
          }
        />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="mx-auto max-w-[860px] px-4 py-10">
        <Alert tone="error">
          <p className="font-semibold">Invoice could not load.</p>
          <p className="mt-1 text-coral/85">{state.message}</p>
        </Alert>
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => setReloadKey((current) => current + 1)}
        >
          <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
          Try again
        </Button>
      </div>
    );
  }

  const record = state.data.invoice;
  const addressLines = [
    record.customer.billingAddress.line1,
    record.customer.billingAddress.line2,
    [record.customer.billingAddress.city, record.customer.billingAddress.region]
      .filter(Boolean)
      .join(", "),
    [record.customer.billingAddress.postalCode, record.customer.billingAddress.country]
      .filter(Boolean)
      .join(" "),
  ].filter((line) => line.trim().length > 0);

  return (
    <div className="invoice-print-page min-h-dvh bg-canvas px-4 py-6 sm:px-6 sm:py-10 print:bg-white print:p-0">
      <div className="print-hidden mx-auto mb-5 flex max-w-[860px] flex-wrap items-center justify-between gap-3">
        <Link
          to={`/invoices/${record.id}`}
          className="inline-flex items-center gap-2 text-[12px] font-semibold text-muted transition-colors hover:text-ink"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
          Back to invoice
        </Link>
        <Button size="sm" onClick={() => window.print()}>
          <Printer aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
          Print / save PDF
        </Button>
      </div>

      <article className="invoice-sheet mx-auto max-w-[860px] rounded-card border border-line bg-surface p-7 shadow-card sm:p-11 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-line pb-7">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted">
              {activeOrganization?.name ?? "Subscript workspace"}
            </p>
            <h1 className="mt-4 font-display text-[clamp(2.2rem,5vw,3.4rem)] leading-[0.92] tracking-[-0.04em] text-ink">
              Invoice
            </h1>
            <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-soft">
              {record.number}
            </p>
          </div>
          <div className="text-right">
            <Badge tone={invoiceStatusTones[record.status]}>
              {invoiceStatusLabels[record.status]}
            </Badge>
            <dl className="mt-4 space-y-1.5 text-[10.5px]">
              <div className="flex justify-end gap-6">
                <dt className="text-muted">Issued</dt>
                <dd className="min-w-24 text-right text-ink-soft">
                  {formatBillingDate(record.issuedAt)}
                </dd>
              </div>
              <div className="flex justify-end gap-6">
                <dt className="text-muted">Due</dt>
                <dd className="min-w-24 text-right text-ink-soft">
                  {formatBillingDate(record.dueAt)}
                </dd>
              </div>
              <div className="flex justify-end gap-6">
                <dt className="text-muted">Period</dt>
                <dd className="min-w-24 text-right text-ink-soft">
                  {formatBillingPeriod(record.periodStart, record.periodEnd)}
                </dd>
              </div>
            </dl>
          </div>
        </header>

        <section className="grid gap-8 border-b border-line py-7 sm:grid-cols-2">
          <div>
            <p className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-muted">
              Bill to
            </p>
            <div className="mt-3 space-y-1 text-[11.5px] leading-5">
              <p className="font-semibold text-ink">{record.customer.name}</p>
              {record.customer.company ? (
                <p className="text-muted">{record.customer.company}</p>
              ) : null}
              <p className="text-muted">{record.customer.email}</p>
              {addressLines.length > 0 ? (
                <address className="not-italic text-muted">
                  {addressLines.map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                </address>
              ) : null}
            </div>
          </div>

          <div className="sm:text-right">
            <p className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-muted">
              Amount due
            </p>
            <p className="mt-3 font-display text-[clamp(2rem,4vw,2.8rem)] leading-none tracking-[-0.04em] text-ink">
              {formatMoney(
                record.amountDue.amountMinor,
                record.amountDue.currency,
              )}
            </p>
            <p className="mt-2 text-[10.5px] text-muted">
              {record.amountDue.currency} · {formatTaxRateBps(record.taxRateBps)}{" "}
              tax
            </p>
          </div>
        </section>

        <section className="py-7">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="pb-2 font-mono text-[8px] uppercase tracking-[0.13em] text-muted">
                  Description
                </th>
                <th className="pb-2 text-right font-mono text-[8px] uppercase tracking-[0.13em] text-muted">
                  Qty
                </th>
                <th className="pb-2 text-right font-mono text-[8px] uppercase tracking-[0.13em] text-muted">
                  Unit
                </th>
                <th className="pb-2 text-right font-mono text-[8px] uppercase tracking-[0.13em] text-muted">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {record.lineItems.map((item) => (
                <tr key={item.id}>
                  <td className="py-3 pr-3 text-[11.5px] text-ink">
                    {item.description}
                  </td>
                  <td className="py-3 pl-3 text-right text-[11px] text-muted">
                    {item.quantity}
                  </td>
                  <td className="py-3 pl-3 text-right text-[11px] text-muted">
                    {formatMoney(item.unitAmountMinor, record.total.currency)}
                  </td>
                  <td className="py-3 pl-3 text-right text-[11.5px] font-semibold text-ink">
                    {formatMoney(item.totalMinor, record.total.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="ml-auto max-w-xs space-y-2 border-t border-line pt-5 text-[11.5px]">
          <div className="flex items-center justify-between gap-6">
            <span className="text-muted">Subtotal</span>
            <span className="text-ink-soft">
              {formatMoney(record.subtotal.amountMinor, record.subtotal.currency)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-6">
            <span className="text-muted">
              Tax at {formatTaxRateBps(record.taxRateBps)}
            </span>
            <span className="text-ink-soft">
              {formatMoney(record.tax.amountMinor, record.tax.currency)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-6 border-t border-line pt-2 text-[13px]">
            <span className="font-semibold text-ink">Total</span>
            <span className="font-semibold text-ink">
              {formatMoney(record.total.amountMinor, record.total.currency)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-6">
            <span className="text-muted">Paid</span>
            <span className="text-ink-soft">
              {formatMoney(
                record.amountPaid.amountMinor,
                record.amountPaid.currency,
              )}
            </span>
          </div>
          <div className="flex items-center justify-between gap-6 border-t border-line pt-2 text-[13px]">
            <span className="font-semibold text-ink">Amount due</span>
            <span className="font-semibold text-ink">
              {formatMoney(
                record.amountDue.amountMinor,
                record.amountDue.currency,
              )}
            </span>
          </div>
        </section>

        {record.payments.length > 0 ? (
          <section className="mt-9 border-t border-line pt-6">
            <p className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-muted">
              Payments recorded
            </p>
            <table className="mt-3 w-full border-collapse">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="pb-2 font-mono text-[7.5px] uppercase tracking-[0.12em] text-muted">
                    Date
                  </th>
                  <th className="pb-2 font-mono text-[7.5px] uppercase tracking-[0.12em] text-muted">
                    Method
                  </th>
                  <th className="pb-2 font-mono text-[7.5px] uppercase tracking-[0.12em] text-muted">
                    Reference
                  </th>
                  <th className="pb-2 font-mono text-[7.5px] uppercase tracking-[0.12em] text-muted">
                    Status
                  </th>
                  <th className="pb-2 text-right font-mono text-[7.5px] uppercase tracking-[0.12em] text-muted">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {record.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="py-2 pr-3 text-[10.5px] text-muted">
                      {formatBillingDate(
                        payment.paidAt ??
                          payment.failedAt ??
                          payment.refundedAt ??
                          payment.createdAt,
                      )}
                    </td>
                    <td className="py-2 pr-3 text-[10.5px] text-muted">
                      {paymentMethodLabels[payment.method]}
                    </td>
                    <td className="py-2 pr-3 text-[10.5px] text-muted">
                      {payment.reference ?? "—"}
                    </td>
                    <td className="py-2 pr-3 text-[10.5px] text-muted">
                      {paymentStatusLabels[payment.status]}
                    </td>
                    <td className="py-2 text-right text-[10.5px] font-semibold text-ink">
                      {formatMoney(
                        payment.amount.amountMinor,
                        payment.amount.currency,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <footer className="mt-9 border-t border-line pt-5 text-[9.5px] leading-4 text-muted">
          <p>
            Internal billing record. Payments are recorded manually in Subscript;
            no payment gateway confirmation is implied.
          </p>
          <p className="mt-1">
            {activeOrganization?.name ?? "Subscript workspace"} ·{" "}
            {record.number}
          </p>
        </footer>
      </article>
    </div>
  );
}
