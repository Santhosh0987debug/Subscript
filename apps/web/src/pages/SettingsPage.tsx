import { Settings2 } from "lucide-react";
import { PlaceholderPage } from "@/components/ui/PlaceholderPage";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export default function SettingsPage() {
  useDocumentTitle("Settings");

  return (
    <PlaceholderPage
      eyebrow="Settings · Workspace"
      title="Shape Subscript around your team."
      description="Workspace identity, roles, and preferences will live here - designed to stay out of the way of the work."
      emptyTitle="Workspace controls are on the way."
      emptyDescription="Phase 2 will add tenant-aware workspace settings, role management, and notification preferences. Nothing on this page writes data today."
      icon={Settings2}
      capabilities={[
        {
          title: "Workspace profile",
          description: "Name, default currency, and the details that anchor the tenant.",
        },
        {
          title: "Team roles",
          description: "Owner, admin, member, and viewer permissions with a clear boundary.",
        },
        {
          title: "Notification preferences",
          description: "Choose which revenue events deserve your attention.",
        },
      ]}
    />
  );
}
