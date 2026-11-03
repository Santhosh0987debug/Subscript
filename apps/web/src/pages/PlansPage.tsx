import { Layers } from "lucide-react";
import { PlaceholderPage } from "@/components/ui/PlaceholderPage";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export default function PlansPage() {
  useDocumentTitle("Plans");

  return (
    <PlaceholderPage
      eyebrow="Plans · Catalogue"
      title="Packaging that grows with you."
      description="Shape pricing, billing intervals, and entitlements without rebuilding the underlying billing model."
      emptyTitle="Your plan catalogue starts here."
      emptyDescription="Phase 2 will introduce a tenant-scoped plan catalogue with clear intervals and pricing records - the stable layer every subscription builds on."
      icon={Layers}
      capabilities={[
        {
          title: "Flexible intervals",
          description: "Monthly and annual pricing with a consistent money contract.",
        },
        {
          title: "Clear entitlements",
          description: "Define what each plan includes before billing begins.",
        },
        {
          title: "Safe plan changes",
          description: "Keep historical subscriptions intact as packaging evolves.",
        },
      ]}
    />
  );
}
