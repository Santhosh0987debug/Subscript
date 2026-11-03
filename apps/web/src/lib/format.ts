export type NumericFormat = "currency" | "compactCurrency" | "number" | "percent";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

export function formatCompactCurrency(value: number): string {
  return compactCurrencyFormatter.format(value);
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatPercent(value: number): string {
  return `${percentFormatter.format(value)}%`;
}

export function formatMetricValue(value: number, format: NumericFormat): string {
  switch (format) {
    case "currency":
      return formatCurrency(value);
    case "compactCurrency":
      return formatCompactCurrency(value);
    case "number":
      return formatNumber(value);
    case "percent":
      return formatPercent(value);
  }
}

export function formatChange(value: number, suffix: "%" | " pts"): string {
  const prefix = value > 0 ? "+" : value < 0 ? "\u2212" : "";
  const magnitude = Math.abs(value);

  if (suffix === " pts") {
    return `${prefix}${percentFormatter.format(magnitude)} pts`;
  }

  return `${prefix}${percentFormatter.format(magnitude)}%`;
}

export function formatSignedCurrency(value: number): string {
  const prefix = value > 0 ? "+" : value < 0 ? "\u2212" : "";
  return `${prefix}${formatCurrency(Math.abs(value))}`;
}

export function formatChartCurrency(value: number): string {
  if (value === 0) {
    return "$0";
  }

  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}m`;
  }

  if (value >= 1_000) {
    const thousands = value / 1_000;
    const rounded = Number.isInteger(thousands) ? thousands.toString() : thousands.toFixed(0);
    return `$${rounded}k`;
  }

  return `$${Math.round(value)}`;
}
