import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { UsersSection } from "@/apps/settings/UsersSection";
import { PersonAccessEditor } from "@/apps/settings/PersonAccessEditor";
import { api, isOwnerOrAdminRole, type PersonRosterEntry, type Roster } from "@/lib/api";

/** Settings > Household > Users: the roster cards, and one page per person for their role, what they can use and what they can see
 * (PersonAccessEditor). The chosen person is the `person` search parameter, so the browser's Back button returns to the list.
 * RULES.md C10: it renders only for an owner or admin and never opens the viewer's own page. */
export function PeopleAccess({ person }: { person: Roster }) {
  const [params, setParams] = useSearchParams();
  const openId = params.get("person");
  const roster = useQuery<PersonRosterEntry[]>({ queryKey: ["people"], queryFn: () => api.people(), enabled: isOwnerOrAdminRole(person.role) });
  const target = openId && openId !== person.id ? roster.data?.find((entry) => entry.id === openId) : undefined;
  const open = (id: string | null) => setParams((previous) => { const next = new URLSearchParams(previous); if (id) next.set("person", id); else next.delete("person"); return next; });
  if (target) return <PersonAccessEditor viewer={person} target={target} onBack={() => open(null)} />;
  return <UsersSection person={person} onOpenPerson={open} />;
}
