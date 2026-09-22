import { useQuery } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { getIcon } from "@maipai/ui/src/icons";
import DataTable from "@maipai/ui/src/dashboard/components/tables/data-table/DataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { ROLE_LABELS } from "@/apps/people/roles";
import { api, ApiError, type PersonRosterEntry, type Roster } from "@/lib/api";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

/** /next/people: SHELL-04's own row (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md's plan row) - one route, two of the template's own
 * views stacked exactly as the Step 1 stand-up first mounted them
 * ("user-profile, data-tables"): the signed-in person's own profile
 * card, then GET /api/people (the same list `PeoplePage.tsx`'s own
 * `rosterQuery` reads, unscoped by design - "a plain directory,
 * readable by anyone signed in," `PeoplePage.tsx`'s own header
 * comment) through the shipped `DataTable`, same as SHELL-03's own
 * apps row: a real `data` prop, no gap-composition needed for the
 * table itself.
 *
 * The profile half is a genuine SHELL-01-style gap: the vendored
 * `UserProfile` (`@maipai/ui/src/dashboard/components/user-profile/
 * index.tsx`) takes no props at all - name, email, phone, position,
 * social links and address are all local `useState`, hardcoded demo
 * values with a local-only "Edit" dialog that never reaches a server.
 * Not a component in the "as shipped" sense the no-hand-built-UI rule
 * protects, since editing it to accept props would be forking a
 * vendored file - named here, then composed from the SAME shipped
 * primitives it's built from (`Card`, `CardContent`, the kit's own
 * `Avatar`), mirroring its top header card's shape (an avatar, a
 * name, a subtitle line) with every field it has no counterpart for
 * dropped rather than faked: no email, phone, position, social links,
 * address, or Edit action - Home's own Person has none of those, and
 * editing a person's own account already lives in Settings -> Users
 * (`AppsPage.tsx`'s own "the edit part is for USERS, not people"
 * comment applies identically here). The "This is your own profile."
 * line is `PersonProfilePage.tsx`'s own real copy, reused rather than
 * reworded. Viewing another person's own profile, and the Memories
 * tab, are out of scope for this row (this page shows the SIGNED-IN
 * person's own profile only) - `PersonProfilePage.tsx` keeps that job
 * until its own row moves it. */
const PeopleIcon = getIcon("users");

interface PersonRow extends Record<string, unknown> {
  name: string;
  role: string;
}

function toRow(p: PersonRosterEntry): PersonRow {
  return { name: p.display_name, role: ROLE_LABELS[p.role] };
}

export function NextPeoplePage({ person }: { person: Roster }) {
  useDocumentTitle("People");
  const query = useQuery<PersonRosterEntry[]>({ queryKey: ["people"], queryFn: () => api.people() });

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-6">
        <CardContent className="flex items-center gap-6 p-0">
          <Avatar name={person.display_name} className="size-20 text-2xl" />
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">{person.display_name}</h2>
            <p className="text-sm text-muted-foreground">{ROLE_LABELS[person.role]}</p>
            <p className="text-sm text-muted-foreground">This is your own profile.</p>
          </div>
        </CardContent>
      </Card>

      <AsyncState
        data={query.data}
        error={query.isError}
        isFetching={query.isFetching}
        onRetry={() => query.refetch()}
        errorMessage={query.error instanceof ApiError ? query.error.message : "Could not load the household."}
        loadingLabel="Loading household"
      >
        {(roster: PersonRosterEntry[]) => (
          <div className="flex flex-col gap-4">
            <CardHeader className="p-0">
              <CardTitle className="flex items-center gap-2">
                <PeopleIcon size={16} className="text-muted-foreground" />
                People
              </CardTitle>
            </CardHeader>
            <DataTable data={roster.map(toRow)} />
          </div>
        )}
      </AsyncState>
    </div>
  );
}
