import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { GRID_COLUMNS } from "@maipai/ui/src/responsive";
import { ROLE_LABELS, ACCENT_RING_CLASS } from "@/apps/people/roles";
import { api, ApiError, type PersonRosterEntry, type Roster } from "@/lib/api";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

/** One person's card: `Card` (`@maipai/ui/src/dashboard/components/ui/
 * card`) plus the kit's own `Avatar`, no new primitive - `docs/plans/
 * people-profile-2026-09-26.md`'s "The directory: a grid, not a table"
 * names this exact composition ("`Card` in a CSS grid is the whole
 * component"). Photo-in-place-of-initial (`avatar_file_id`) and real
 * DiceBear rendering are `AVATAR-RENDER-01`, not blocking here - `Avatar`
 * still only renders the initial-on-tint fallback its own header
 * documents. Every card gets the same header shape (photo, name, bio)
 * regardless of role, the child-view rule this row's acceptance names:
 * nothing here is sensitive, unlike the shared-media grid a later row
 * adds to the profile page. */
function PersonCard({ entry }: { entry: PersonRosterEntry }) {
  const accentClass = entry.accent ? ACCENT_RING_CLASS[entry.accent] : null;
  return (
    <Link
      to={`/next/people/${entry.id}`}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className={accentClass ? `ring-2 ring-offset-2 ring-offset-background transition-shadow hover:shadow-md ${accentClass}` : "transition-shadow hover:shadow-md"}>
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <Avatar
            name={entry.display_name}
            className={accentClass ? `size-16 text-xl ring-2 ring-offset-2 ring-offset-card ${accentClass}` : "size-16 text-xl"}
          />
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-semibold">{entry.display_name}</h3>
            <p className="text-sm text-muted-foreground">{ROLE_LABELS[entry.role]}</p>
            {entry.bio ? <p className="text-sm text-muted-foreground">{entry.bio}</p> : null}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

/** /next/people: the household directory as a card grid (`PEOPLE-GRID-01`,
 * `docs/plans/people-profile-2026-09-26.md`), retiring the roster table
 * SHELL-04's own stand-up left here ("the honest placeholder for a
 * stand-up, not a design," the design record's own words). `GET /api/
 * people` is still the same plain, unscoped directory (`PeoplePage.tsx`'s
 * own header comment: readable by anyone signed in) - the signed-in
 * person's own entry is already in that list, so it leads the grid
 * (`ordered` below) instead of sitting in a separate profile block above
 * it, which is what the old stacked layout's double avatar came from
 * (the design record: "their name shows twice today: once above the
 * table, once as a row in it"). Tapping any card, including your own,
 * opens `/next/people/:id`, the next-shell profile page for any person. */
export function NextPeoplePage({ person }: { person: Roster }) {
  useDocumentTitle("People");
  const query = useQuery<PersonRosterEntry[]>({ queryKey: ["people"], queryFn: () => api.people() });

  return (
    <AsyncState
      data={query.data}
      error={query.isError}
      isFetching={query.isFetching}
      onRetry={() => query.refetch()}
      errorMessage={query.error instanceof ApiError ? query.error.message : "Could not load the household."}
      loadingLabel="Loading household"
    >
      {(roster: PersonRosterEntry[]) => {
        const ordered = [...roster].sort((a, b) => {
          if (a.id === person.id) return -1;
          if (b.id === person.id) return 1;
          return 0;
        });
        return (
          <div className="flex flex-col gap-4">
            <CardHeader className="p-0">
              <CardTitle>People</CardTitle>
            </CardHeader>
            <div className={`grid gap-4 ${GRID_COLUMNS.default}`}>
              {ordered.map((entry) => (
                <PersonCard key={entry.id} entry={entry} />
              ))}
            </div>
          </div>
        );
      }}
    </AsyncState>
  );
}
