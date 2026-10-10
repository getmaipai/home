import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@maipai/ui/src/dashboard/components/ui/tabs";
import { Badge } from "@maipai/ui/src/dashboard/components/ui/badge";
import { getIcon } from "@maipai/ui/src/icons";
import type { Icon } from "@maipai/ui/src/icons";
import { GRID_COLUMNS } from "@maipai/ui/src/responsive";
import { ROLE_LABELS, ACCENT_RING_CLASS } from "@/apps/people/roles";
import { api, ApiError, isOwnerOrAdminRole, type DeviceInfo, type Entity, type PersonRosterEntry, type Roster } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";

const PetIcon = getIcon("box");
const RobotIcon = getIcon("bot");

/** The inside of one directory card: the kit's own `Avatar` or icon, name,
 * role/area, bio and a small badge, centered. The page owns the `Card`
 * (`docs/plans/people-profile-2026-09-26.md`'s "The directory: a grid, not
 * a table"). Photo-in-place-of-initial (`avatar_file_id`) and real
 * DiceBear rendering are `AVATAR-RENDER-01`; `Avatar` still only renders
 * the initial-on-tint fallback. Every card gets the same shape (photo,
 * name, bio) regardless of role, the child-view rule this row's acceptance
 * names: nothing here is sensitive. A person's accent shows as the ring on
 * their `Avatar` alone, since a ring on the Card itself would be a
 * className override on a kit Element. */
interface FamilyBodyProps {
  title: string;
  subtitle?: string | null;
  detail?: string | null;
  badge?: string;
  icon?: Icon;
  avatarName?: string;
  avatarClassName?: string;
}

function FamilyBody({ title, subtitle, detail, badge, icon: IconComponent, avatarName, avatarClassName }: FamilyBodyProps) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      {IconComponent ? <IconComponent size={32} className="text-muted-foreground" /> : avatarName ? <Avatar name={avatarName} className={avatarClassName ?? "size-16 text-xl"} /> : null}
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
        {detail ? <p className="text-sm text-muted-foreground">{detail}</p> : null}
        {/* deliberate type-floor exception: compact role badge */}
        {badge ? <span className="self-center rounded-full bg-muted px-1.5 py-0.5 text-xs">{badge}</span> : null}
      </div>
    </div>
  );
}

function personAvatarClass(entry: PersonRosterEntry): string {
  const accentClass = entry.accent ? ACCENT_RING_CLASS[entry.accent] : null;
  return accentClass ? `size-16 text-xl ring-2 ring-offset-2 ring-offset-card ${accentClass}` : "size-16 text-xl";
}

/** /people: the household directory as a card grid (`PEOPLE-GRID-01`,
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
 * opens `/people/:id`, the next-shell profile page for any person. */
export function FamilyPage({ person }: { person: Roster }) {
  useTabItem("Family");
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab");
  const activeTab = requestedTab === "pets" ? "pets" : requestedTab === "bots" && isOwnerOrAdminRole(person.role) ? "bots" : "people";
  const query = useQuery<PersonRosterEntry[]>({ queryKey: ["people"], queryFn: () => api.people() });
  const petsQuery = useQuery<Entity[]>({ queryKey: ["entities", "pet"], queryFn: () => api.entities("pet") });
  const botsQuery = useQuery<DeviceInfo[]>({ queryKey: ["robots", person.id, person.role], queryFn: () => fetchFamilyBots(person), enabled: isOwnerOrAdminRole(person.role) });

  function onTabChange(value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value === "people") next.delete("tab");
      else next.set("tab", value);
      return next;
    }, { replace: true });
  }

  return (
    <>
    <Tabs value={activeTab} onValueChange={onTabChange}>
      <TabsList className="h-auto min-h-14 p-1">
        <TabsTrigger value="people" className="min-h-12 min-w-12">People{query.data ? <> <Badge>{query.data.length}</Badge></> : null}</TabsTrigger>
        <TabsTrigger value="pets" className="min-h-12 min-w-12">Pets{petsQuery.data ? <> <Badge>{petsQuery.data.length}</Badge></> : null}</TabsTrigger>
        {isOwnerOrAdminRole(person.role) ? <TabsTrigger value="bots" className="min-h-12 min-w-12">Bots{botsQuery.data ? <> <Badge>{botsQuery.data.length}</Badge></> : null}</TabsTrigger> : null}
      </TabsList>
      <TabsContent value="people">
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
            <CardHeader>
              <CardTitle>Family</CardTitle>
            </CardHeader>
            <div className={`grid gap-4 ${GRID_COLUMNS.default}`}>
              {ordered.map((entry) => (
                <Link key={entry.id} to={`/people/${entry.id}`} className="block rounded-xl transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Card>
                    <CardContent>
                      <FamilyBody title={entry.display_name} subtitle={ROLE_LABELS[entry.role]} detail={entry.bio} avatarName={entry.display_name} avatarClassName={personAvatarClass(entry)} />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        );
      }}
    </AsyncState>
      </TabsContent>
      <TabsContent value="pets">
        <AsyncState data={petsQuery.data} error={petsQuery.isError} isFetching={petsQuery.isFetching} onRetry={() => petsQuery.refetch()} errorMessage="Could not load pets." loadingLabel="Loading pets">
          {(pets: Entity[]) => pets.length === 0 ? <EmptyState icon="inbox" text="Nothing here yet." /> : <div className={`grid gap-4 ${GRID_COLUMNS.default}`}>{pets.map((pet) => {
            const unconfirmed = pet.source === "inferred" && !pet.confirmed_by_person_id;
            return <Card key={pet.id}><CardContent><FamilyBody title={pet.name} detail={pet.description} icon={PetIcon} badge={unconfirmed ? "Unconfirmed" : undefined} /></CardContent></Card>;
          })}</div>}
        </AsyncState>
      </TabsContent>
      <TabsContent value="bots">
        <AsyncState data={botsQuery.data} error={botsQuery.isError} isFetching={botsQuery.isFetching} onRetry={() => botsQuery.refetch()} errorMessage={botsQuery.error instanceof ApiError ? botsQuery.error.message : "Could not load bots."} loadingLabel="Loading bots">
          {(bots: DeviceInfo[]) => bots.length === 0 ? <EmptyState icon="inbox" text="Nothing here yet." /> : <div className={`grid gap-4 ${GRID_COLUMNS.default}`}>{bots.map((bot) => <Card key={bot.id}><CardContent><FamilyBody title={bot.name} subtitle={bot.area} icon={RobotIcon} /></CardContent></Card>)}</div>}
        </AsyncState>
      </TabsContent>
    </Tabs>
    </>
  );
}

export function fetchFamilyBots(person: Roster): Promise<DeviceInfo[]> {
  return isOwnerOrAdminRole(person.role)
    ? api.robotDevices()
    : api.devices().then((devices) => devices.filter((device) => device.kind === "robot"));
}
