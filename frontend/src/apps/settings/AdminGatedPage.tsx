import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Page } from "@/kit/primitives/Page";
import { EmptyState } from "@/kit/primitives/EmptyState";
import { isOwnerOrAdminRole, type Roster } from "@/lib/api";

interface AdminGatedPageProps {
  title: string;
  person: Roster;
  deniedText: string;
  children: ReactNode;
}

// A code review (2026-09-06) found ModelsPage.tsx and BackupsPage.tsx
// duplicating the exact same owner/admin gate and EmptyState fallback
// verbatim - a future change to either (a different role, a different
// icon or copy) would have to land in both, or drift. One definition
// here instead (CLAUDE.md platform principle 1).
export function AdminGatedPage({ title, person, deniedText, children }: AdminGatedPageProps) {
  const navigate = useNavigate();
  if (!isOwnerOrAdminRole(person.role)) {
    return (
      <Page title={title}>
        <EmptyState icon="lock" text={deniedText} actionLabel="Back to Settings" onAction={() => navigate("/settings")} />
      </Page>
    );
  }
  return (
    <Page title={title}>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">{children}</div>
    </Page>
  );
}
