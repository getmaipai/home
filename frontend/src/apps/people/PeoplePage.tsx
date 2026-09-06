import { useQuery } from "@tanstack/react-query";
import { Page } from "@/kit/primitives/Page";
import { Section } from "@/kit/primitives/Section";
import { List } from "@/kit/primitives/List";
import { AsyncState } from "@/kit/primitives/AsyncState";
import { Avatar } from "@/kit/primitives/Avatar";
import { api, type PersonRosterEntry } from "@/lib/api";
import { ROLE_LABELS } from "@/apps/people/roles";
import { cn, FOCUS_RING } from "@/kit/utils";

// Jesse, 2026-09-06: "the edit part is for USERS, not people" - adding,
// editing, and removing accounts moved to Settings -> Household -> Users
// (UsersPage.tsx, admin-gated), matching the spec's own Person/User
// split (docs/dev.md's "Entities, relationships and grants": "a person
// can have an account, which makes them a user"). This page is what's
// left: a plain directory, readable by anyone signed in, no management
// controls at all - not even the old self-rename affordance, which lived
// on the same "Edit" button as admin edits and left with it (a real,
// deliberate loss for a non-admin's own display name until a real
// self-service replacement exists, called out at the time rather than
// silently dropped).
//
// docs/BACKLOG.md tracks where this grows next: browsing beyond account
// holders to broader entities (a delivery driver, a relationship, a
// place someone keeps something) is an explicitly open design question,
// not started here - the hub has no Entity/Relationship storage yet
// (dev.md's "Not built here"). Messaging, shared media, and a Find
// Family/Things feature are also backlog items, not this page today.
export function PeoplePage() {
  const rosterQuery = useQuery<PersonRosterEntry[]>({
    queryKey: ["people"],
    queryFn: () => api.people(),
  });

  return (
    <Page title="People">
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a keyboard-scrollable region, not a widget (DetailPane.tsx's own precedent). */}
      <div tabIndex={0} className={cn("flex flex-1 flex-col gap-6 overflow-y-auto p-4", FOCUS_RING)}>
        <AsyncState
          data={rosterQuery.data}
          error={rosterQuery.isError}
          isFetching={rosterQuery.isFetching}
          onRetry={() => rosterQuery.refetch()}
          errorMessage="Could not load the household."
          loadingLabel="Loading household"
        >
          {(roster) => (
            <Section heading="Household">
              <List
                items={roster}
                getKey={(p) => p.id}
                label="Household"
                renderItem={(p) => (
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={p.display_name} className="h-10 w-10 shrink-0" />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-base">{p.display_name}</span>
                      <span className="text-sm text-[var(--muted-foreground)]">{ROLE_LABELS[p.role]}</span>
                    </div>
                  </div>
                )}
              />
            </Section>
          )}
        </AsyncState>
      </div>
    </Page>
  );
}
