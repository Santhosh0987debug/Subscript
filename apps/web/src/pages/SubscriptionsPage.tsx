import { CreditCard } from "lucide-react";
import { PlaceholderPage } from "@/components/ui/PlaceholderPage";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export default function SubscriptionsPage() {
  useDocumentTitle("Subscriptions");

  return (
    <PlaceholderPage
      eyebrow="Subscriptions · Lifecycle"
      title="The pulse of recurring revenue."
      description="Follow every trial, upgrade, pause, and renewal in one coherent timeline built for revenue teams."
      emptyTitle="Subscription lifecycle is next."
      emptyDescription="Phase 2 will connect this surface to tenant-scoped subscription records, with periods, quantities, and state transitions that read like the business."
      icon={CreditCard}
      capabilities={[
        {
          title: "Lifecycle visibility",
          description: "Trialing, active, paused, and canceled states at a glance.",
        },
        {
          title: "Expansion signals",
          description: "Surface upgrades, added seats, and changing quantities.",
        },
        {
          title: "Dunning workflow",
          description: "A clear path for past-due recovery and customer outreach.",
        },
      ]}
    />
  );
}
