import { useQuery } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { getIcon } from "@maipai/ui/src/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@maipai/ui/src/dashboard/components/ui/table";
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
 * comment) through a small table composed from the shipped Table
 * primitives, same as SHELL-03's own apps row at the route level.
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
            <Card className="flex flex-col gap-0!">
              <CardContent className="px-0!">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className="pl-4! px-4 py-3 h-auto text-sm font-normal text-muted-foreground">Name</TableHead>
                      <TableHead className="pr-4! px-4 py-3 h-auto text-sm font-normal text-muted-foreground">Role</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {roster.length === 0 ? (
                      <TableRow className="border-border">
                        <TableCell colSpan={2} className="px-4 py-6 text-sm text-muted-foreground text-center">No people available.</TableCell>
                      </TableRow>
                    ) : (
                      roster.map((entry) => (
                        <TableRow key={entry.id} className="border-border hover:bg-muted/30">
                          <TableCell className="pl-4! px-4 py-3 text-sm font-medium text-foreground">{entry.display_name}</TableCell>
                          <TableCell className="pr-4! px-4 py-3 text-sm text-muted-foreground">{ROLE_LABELS[entry.role]}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}
      </AsyncState>
    </div>
  );
}
