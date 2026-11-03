interface RevenueCsvRow {
  month: string;
  current: number;
  previous: number;
}

function escapeCsvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function toRevenueCsv(rows: readonly RevenueCsvRow[]): string {
  const header = ["Month", "This year MRR (USD)", "Previous year MRR (USD)"];
  const lines = rows.map((row) =>
    [
      escapeCsvCell(row.month),
      row.current.toFixed(2),
      row.previous.toFixed(2),
    ].join(","),
  );

  return [header.join(","), ...lines].join("\r\n");
}

export function downloadTextFile(
  filename: string,
  content: string,
  mimeType = "text/csv;charset=utf-8",
): void {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
