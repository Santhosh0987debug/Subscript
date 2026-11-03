import { ReceiptText } from "lucide-react";
import { PlaceholderPage } from "@/components/ui/PlaceholderPage";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export default function InvoicesPage() {
  useDocumentTitle("Invoices");

  return (
    <PlaceholderPage
      eyebrow="Invoices · Ledger"
      title="Billing, without the busywork."
      description="A clean ledger for what has been billed, what has been paid, and what needs attention next."
      emptyTitle="The invoice ledger is being prepared."
      emptyDescription="Phase 2 will bring invoice records into this shell with collection status, tax-ready totals, and a complete audit trail."
      icon={ReceiptText}
      capabilities={[
        {
          title: "Collection status",
          description: "Draft, open, paid, void, and uncollectible in one view.",
        },
        {
          title: "Tax-ready records",
          description: "Subtotals, tax, and totals stored with currency precision.",
        },
        {
          title: "Exportable history",
          description: "Give finance a clean trail without manual reconciliation.",
        },
      ]}
    />
  );
}
