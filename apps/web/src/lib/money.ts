const FALLBACK_CURRENCIES = [
  "AUD",
  "BRL",
  "CAD",
  "CHF",
  "CNY",
  "DKK",
  "EUR",
  "GBP",
  "HKD",
  "INR",
  "JPY",
  "KRW",
  "MXN",
  "NOK",
  "NZD",
  "SEK",
  "SGD",
  "USD",
  "ZAR",
] as const;

const intlWithSupportedValues = Intl as typeof Intl & {
  supportedValuesOf?: (key: string) => string[];
};

function currencyFormatter(
  currency: string,
  fractionDigits?: number,
): Intl.NumberFormat | null {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      ...(fractionDigits !== undefined
        ? {
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits,
          }
        : {}),
    });
  } catch {
    return null;
  }
}

export function getCurrencyFractionDigits(currency: string): number {
  const formatter = currencyFormatter(currency);
  return formatter?.resolvedOptions().maximumFractionDigits ?? 2;
}

export function formatMoney(amountMinor: number, currency: string): string {
  const digits = getCurrencyFractionDigits(currency);
  const formatter = currencyFormatter(currency, digits);

  if (!formatter) {
    return `${currency} ${(amountMinor / 10 ** digits).toFixed(digits)}`;
  }

  return formatter.format(amountMinor / 10 ** digits);
}

export function formatMajorAmount(
  amountMinor: number,
  currency: string,
): string {
  const digits = getCurrencyFractionDigits(currency);
  const factor = 10 ** digits;
  const whole = Math.trunc(amountMinor / factor);
  const fraction = Math.abs(amountMinor % factor);

  if (digits === 0) {
    return String(whole);
  }

  return `${whole}.${String(fraction).padStart(digits, "0")}`;
}

export function parseMajorAmount(
  value: string,
  currency: string,
): number | null {
  const normalized = value.trim().replace(/,/g, "");

  if (normalized.length === 0) {
    return null;
  }

  const digits = getCurrencyFractionDigits(currency);
  const pattern =
    digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{0,${digits}})?$`);

  if (!pattern.test(normalized)) {
    return null;
  }

  const [whole = "0", fraction = ""] = normalized.split(".");
  const paddedFraction = fraction.padEnd(digits, "0");
  const amount = Number.parseInt(whole, 10) * 10 ** digits +
    Number.parseInt(paddedFraction || "0", 10);

  return Number.isSafeInteger(amount) ? amount : null;
}

export function isSupportedCurrency(currency: string): boolean {
  return currencyFormatter(currency) !== null;
}

export function getCurrencyOptions(): Array<{ value: string; label: string }> {
  const supported = intlWithSupportedValues.supportedValuesOf?.("currency");
  const codes = supported && supported.length > 0
    ? [...supported].sort()
    : [...FALLBACK_CURRENCIES];
  let displayNames: Intl.DisplayNames | null = null;

  try {
    displayNames = new Intl.DisplayNames(["en"], { type: "currency" });
  } catch {
    displayNames = null;
  }

  return codes.map((code) => {
    const name = displayNames?.of(code);

    return {
      value: code,
      label: name && name !== code ? `${code} - ${name}` : code,
    };
  });
}

export function getDefaultCurrency(): string {
  return "USD";
}
