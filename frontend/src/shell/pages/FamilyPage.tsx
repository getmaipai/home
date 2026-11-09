import { i18n } from "@lingui/core";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { Card } from "@maipai/ui/src/primitives/Card";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { getIcon } from "@maipai/ui/src/icons";
import { ROLE_LABELS, isProfileClosedTo } from "@/apps/people/roles";
import { api, type DeviceInfo, type Entity, type PersonRosterEntry, type Roster, type CompanionList, type CompanionDetail } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";
import { errorLine } from "@/lib/hubReachability";

const PawIcon = getIcon("paw-print");
const BotIcon = getIcon("bot");
const ChevronIcon = getIcon("chevron-right");
const PlusIcon = getIcon("plus");

/** /people: people, pets and robots are presented together as the household. */
export function FamilyPage({ person }: { person: Roster }) {
  useTabItem(i18n._({ id: "Family", message: "Family" }));
  const navigate = useNavigate();
  const peopleQuery = useQuery<PersonRosterEntry[]>({ queryKey: ["people"], queryFn: () => api.people() });
  const petsQuery = useQuery<Entity[]>({ queryKey: ["entities", "pet"], queryFn: () => api.entities("pet") });
  const robotsQuery = useQuery<DeviceInfo[]>({ queryKey: ["family-robots"], queryFn: async () => (await api.robotDevices()).filter((device) => device.kind === "robot") });
  const companionsQuery = useQuery<CompanionList>({ queryKey: ["companions"], queryFn: api.companions, retry: false });
  const companionDetails = useQueries({ queries: (companionsQuery.data?.companions ?? []).map((companion) => ({ queryKey: ["companions", companion.id], queryFn: () => api.companion(companion.id), enabled: companionsQuery.isSuccess })) });
  const details = companionDetails.map((query) => query.data).filter((entry): entry is CompanionDetail => Boolean(entry));
  const people = peopleQuery.data ?? [];
  const pets = petsQuery.data ?? [];
  const robots = robotsQuery.data ?? [];
  const count = [
    i18n._({ id: "{count, plural, one {# person} other {# people}}", message: "{count, plural, one {# person} other {# people}}", values: { count: people.length } }),
    i18n._({ id: "{count, plural, one {# pet} other {# pets}}", message: "{count, plural, one {# pet} other {# pets}}", values: { count: pets.length } }),
    i18n._({ id: "{count, plural, one {# robot} other {# robots}}", message: "{count, plural, one {# robot} other {# robots}}", values: { count: robots.length } }),
    i18n._({ id: "{count, plural, one {# companion} other {# companions}}", message: "{count, plural, one {# companion} other {# companions}}", values: { count: details.length } }),
  ].join(" · ");

  return <div className="flex min-h-0 w-full flex-1 flex-col gap-8 overflow-y-auto p-4 md:p-6" data-testid="family-page">
    <AsyncState data={peopleQuery.data} error={peopleQuery.isError} isFetching={peopleQuery.isFetching} onRetry={() => peopleQuery.refetch()} errorMessage={errorLine(peopleQuery.error, i18n._({ id: "Could not load the household.", message: "Could not load the household." }))} loadingLabel={i18n._({ id: "Loading household", message: "Loading household" })}>
      {(roster) => {
        const ordered = [...roster].sort((a, b) => a.id === person.id ? -1 : b.id === person.id ? 1 : 0);
        return <>
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div><h1 className="sr-only">{i18n._({ id: "Family", message: "Family" })}</h1><p className="text-supporting text-muted-foreground">{count}</p></div>
          </header>
          {petsQuery.isError ? <div role="alert" className="flex items-center gap-3 text-supporting text-destructive">{i18n._({ id: "Could not load pets.", message: "Could not load pets." })}<Button variant="ghost" size="sm" onClick={() => void petsQuery.refetch()}>{i18n._({ id: "Try again", message: "Try again" })}</Button></div> : null}
          {robotsQuery.isError ? <div role="alert" className="flex items-center gap-3 text-supporting text-destructive">{i18n._({ id: "Could not load robots.", message: "Could not load robots." })}<Button variant="ghost" size="sm" onClick={() => void robotsQuery.refetch()}>{i18n._({ id: "Try again", message: "Try again" })}</Button></div> : null}

          <section className="flex flex-col gap-3" aria-labelledby="family-people-heading">
            <div className="flex items-center justify-between"><h2 id="family-people-heading" className="text-section font-semibold">{i18n._({ id: "People", message: "People" })}</h2></div>
            <div className="flex flex-col gap-1 md:grid md:grid-cols-2 xl:grid-cols-3">
              {ordered.map((entry) => {
                const blocked = isProfileClosedTo(person, entry);
                const profileLinkAllowed = !blocked;
                return <div key={entry.id} data-testid={`family-person-${entry.id}`}><Card surface="flat">
                  {profileLinkAllowed ? <Link to={`/people/${entry.id}`} className="flex items-center gap-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Avatar name={entry.display_name} seed={entry.avatar_seed} size="profile" accent={entry.accent ?? undefined} />
                    <div className="min-w-0 flex-1"><p className="text-row font-semibold">{entry.display_name}</p><p className="text-supporting text-muted-foreground">{ROLE_LABELS[entry.role]}{entry.bio ? ` · ${entry.bio}` : ""}</p></div>
                    <ChevronIcon aria-hidden className="text-muted-foreground" size={20} />
                  </Link> : <div className="flex items-center gap-4"><Avatar name={entry.display_name} seed={entry.avatar_seed} size="profile" accent={entry.accent ?? undefined} /><div className="min-w-0 flex-1"><p className="text-row font-semibold">{entry.display_name}</p><p className="text-supporting text-muted-foreground">{ROLE_LABELS[entry.role]}{entry.bio ? ` · ${entry.bio}` : ""}</p></div></div>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {details.filter((detail) => detail.used_by?.people.some((used) => used.id === entry.id)).map((detail) => <Chip key={detail.id} size="strip" onClick={() => navigate(`/companions/${encodeURIComponent(detail.id)}`)}>{detail.name}</Chip>)}
                    <Chip size="strip" onClick={() => navigate("/companions")}><PlusIcon aria-hidden size={16} />{i18n._({ id: "Companion", message: "Companion" })}</Chip>
                  </div>
                </Card></div>;
              })}
            </div>
          </section>

          {(pets.length > 0 || robots.length > 0) ? <section className="flex flex-col gap-3" aria-labelledby="family-pets-heading">
            <h2 id="family-pets-heading" className="text-section font-semibold">{i18n._({ id: "Pets and robots", message: "Pets and robots" })}</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {pets.map((pet) => <div key={pet.id} data-testid={`family-pet-${pet.id}`}><Card surface="flat"><div className="flex items-center gap-4"><PawIcon aria-hidden className="size-10 text-muted-foreground" /><div><p className="text-row font-semibold">{pet.name}</p><p className="text-supporting text-muted-foreground">{pet.description || i18n._({ id: "Pet", message: "Pet" })}</p>{pet.source === "inferred" && !pet.confirmed_by_person_id ? <Badge variant="secondary">{i18n._({ id: "Unconfirmed", message: "Unconfirmed" })}</Badge> : null}</div></div></Card></div>)}
              {robots.map((robot) => <Link key={robot.id} to={`/settings/devices/${encodeURIComponent(robot.id)}?tab=overview`} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div data-testid={`family-robot-${robot.id}`}><Card surface="flat"><div className="flex items-center gap-4"><BotIcon aria-hidden className="size-10 text-muted-foreground" /><div><p className="text-row font-semibold">{robot.name}</p><p className="text-supporting text-muted-foreground">{[i18n._({ id: "Robot", message: "Robot" }), robot.online ? i18n._({ id: "Online", message: "Online" }) : i18n._({ id: "Offline", message: "Offline" }), robot.area].filter(Boolean).join(" · ")}</p></div></div></Card></div></Link>)}
            </div>
          </section> : null}
          {ordered.length === 0 && pets.length === 0 && robots.length === 0 ? <EmptyState icon="users" text={i18n._({ id: "No family members yet.", message: "No family members yet." })} /> : null}
        </>;
      }}
    </AsyncState>
  </div>;
}
