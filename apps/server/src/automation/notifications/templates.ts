import type { NotificationType } from "@subscript/shared";
import type {
  NotificationTemplateData,
  RenderedNotification,
} from "./types.js";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(date: Date | null | undefined): string {
  return date ? dateFormatter.format(date) : "the scheduled date";
}

function formatMoney(
  amountMinor: number | null | undefined,
  currency: string | null | undefined,
): string {
  const amount = amountMinor ?? 0;
  const code = currency ?? "USD";

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).format(amount / 100);
  } catch {
    return `${code} ${(amount / 100).toFixed(2)}`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function paragraphs(lines: readonly string[]): string {
  return lines.join("\n\n");
}

function renderHtml(heading: string, lines: readonly string[], footer: string): string {
  const body = lines
    .map((line) => `<p style="margin:0 0 12px">${escapeHtml(line)}</p>`)
    .join("");

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(heading)}</title>`,
    "</head>",
    '<body style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5">',
    `<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(heading)}</h1>`,
    body,
    `<p style="margin:24px 0 0;color:#6b7280;font-size:12px">${escapeHtml(footer)}</p>`,
    "</body>",
    "</html>",
  ].join("");
}

export function renderNotification(
  type: NotificationType,
  data: NotificationTemplateData,
): RenderedNotification {
  const greeting = `Hi ${data.customerName},`;
  const footer = `Sent by ${data.organizationName}. This is an automated billing notification.`;
  const plan = data.planName ?? "your subscription";
  const invoice = data.invoiceNumber ? `invoice ${data.invoiceNumber}` : "your invoice";
  const amount = formatMoney(data.amountMinor, data.currency);

  switch (type) {
    case "RENEWAL_UPCOMING": {
      const heading = `Upcoming renewal for ${plan}`;
      const lines = [
        greeting,
        `Your ${plan} subscription is scheduled to renew on ${formatDate(data.effectiveDate)} for ${amount}.`,
        data.periodStart && data.periodEnd
          ? `The next billing period runs from ${formatDate(data.periodStart)} to ${formatDate(data.periodEnd)}.`
          : "The next invoice will be generated automatically when the period ends.",
        "No action is needed if you want to continue. Contact support if you need to make changes.",
      ];
      return {
        subject: `Upcoming renewal: ${plan} on ${formatDate(data.effectiveDate)}`,
        text: paragraphs(lines),
        html: renderHtml(heading, lines, footer),
      };
    }

    case "TRIAL_ENDING": {
      const heading = `Your ${plan} trial ends soon`;
      const lines = [
        greeting,
        `Your trial for ${plan} ends on ${formatDate(data.effectiveDate)}.`,
        `After the trial, the subscription will continue for ${amount} per billing period.`,
        "Contact support before the trial ends if you do not want to continue.",
      ];
      return {
        subject: `Your ${plan} trial ends on ${formatDate(data.effectiveDate)}`,
        text: paragraphs(lines),
        html: renderHtml(heading, lines, footer),
      };
    }

    case "INVOICE_GENERATED": {
      const heading = `Invoice ${data.invoiceNumber ?? ""} is ready`;
      const lines = [
        greeting,
        `${data.organizationName} generated ${invoice} for ${amount}.`,
        data.periodStart && data.periodEnd
          ? `Billing period: ${formatDate(data.periodStart)} to ${formatDate(data.periodEnd)}.`
          : "The invoice is available in your billing portal.",
        "You can review and pay the invoice from the billing portal.",
      ];
      return {
        subject: `Invoice ${data.invoiceNumber ?? ""} for ${plan}`,
        text: paragraphs(lines),
        html: renderHtml(heading.trim(), lines, footer),
      };
    }

    case "PAYMENT_SUCCEEDED": {
      const heading = "Payment received";
      const lines = [
        greeting,
        `We received ${amount} for ${invoice}.`,
        "Your account balance has been updated. Thank you.",
      ];
      return {
        subject: `Payment received for ${data.invoiceNumber ?? "your invoice"}`,
        text: paragraphs(lines),
        html: renderHtml(heading, lines, footer),
      };
    }

    case "PAYMENT_FAILED": {
      const heading = "Payment attempt failed";
      const attempt =
        data.retryAttempt && data.maxAttempts
          ? `Recovery attempt ${data.retryAttempt} of ${data.maxAttempts}.`
          : "Our billing team will review the account.";
      const lines = [
        greeting,
        `A payment attempt for ${invoice} (${amount}) did not succeed.`,
        attempt,
        "No charge will be retried automatically from this email. Update your payment details or pay the invoice from the billing portal.",
      ];
      return {
        subject: `Payment failed for ${data.invoiceNumber ?? "your invoice"}`,
        text: paragraphs(lines),
        html: renderHtml(heading, lines, footer),
      };
    }

    case "SUBSCRIPTION_CANCELED": {
      const heading = `Your ${plan} subscription has ended`;
      const lines = [
        greeting,
        `Your ${plan} subscription ended on ${formatDate(data.effectiveDate)}.`,
        data.reason ? `Reason: ${data.reason}.` : "No further renewals will be scheduled.",
        "Thank you for being a customer.",
      ];
      return {
        subject: `Your ${plan} subscription has ended`,
        text: paragraphs(lines),
        html: renderHtml(heading, lines, footer),
      };
    }

    case "REFUND_UPDATED": {
      const status = data.statusLabel ?? "updated";
      const heading = `Refund ${status}`;
      const lines = [
        greeting,
        `A refund of ${amount} for ${invoice} is now ${status}.`,
        data.reason ? `Reason: ${data.reason}.` : "The refund has been recorded in the billing portal.",
        "Depending on your bank, it may take several business days to appear.",
      ];
      return {
        subject: `Refund ${status} for ${data.invoiceNumber ?? "your invoice"}`,
        text: paragraphs(lines),
        html: renderHtml(heading, lines, footer),
      };
    }
  }
}
