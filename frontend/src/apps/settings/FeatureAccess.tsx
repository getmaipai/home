import { i18n } from "@lingui/core";
import { useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemSeparator, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@maipai/ui/src/ui/toggle-group";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { api, isOwnerOrAdminRole, type PersonFeature, type PersonRosterEntry, type Roster } from "@/lib/api";
import { bandOf, isMinor } from "@/lib/audience";
import { errorLine } from "@/lib/hubReachability";

type Choice = "role" | "allow" | "deny";
const CODING = "code";
const featuresKey = (personId: string) => ["person-features", personId] as const;
const choiceOf = (row: PersonFeature): Choice => row.grant ? row.grant.effect : "role";
const bandOrder = (entry: PersonRosterEntry) => bandOf(entry) === "adult" ? 0 : bandOf(entry) === "teen" ? 1 : 2;

/** ACCESS-UI-01 (RULES.md C7, C10): an owner's or admin's screen for who may use which feature, by person or by feature. It is never shown to
 * the people it is about. With `feature`, only that feature's by-feature list is shown (Settings > Coding). "Allowed by role" removes the
 * person's own setting; "Allowed" and "Denied" write one. The hub refuses an "Allowed" that would pass an age gate and its sentence is shown. */
export function FeatureAccess({ viewer, feature }: { viewer?: Pick<Roster, "id" | "role">; feature?: string }) {
  const client = useQueryClient();
  const allowed = !viewer || isOwnerOrAdminRole(viewer.role);
  const people = useQuery({ queryKey: ["people"], queryFn: () => api.people(), enabled: allowed });
  const [axis, setAxis] = useState<"person" | "feature">(feature ? "feature" : "person");
  const [personId, setPersonId] = useState<string | null>(null);
  const [featureId, setFeatureId] = useState<string>(feature ?? CODING);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ person: PersonRosterEntry; row: PersonFeature } | null>(null);
  const roster = [...(people.data ?? [])].sort((a, b) => bandOrder(a) - bandOrder(b) || a.display_name.localeCompare(b.display_name));
  const ownFeatures = useQuery({ queryKey: featuresKey(viewer?.id ?? "self"), queryFn: () => api.personFeatures(viewer!.id), enabled: allowed && !feature && axis === "feature" && !!viewer });
  const selected = roster.find((entry) => entry.id === personId) ?? roster[0];
  const featureList = ownFeatures.data?.features ?? [];
  const byFeature = useQueries({ queries: axis === "feature" ? roster.map((entry) => ({ queryKey: featuresKey(entry.id), queryFn: () => api.personFeatures(entry.id) })) : [] });
  const onePerson = useQuery({ queryKey: featuresKey(selected?.id ?? "none"), queryFn: () => api.personFeatures(selected!.id), enabled: allowed && axis === "person" && !!selected });
  if (!allowed) return null;

  /** The new setting is written before the old one is removed, so a refused write leaves the person as they were. */
  const write = async (person: PersonRosterEntry, row: PersonFeature, choice: Choice) => {
    setError(null);
    try {
      if (choice !== "role") await api.createGrant({ person: person.id, action: `use:${row.id}`, effect: choice });
      if (row.grant) await api.revokeGrant(row.grant.id);
      // Coding keys for a child or teen follow the choice: on only while an admin allows it, as the old list did.
      if (row.id === CODING && isMinor(person)) await api.setSetting(`person:${person.id}`, "coding.person.api_keys", choice === "allow");
    } catch (reason) {
      setError(errorLine(reason, i18n._({ id: "Could not change access. Try again.", message: "Could not change access. Try again." })));
    } finally {
      await Promise.all([client.invalidateQueries({ queryKey: featuresKey(person.id) }), client.invalidateQueries({ queryKey: ["people"] })]);
    }
  };
  const change = (person: PersonRosterEntry, row: PersonFeature, choice: Choice) => {
    if (choice === choiceOf(row)) return;
    if (row.id === CODING && isMinor(person) && choice === "allow") setConfirm({ person, row });
    else void write(person, row, choice);
  };

  const personRows = onePerson.data?.features;
  const picked = byFeature.map((query, index) => ({ person: roster[index]!, row: query.data?.features.find((item) => item.id === featureId) })).filter((entry): entry is { person: PersonRosterEntry; row: PersonFeature } => !!entry.row);
  const heading = feature === CODING ? i18n._({ id: "Who can use Coding", message: "Who can use Coding" }) : i18n._({ id: "Features", message: "Features" });
  return <div className="flex flex-col gap-3" data-testid="feature-access">
    <div className="flex flex-col gap-1">
      <h3 className="text-section">{heading}</h3>
      <p className="text-supporting text-muted-foreground">{feature === CODING ? i18n._({ id: "Adults follow the household setting. Children and teens can use Coding only when you allow it. Their protections stay on.", message: "Adults follow the household setting. Children and teens can use Coding only when you allow it. Their protections stay on." }) : i18n._({ id: "Choose what each person can use. A feature someone cannot use is simply absent for them.", message: "Choose what each person can use. A feature someone cannot use is simply absent for them." })}</p>
    </div>
    {feature ? null : <div className="flex flex-wrap items-center gap-3">
      <ToggleGroup type="single" variant="segmented" value={axis} onValueChange={(next) => { if (next === "person" || next === "feature") setAxis(next); }} aria-label={i18n._({ id: "Arrange by", message: "Arrange by" })}>
        <ToggleGroupItem value="person">{i18n._({ id: "By person", message: "By person" })}</ToggleGroupItem>
        <ToggleGroupItem value="feature">{i18n._({ id: "By feature", message: "By feature" })}</ToggleGroupItem>
      </ToggleGroup>
      {axis === "person"
        ? <Select value={selected?.id ?? ""} onValueChange={setPersonId}><SelectTrigger aria-label={i18n._({ id: "Person", message: "Person" })}><SelectValue /></SelectTrigger><SelectContent>{roster.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.display_name}</SelectItem>)}</SelectContent></Select>
        : <Select value={featureId} onValueChange={setFeatureId}><SelectTrigger aria-label={i18n._({ id: "Feature", message: "Feature" })}><SelectValue /></SelectTrigger><SelectContent>{featureList.map((item) => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</SelectContent></Select>}
    </div>}
    {axis === "person"
      ? <AsyncState data={selected ? personRows : roster.length === 0 && people.isSuccess ? [] : undefined} error={people.isError || onePerson.isError} isFetching={people.isFetching || onePerson.isFetching} onRetry={() => { void people.refetch(); void onePerson.refetch(); }} errorMessage={i18n._({ id: "Could not load feature access. Try again.", message: "Could not load feature access. Try again." })} loadingLabel={i18n._({ id: "Loading feature access", message: "Loading feature access" })}>
        {(rows) => <ItemGroup variant="card" aria-label={i18n._({ id: "What {name} can use", message: "What {name} can use", values: { name: selected?.display_name ?? "" } })}>{rows.map((row, index) => <FeatureRow key={row.id} title={row.title} name={selected!.display_name} row={row} minor={isMinor(selected!)} onChange={(choice) => change(selected!, row, choice)} last={index === rows.length - 1} />)}</ItemGroup>}
      </AsyncState>
      : <AsyncState data={people.isSuccess && byFeature.every((query) => query.isSuccess) && (feature || ownFeatures.isSuccess) ? picked : undefined} error={people.isError || byFeature.some((query) => query.isError)} isFetching={people.isFetching || byFeature.some((query) => query.isFetching)} onRetry={() => { void people.refetch(); byFeature.forEach((query) => void query.refetch()); }} errorMessage={i18n._({ id: "Could not load feature access. Try again.", message: "Could not load feature access. Try again." })} loadingLabel={i18n._({ id: "Loading feature access", message: "Loading feature access" })}>
        {(entries) => <ItemGroup variant="card" aria-label={i18n._({ id: "Who can use this feature", message: "Who can use this feature" })}>{entries.map(({ person, row }, index) => <FeatureRow key={person.id} title={person.display_name} name={person.display_name} row={row} minor={isMinor(person)} onChange={(choice) => change(person, row, choice)} last={index === entries.length - 1} />)}</ItemGroup>}
      </AsyncState>}
    {error ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={error} /> : null}
    <AlertDialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{i18n._({ id: "Let {display_name} use Coding?", message: "Let {display_name} use Coding?", values: { display_name: confirm?.person.display_name ?? "" } })}</AlertDialogTitle><AlertDialogDescription>{i18n._({ id: "Their safety protections stay on. Their keys work only while Coding is on, and an admin can take back this access at any time.", message: "Their safety protections stay on. Their keys work only while Coding is on, and an admin can take back this access at any time." })}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{i18n._({ id: "Not now", message: "Not now" })}</AlertDialogCancel><AlertDialogAction onClick={() => { const pending = confirm; setConfirm(null); if (pending) void write(pending.person, pending.row, "allow"); }}>{i18n._({ id: "Allow Coding", message: "Allow Coding" })}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

/** One row: a title and the three-way choice. "Allowed" is not offered where the hub would refuse it (a child or teen below a feature's age floor); Coding is the exception. */
function FeatureRow({ title, name, row, minor, onChange, last }: { title: string; name: string; row: PersonFeature; minor: boolean; onChange: (choice: Choice) => void; last: boolean }) {
  const current = choiceOf(row);
  const cannotAllow = minor && !row.role_allows && !row.allow_for_minors;
  return <><Item>
    <ItemContent><ItemTitle>{title}</ItemTitle><ItemDescription>{row.effective ? i18n._({ id: "Can use it now", message: "Can use it now" }) : i18n._({ id: "Cannot use it now", message: "Cannot use it now" })}</ItemDescription></ItemContent>
    <ItemActions>
      <ToggleGroup type="single" variant="segmented" value={current} onValueChange={(next) => { if (next === "role" || next === "allow" || next === "deny") onChange(next); }} aria-label={i18n._({ id: "{feature} for {name}", message: "{feature} for {name}", values: { feature: row.title, name } })}>
        <ToggleGroupItem value="role">{i18n._({ id: "Allowed by role", message: "Allowed by role" })}</ToggleGroupItem>
        <ToggleGroupItem value="allow" disabled={cannotAllow}>{i18n._({ id: "Allowed", message: "Allowed" })}</ToggleGroupItem>
        <ToggleGroupItem value="deny">{i18n._({ id: "Denied", message: "Denied" })}</ToggleGroupItem>
      </ToggleGroup>
    </ItemActions>
  </Item>{last ? null : <ItemSeparator variant="inset" />}</>;
}
