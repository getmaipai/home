import { useParams, useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Page } from "@maipai/ui/src/primitives/Page";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@maipai/ui/src/ui/tabs";
import { cn, FOCUS_RING } from "@maipai/ui/src/utils";
import { api, isOwnerOrAdminRole, type PersonRosterEntry, type Roster } from "@/lib/api";
import { ROLE_LABELS } from "@/apps/people/roles";
import { OwnMemories, OtherPersonMemories } from "@/apps/memory/PersonMemories";

interface PersonProfilePageProps {
  person: Roster;
}

/** A person's own profile (owner ruling, "Navigation, corrected,"
 * 2026-09-20): "Memories belong to a person, so they live on the
 * person's profile: People, a person, the Memories tab." Deliberately
 * minimal - an Overview tab (name, role, avatar) and the Memories tab,
 * reusing `OwnMemories`/`OtherPersonMemories` unchanged from the
 * retired household-wide MemoryPage.tsx - not the full things-page
 * composition (kind badges as a real things table, a details pane)
 * the ruling describes as the eventual shape. That rebuild is
 * HOME-UI-04's own "People page composition," explicitly out of scope
 * here; this page only has to move Memories off the rail and onto a
 * person, honestly, without inventing 04's work early. */
export function PersonProfilePage({ person }: PersonProfilePageProps) {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewingSelf = id === person.id;
  const canViewOthers = isOwnerOrAdminRole(person.role);
  // Depends only on the SIGNED-IN person's own role/id, not on the
  // profile being viewed - computed here, not down by the tab list
  // below, so `activeTab` can fall back instead of matching neither
  // tab. A code review caught the gap this closes: switching the
  // signed-in profile mid-session (ProfileSwitcher, no navigation)
  // could leave the URL on `?tab=memories` after the new profile lost
  // permission for it, rendering a Tabs with no active trigger and no
  // visible content at all - a real, reachable blank page, not a
  // hypothetical one.
  const canViewMemories = viewingSelf || canViewOthers;
  const activeTab = searchParams.get("tab") === "memories" && canViewMemories ? "memories" : "overview";
  function onTabChange(value: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === "memories") next.set("tab", value);
        else next.delete("tab");
        return next;
      },
      { replace: true },
    );
  }

  // A code review flagged this as an avoidable fetch when viewing your
  // OWN profile (`profile` below is set straight from the `person`
  // prop then, never from `roster`) - true, but `enabled: !viewingSelf`
  // is the wrong fix: AsyncState's own contract treats `data:
  // undefined` as "still loading" with no other signal, so a disabled
  // query (permanently `data: undefined`, `isFetching: false`) would
  // leave the self-viewing case on AsyncState's loading skeleton
  // forever, trading a minor inefficiency for a real, permanent
  // regression. Left unconditional; `["people"]` is the same cache key
  // PeoplePage's own household list already reads, so a household
  // member who has visited People this session pays nothing extra
  // here either way.
  const rosterQuery = useQuery<PersonRosterEntry[]>({ queryKey: ["people"], queryFn: () => api.people() });

  return (
    <Page title="Profile" hideTitle>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a keyboard-scrollable region, not a widget (DetailPane.tsx's own precedent). */}
      <div tabIndex={0} className={cn("mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto p-4", FOCUS_RING)}>
        <AsyncState
          data={rosterQuery.data}
          error={rosterQuery.isError}
          isFetching={rosterQuery.isFetching}
          onRetry={() => rosterQuery.refetch()}
          errorMessage="Could not load the household."
          loadingLabel="Loading profile"
        >
          {(roster) => {
            const profile = viewingSelf ? person : roster.find((p) => p.id === id);
            if (!profile) {
              return (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <p className="text-base font-medium">No one in this household has that profile.</p>
                  <Link to="/people" className="text-primary underline">
                    Back to People
                  </Link>
                </div>
              );
            }
            return (
              <>
                <div className="flex items-center gap-3">
                  <Avatar name={profile.display_name} className="h-14 w-14" />
                  <div className="flex min-w-0 flex-col">
                    <h1 className="truncate text-xl font-semibold">{profile.display_name}</h1>
                    <p className="text-sm text-muted-foreground">{ROLE_LABELS[profile.role]}</p>
                  </div>
                </div>

                <Tabs value={activeTab} onValueChange={onTabChange}>
                  <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    {canViewMemories ? <TabsTrigger value="memories">Memories</TabsTrigger> : null}
                  </TabsList>
                  <TabsContent value="overview" className="flex flex-col gap-2 py-2">
                    <p className="text-base text-muted-foreground">
                      {viewingSelf ? "This is your own profile." : `${profile.display_name}'s profile in this household.`}
                    </p>
                  </TabsContent>
                  {canViewMemories ? (
                    <TabsContent value="memories" className="py-2">
                      {viewingSelf ? (
                        <OwnMemories filterIds={idsFilter(searchParams)} actorIsAdult={person.role === "adult"} />
                      ) : (
                        <OtherPersonMemories personId={profile.id} personName={profile.display_name} />
                      )}
                    </TabsContent>
                  ) : null}
                </Tabs>
              </>
            );
          }}
        </AsyncState>
      </div>
    </Page>
  );
}

/** Chat's "memory updated" chip (chatMemoryChip.tsx) and the header
 * search's memory results (search/providers.ts) both deep-link with
 * `?ids=<memory ids>` - unchanged from the retired MemoryPage.tsx's own
 * filter, just read here instead. */
function idsFilter(searchParams: URLSearchParams): Set<string> | null {
  const idsParam = searchParams.get("ids");
  return idsParam ? new Set(idsParam.split(",")) : null;
}
