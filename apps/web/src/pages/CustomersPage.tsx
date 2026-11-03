import { Users } from "lucide-react";
import { PlaceholderPage } from "@/components/ui/PlaceholderPage";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export default function CustomersPage() {
  useDocumentTitle("Customers");

  return (
    <PlaceholderPage
      eyebrow="Customers · Directory"
      title="Every account, one clear record."
      description="A single home for the people and businesses behind your revenue - their plans, history, and health."
      emptyTitle="Customer records are next."
      emptyDescription="The navigation and layout are ready. Phase 2 will connect this surface to tenant-scoped customer records, with no shared-data shortcuts."
      icon={Users}
      capabilities={[
        {
          title: "Unified profiles",
          description: "Contact details, plan context, and account notes in one place.",
        },
        {
          title: "Segments that matter",
          description: "Group accounts by lifecycle, plan, or revenue risk.",
        },
        {
          title: "Lifecycle timeline",
          description: "Every upgrade, renewal, and cancellation in sequence.",
        },
      ]}
    />
  );
}
