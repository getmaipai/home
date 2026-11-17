import { isGuestRole } from "@/lib/audience";
import { i18n } from "@lingui/core";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { PersonFeatures } from "@/apps/settings/FeatureAccess";
import { PersonCompanions, PersonMore } from "@/apps/settings/PersonMore";
import { PersonContentSection } from "@/shell/pages/PersonContentSection";
import { api, isOwnerOrAdminRole, type PersonRosterEntry, type Role, type Roster } from "@/lib/api";
import { ROLE_LABELS, creatableRoles } from "@/apps/people/roles";
import { errorLine } from "@/lib/hubReachability";

type Controls = "child" | "teen" | "adult";
const CONTROLS_RANK: Record<Controls, number> = { child: 0, teen: 1, adult: 2 };

const roleSentence = (role: Role): string => ({
  owner: i18n._({ id: "Runs the household and can change anything.", message: "Runs the household and can change anything." }),
  admin: i18n._({ id: "Looks after the household: people, settings and what each person can use.", message: "Looks after the household: people, settings and what each person can use." }),
  adult: i18n._({ id: "Uses MaiPai fully. Cannot change other people's settings.", message: "Uses MaiPai fully. Cannot change other people's settings." }),
  teen: i18n._({ id: "Teen protections are on.", message: "Teen protections are on." }),
  child: i18n._({ id: "Child protections are on.", message: "Child protections are on." }),
  guest: i18n._({ id: "A visitor. The controls below decide which protections apply.", message: "A visitor. The controls below decide which protections apply." }),
})[role];

const controlsLabel = (controls: Controls): string => ({
  child: i18n._({ id: "Child controls", message: "Child controls" }),
  teen: i18n._({ id: "Teen controls", message: "Teen controls" }),
  adult: i18n._({ id: "Adult controls", message: "Adult controls" }),
})[controls];

/** One easy page for one person (an owner or admin editing someone else): their role, what they can use, what they can see.
 * Save model: every choice saves the moment it is made, and a "Saved." line confirms it (each section reports through `onSaved`); there is no Save button to forget.
 * RULES.md C10: a person never sees this about themselves, so it draws nothing for the viewer's own page or for anyone who is not an owner or admin.
 * Every content control inside it is the spec's registry copy; the role and feature copy here is Home's own. */
export function PersonAccessEditor({ viewer, target, onBack }: { viewer: Pick<Roster, "id" | "role">; target: PersonRosterEntry; onBack: () => void }) {
  const [saved, setSaved] = useState(false);
  const [version, setVersion] = useState(0);
  if (!isOwnerOrAdminRole(viewer.role) || viewer.id === target.id) return null;
  const markSaved = () => setSaved(true);
  return <div className="flex flex-col gap-8" data-testid="person-access-editor">
    <div className="flex flex-col items-start gap-4">
      <Button variant="ghost" size="control" onClick={onBack}>{i18n._({ id: "Back to everyone", message: "Back to users" })}</Button>
      <div className="flex items-center gap-4">
        <Avatar name={target.display_name} seed={target.avatar_seed} size="profile" accent={target.accent ?? undefined} />
        <div className="flex min-w-0 flex-col items-start gap-1">
          <h2 className="truncate text-hero">{target.display_name}</h2>
          <Badge variant="secondary">{ROLE_LABELS[target.role]}</Badge>
        </div>
      </div>
      <p className="text-supporting text-muted-foreground">{i18n._({ id: "Every change saves as you make it.", message: "Every change saves as you make it." })}</p>
    </div>
    <div role="status" className="sticky top-16 z-10 -mb-8 h-0 self-start">{saved ? <span className="inline-block rounded-full bg-secondary px-4 py-2 text-supporting text-secondary-foreground">{i18n._({ id: "Saved.", message: "Saved." })}</span> : null}</div>
    <section className="flex flex-col gap-3" aria-labelledby="person-access-role">
      <h3 id="person-access-role" className="text-section">{i18n._({ id: "Role", message: "Role" })}</h3>
      <RoleChoice viewer={viewer} target={target} onSaved={() => { markSaved(); setVersion((value) => value + 1); }} />
    </section>
    <section className="flex flex-col gap-3" aria-labelledby="person-access-use" key={`use-${version}`}>
      <h3 id="person-access-use" className="text-section">{i18n._({ id: "What {name} can use", message: "What {name} can use", values: { name: target.display_name } })}</h3>
      <p className="text-supporting text-muted-foreground">{i18n._({ id: "Choose what each person can use. A feature someone cannot use is simply absent for them.", message: "Choose what each person can use. A feature someone cannot use is simply absent for them." })}</p>
      <PersonFeatures person={target} onSaved={markSaved} />
    </section>
    <section className="flex flex-col gap-3" aria-labelledby="person-access-see" key={`see-${version}`}>
      <h3 id="person-access-see" className="text-section">{i18n._({ id: "What {name} can see", message: "What {name} can see", values: { name: target.display_name } })}</h3>
      <PersonContentSection personId={target.id} viewingSelf={false} onSaved={markSaved} />
    </section>
    <PersonCompanions target={target} />
    <PersonMore viewer={viewer} target={target} onRemoved={onBack} />
  </div>;
}

/** The role and, for a guest, the controls choice. Only the owner changes a role (the hub refuses anyone else); an owner or admin sets a guest's controls.
 * Raising a guest's controls keeps the confirmation the profile form always asked, and a role change asks first too, because it applies at once. */
function RoleChoice({ viewer, target, onSaved }: { viewer: Pick<Roster, "id" | "role">; target: PersonRosterEntry; onSaved: () => void }) {
  const client = useQueryClient();
  const [pendingRole, setPendingRole] = useState<Role | null>(null);
  const [pendingControls, setPendingControls] = useState<Controls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canChangeRole = viewer.role === "owner";
  const controls: Controls = target.controls ?? "child";

  async function save(edit: { role?: Role; controls?: Controls }, failure: string) {
    setBusy(true);
    setError(null);
    try {
      await api.updatePerson(target.id, edit);
      await Promise.all([client.invalidateQueries({ queryKey: ["people"] }), client.invalidateQueries({ queryKey: ["person-features", target.id] })]);
      onSaved();
    } catch (reason) {
      setError(errorLine(reason, failure));
    } finally {
      setBusy(false);
    }
  }
  const failRole = i18n._({ id: "Could not change {name}'s role. Check your connection and try again.", message: "Could not change {name}'s role. Check your connection and try again.", values: { name: target.display_name } });
  const failControls = i18n._({ id: "Could not change {name}'s controls. Check your connection and try again.", message: "Could not change {name}'s controls. Check your connection and try again.", values: { name: target.display_name } });
  const chooseControls = (next: Controls) => {
    if (next === controls) return;
    if (CONTROLS_RANK[next] > CONTROLS_RANK[controls]) setPendingControls(next);
    else void save({ controls: next }, failControls);
  };

  return <div className="flex flex-col gap-3">
    <p className="text-supporting text-muted-foreground">{roleSentence(target.role)}</p>
    {canChangeRole
      ? <Select value={target.role} onValueChange={(value) => { if (value && value !== target.role) setPendingRole(value as Role); }} disabled={busy}>
        <SelectTrigger aria-label={i18n._({ id: "Role for {name}", message: "Role for {name}", values: { name: target.display_name } })}><SelectValue>{ROLE_LABELS[target.role]}</SelectValue></SelectTrigger>
        <SelectContent>{creatableRoles("owner").map((role) => <SelectItem key={role} value={role}>{ROLE_LABELS[role]}</SelectItem>)}</SelectContent>
      </Select>
      : <p className="text-supporting text-muted-foreground">{i18n._({ id: "Only the owner can change a role.", message: "Only the owner can change a role." })}</p>}
    {isGuestRole(target.role) ? <div className="flex flex-col gap-2">
      <Select value={controls} onValueChange={(value) => { if (value) chooseControls(value as Controls); }} disabled={busy}>
        <SelectTrigger aria-label={i18n._({ id: "Controls", message: "Controls" })}><SelectValue>{controlsLabel(controls)}</SelectValue></SelectTrigger>
        <SelectContent>{(["child", "teen", "adult"] as const).map((value) => <SelectItem key={value} value={value}>{controlsLabel(value)}</SelectItem>)}</SelectContent>
      </Select>
    </div> : null}
    {error ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={error} /> : null}
    <AlertDialog open={pendingRole !== null} onOpenChange={(open) => { if (!open) setPendingRole(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{i18n._({ id: "Make {name} {role}?", message: "Make {name} {role}?", values: { name: target.display_name, role: pendingRole ? ROLE_LABELS[pendingRole] : "" } })}</AlertDialogTitle>
          <AlertDialogDescription>{i18n._({ id: "What {name} can use and see follows the new role from now on. You can change it back any time.", message: "What {name} can use and see follows the new role from now on. You can change it back any time.", values: { name: target.display_name } })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{i18n._({ id: "Keep {role}", message: "Keep {role}", values: { role: ROLE_LABELS[target.role] } })}</AlertDialogCancel>
          <AlertDialogAction onClick={() => { const next = pendingRole; setPendingRole(null); if (next) void save({ role: next, ...(isGuestRole(next) ? { controls } : {}) }, failRole); }}>{i18n._({ id: "Make {role}", message: "Make {role}", values: { role: pendingRole ? ROLE_LABELS[pendingRole] : "" } })}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={pendingControls !== null} onOpenChange={(open) => { if (!open) setPendingControls(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{i18n._({ id: "Give {name} {level} controls?", message: "Give {name} {level} controls?", values: { name: target.display_name, level: pendingControls ?? "" } })}</AlertDialogTitle>
          <AlertDialogDescription>{i18n._({ id: "{name} will get fewer protections: more subjects answered plainly and replies checked as they arrive instead of sentence by sentence. You can put stricter controls back any time.", message: "{name} will get fewer protections: more subjects answered plainly and replies checked as they arrive instead of sentence by sentence. You can put stricter controls back any time.", values: { name: target.display_name } })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{i18n._({ id: "Keep current controls", message: "Keep current controls" })}</AlertDialogCancel>
          <AlertDialogAction onClick={() => { const next = pendingControls; setPendingControls(null); if (next) void save({ controls: next }, failControls); }}>{i18n._({ id: "Give {level} controls", message: "Give {level} controls", values: { level: pendingControls ?? "" } })}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
