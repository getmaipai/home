import { useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Page } from "@maipai/ui/src/primitives/Page";
import { Section } from "@maipai/ui/src/primitives/Section";
import { List } from "@maipai/ui/src/primitives/List";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@maipai/ui/src/ui/tabs";
import { api, type PersonRosterEntry, type Roster } from "@/lib/api";
import { ROLE_LABELS } from "@/apps/people/roles";
import { cn, FOCUS_RING } from "@maipai/ui/src/utils";
import { PeopleAndThings } from "@/apps/memory/PeopleAndThings";

interface PeoplePageProps {
  person: Roster;
}

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
// Full per-person detail (things-table rows, a pane) is HOME-UI-04's
// own "People page composition" - each row here is just a real link to
// the new, deliberately minimal `PersonProfilePage.tsx`
// (owner ruling, "Navigation, corrected," 2026-09-20), not a rebuild of
// this list.
//
// "People and things" (entity/relationship tracking - a pet, a place)
// moved here as a second tab from the now-retired household-wide
// MemoryPage.tsx, since it is household-wide too, not a specific
// person's own data - it never belonged on a person's own profile.
export function PeoplePage({ person }: PeoplePageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("section") === "people-and-things" ? "people-and-things" : "household";
  function onTabChange(value: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === "people-and-things") next.set("section", value);
        else next.delete("section");
        return next;
      },
      { replace: true },
    );
  }

  const rosterQuery = useQuery<PersonRosterEntry[]>({
    queryKey: ["people"],
    queryFn: () => api.people(),
  });

  return (
    <Page title="People" hideTitle>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a keyboard-scrollable region, not a widget (DetailPane.tsx's own precedent). */}
      <div tabIndex={0} className={cn("flex flex-1 flex-col gap-6 overflow-y-auto p-4", FOCUS_RING)}>
        <Tabs value={activeTab} onValueChange={onTabChange}>
          <TabsList>
            <TabsTrigger value="household">Household</TabsTrigger>
            <TabsTrigger value="people-and-things">People and things</TabsTrigger>
          </TabsList>
          <TabsContent value="household">
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
                      <Link to={`/people/${p.id}`} className={cn("flex min-w-0 flex-1 items-center gap-3 py-1", FOCUS_RING)}>
                        <Avatar name={p.display_name} className="h-10 w-10 shrink-0" />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-base">{p.display_name}</span>
                          <span className="text-sm text-[var(--muted-foreground)]">{ROLE_LABELS[p.role]}</span>
                        </div>
                      </Link>
                    )}
                  />
                </Section>
              )}
            </AsyncState>
          </TabsContent>
          <TabsContent value="people-and-things">
            <PeopleAndThings actorRole={person.role} />
          </TabsContent>
        </Tabs>
      </div>
    </Page>
  );
}
