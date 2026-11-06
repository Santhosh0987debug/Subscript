import type { GatewayCheckoutSession } from "@subscript/shared";

const CHECKOUT_SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js";

export interface RazorpayCheckoutSuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayCheckoutFailure {
  error?: {
    description?: string;
    reason?: string;
  };
}

interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: {
    name: string;
    email: string;
  };
  notes: Record<string, string>;
  theme: {
    color: string;
  };
  handler: (response: RazorpayCheckoutSuccess) => void;
  modal?: {
    ondismiss?: () => void;
  };
}

interface RazorpayCheckoutInstance {
  open(): void;
  on(event: "payment.failed", handler: (response: RazorpayCheckoutFailure) => void): void;
}

type RazorpayCheckoutConstructor = new (
  options: RazorpayCheckoutOptions,
) => RazorpayCheckoutInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayCheckoutConstructor;
  }
}

let loader: Promise<RazorpayCheckoutConstructor> | null = null;

export function loadRazorpayCheckout(): Promise<RazorpayCheckoutConstructor> {
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error("Checkout can only be opened in a browser."),
    );
  }

  if (window.Razorpay) {
    return Promise.resolve(window.Razorpay);
  }

  if (loader) {
    return loader;
  }

  loader = new Promise<RazorpayCheckoutConstructor>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${CHECKOUT_SCRIPT_URL}"]`,
    );
    const script = existing ?? document.createElement("script");

    function handleLoad(): void {
      if (window.Razorpay) {
        resolve(window.Razorpay);
        return;
      }

      loader = null;
      reject(new Error("The payment checkout did not initialise. Try again."));
    }

    function handleError(): void {
      loader = null;
      reject(
        new Error(
          "The payment checkout could not be loaded. Check your connection and try again.",
        ),
      );
    }

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });

    if (!existing) {
      script.src = CHECKOUT_SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return loader;
}

export interface RazorpayCheckoutHandlers {
  onSuccess: (response: RazorpayCheckoutSuccess) => void;
  onDismiss?: () => void;
  onFailure?: (message: string) => void;
}

export async function openRazorpayCheckout(
  session: GatewayCheckoutSession,
  handlers: RazorpayCheckoutHandlers,
): Promise<void> {
  const Razorpay = await loadRazorpayCheckout();
  const checkout = new Razorpay({
    key: session.keyId,
    amount: session.amount.amountMinor,
    currency: session.amount.currency,
    name: "Subscript",
    description: session.description,
    order_id: session.orderId,
    prefill: {
      name: session.customerName,
      email: session.customerEmail,
    },
    notes: {
      invoiceNumber: session.invoiceNumber,
    },
    theme: {
      color: "#d9fb62",
    },
    handler: handlers.onSuccess,
    ...(handlers.onDismiss
      ? { modal: { ondismiss: handlers.onDismiss } }
      : {}),
  });

  checkout.on("payment.failed", (response) => {
    handlers.onFailure?.(
      response.error?.description ??
        response.error?.reason ??
        "The payment attempt failed. The invoice balance was not changed.",
    );
  });
  checkout.open();
}
