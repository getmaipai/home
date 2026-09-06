import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "@/kit/primitives/EmptyState";
import { Section } from "@/kit/primitives/Section";
import { isOwnerOrAdminRole, type Roster } from "@/lib/api";

interface AdminGatedContentProps {
  title: string;
  person: Roster;
  deniedText: string;
  children: ReactNode;
}

// Renamed from AdminGatedPage (2026-09-06): Models/Backups/Voices/Commands
// moving to their own routes (Session B step 7) had each unmount
// SettingsPage entirely on navigation, taking the tree rail, the
// Household/Me switcher, and the search box down with it - Jesse noticed
// the content pane "completely filled" and the rest of the Settings
// chrome vanishing. They're nested child routes now (App.tsx, rendered
// through SettingsPage's own <Outlet/>), so this renders straight into
// that page's already-scrolling content pane rather than wrapping a
// `<Page>` of its own - the allowed branch's `children` already carry
// their own `<Section heading>` (ModelsSection/BackupsSection), so
// dropping `<Page>`'s h1 there loses nothing. The denied branch has no
// such heading of its own (EmptyState is a bare icon/text/action
// primitive, `kit/primitives/EmptyState.tsx`) - a code review (2026-09-06)
// caught that a non-admin landing directly on /settings/backups or
// /settings/models saw a lock icon with no indication of which page they
// were denied. `title` restores that, in the same `Section` card style
// every other block on this page uses, rather than reintroducing `<Page>`.
export function AdminGatedContent({ title, person, deniedText, children }: AdminGatedContentProps) {
  const navigate = useNavigate();
  if (!isOwnerOrAdminRole(person.role)) {
    return (
      <Section heading={title}>
        <EmptyState icon="lock" text={deniedText} actionLabel="Back to Settings" onAction={() => navigate("/settings")} />
      </Section>
    );
  }
  return <>{children}</>;
}
