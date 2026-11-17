import { i18n } from "@lingui/core";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PlainSection } from "./PlainSection";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { CardGrid } from "@maipai/ui/src/primitives/CardGrid";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Switch } from "@maipai/ui/src/dashboard/components/ui/switch";
import { Field, FieldDescription, FieldLabel } from "@maipai/ui/src/dashboard/components/ui/field";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/dashboard/components/ui/dialog";
import { BatchBar, SelectModeToggle } from "@maipai/ui/src/primitives/BatchBar";
import { useSelectMode } from "@/kit/hooks/useSelectMode";
import { SiteBlocksSection } from "./SiteBlocksSection";
import { NewPersonForm, type NewPersonValues } from "@/apps/people/NewPersonForm";
import { api, ApiError, type PersonRosterEntry, type Role, type Roster } from "@/lib/api";
import { ROLE_LABELS, canDeletePerson } from "@/apps/people/roles";
import { OtherPersonMemories } from "@/apps/memory/PersonMemories";
import { errorLine } from "@/lib/hubReachability";
import { formatDate } from "@/lib/format";
import { StatusCard } from "@maipai/ui/src/elements/status-card";

interface UsersSectionProps {
  person: Roster;
  /** Opens one person's access page (PersonAccessEditor). Never used for the viewer's own card, which opens their own profile (RULES.md C10). */
  onOpenPerson: (id: string) => void;
}

/** The muted line under a person's role: "You" on your own card, the expiry for a guest who has one. */
function statusLine(entry: PersonRosterEntry, viewerId: string): string | null {
  if (entry.id === viewerId) return i18n._({ id: "You", message: "You" });
  if (entry.role === "guest" && entry.guest_expires_at) {
    const when = formatDate(entry.guest_expires_at);
    return i18n._({ id: "Guest until {date}", message: "Guest until {date}", values: { date: when } });
  }
  return null;
}

// Settings > Household > Users: who lives here, as cards. Each card opens that person's own page, where their role, what they can use
// and see, their companions, and the quiet "More" (rename, PIN lock, remove) live (PersonAccessEditor, PersonMore). The list itself
// only adds people and, through "Select people", removes several at once. Removing someone erases their memories, conversations,
// settings and recordings for real (backend/src/lib/personLifecycle.ts), so the batch version names the count first.
export function UsersSection({ person, onOpenPerson }: UsersSectionProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const rosterQuery = useQuery<PersonRosterEntry[]>({
    queryKey: ["people"],
    queryFn: () => api.people(),
  });
  const roster = rosterQuery.data;
  function invalidateRoster() {
    return queryClient.invalidateQueries({ queryKey: ["people"] });
  }

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingBatch, setConfirmingBatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const settingsRegistryQuery = useQuery({ queryKey: ["settings-registry"], queryFn: () => api.settingsRegistry(), staleTime: Infinity });
  const householdSettingsQuery = useQuery({ queryKey: ["settings-values", "household", "companions.allowed"], queryFn: () => api.settingsValues("household", "companions.allowed") });
  const companionKey = settingsRegistryQuery.data?.find((entry) => entry.key === "companions.allowed");
  const householdCompanionsAllowed = householdSettingsQuery.data?.find((entry) => entry.key === "companions.allowed")?.value ?? companionKey?.default;
  const [newPersonCompanionsAllowed, setNewPersonCompanionsAllowed] = useState<boolean | null>(null);
  const [companionsConfirm, setCompanionsConfirm] = useState<"household" | "new-person" | null>(null);
  const [companionsSaving, setCompanionsSaving] = useState(false);

  const actorRole = person.role as Role;
  // Always true here: the Users route's gate already restricts
  // this component to owner/admin, both of which canManagePeople (this
  // file's inherited-from-PeoplePage.tsx name for "can create anyone at
  // all") always returns true for - a code review (2026-09-06) found the
  // `canManage ? ... : []`/`canManage &&` branches below were dead,
  // unreachable-false conditionals left over from when this rendered for
  // every role inline on PeoplePage.tsx.
  const deletable = (roster ?? []).filter((p) =>
    canDeletePerson(actorRole, person.id, { id: p.id, role: p.role as Role }),
  );

  const selectMode = useSelectMode(deletable.map((p) => p.id));

  function leaveSelectMode() {
    selectMode.exit();
    setConfirmingBatch(false);
  }

  async function handleAdd(values: NewPersonValues) {
    setFormError(null);
    setSubmitting(true);
    try {
      const created = await api.createPerson({
        displayName: values.displayName,
        role: values.role,
        ...(values.role === "guest" ? { controls: values.controls } : {}),
        secret: values.secret,
      });
      const allowed = newPersonCompanionsAllowed ?? Boolean(householdCompanionsAllowed);
      if (allowed !== Boolean(householdCompanionsAllowed)) await api.setSetting(`person:${created.id}`, "companions.allowed", allowed);
      await invalidateRoster();
      setAddOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError && /profile requires a secret/i.test(err.message)
        ? i18n._({ id: "This role requires a PIN or password. Enter one above, then try again.", message: "This role requires a PIN or password. Enter one above, then try again." })
        : errorLine(err, i18n._({ id: "Could not add that person. Check your connection and try again.", message: "Could not add that person. Check your connection and try again." })));
      throw err;
    } finally {
      setSubmitting(false);
    }
  }

  async function setHouseholdCompanionsAllowed(allowed: boolean) {
    if (!allowed) { setCompanionsConfirm("household"); return; }
    setCompanionsSaving(true);
    try {
      const updated = await api.setSetting("household", "companions.allowed", true);
      queryClient.setQueryData<typeof householdSettingsQuery.data>(["settings-values", "household", "companions.allowed"], (rows) => (rows ?? []).map((row) => row.key === updated.key ? updated : row));
    } catch (err) {
      setActionError(errorLine(err, i18n._({ id: "Could not save the AI companions setting. Check your connection and try again.", message: "Could not save the AI companions setting. Check your connection and try again." })));
    } finally { setCompanionsSaving(false); }
  }

  async function confirmCompanionsOff() {
    if (!companionsConfirm) return;
    const target = companionsConfirm;
    setCompanionsConfirm(null);
    if (target === "new-person") { setNewPersonCompanionsAllowed(false); return; }
    setCompanionsSaving(true);
    try {
      const updated = await api.setSetting("household", "companions.allowed", false);
      queryClient.setQueryData<typeof householdSettingsQuery.data>(["settings-values", "household", "companions.allowed"], (rows) => (rows ?? []).map((row) => row.key === updated.key ? updated : row));
    } catch (err) {
      setActionError(errorLine(err, i18n._({ id: "Could not save the AI companions setting. Check your connection and try again.", message: "Could not save the AI companions setting. Check your connection and try again." })));
    } finally { setCompanionsSaving(false); }
  }

  async function handleDeleteSelected() {
    setBusy(true);
    setActionError(null);
    try {
      const { outcomes } = await api.deletePeople([...selectMode.selected]);
      // Partial success is reported, never swallowed (docs/UI.md > Batch
      // actions): four of five removed and one refused has to say which
      // and why, or a parent is left guessing what happened.
      const refused = outcomes.filter((o) => !o.deleted);
      if (refused.length > 0) {
        const names = refused.map((o) => (roster ?? []).find((p) => p.id === o.id)?.display_name ?? i18n._({ id: "someone", message: "someone" }));
        setActionError(i18n._({ id: "{names} could not be removed: {reason}", message: "{names} could not be removed: {reason}", values: { names: names.join(", "), reason: refused[0]?.reason ?? i18n._({ id: "not allowed", message: "not allowed" }) } }));
      }
      leaveSelectMode();
      await invalidateRoster();
    } catch (err) {
      setActionError(errorLine(err, i18n._({ id: "Could not remove those people. Check your connection and try again.", message: "Could not remove those people. Check your connection and try again." })));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {actionError ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={actionError} /> : null}

      <AsyncState
        data={roster}
        error={rosterQuery.isError}
        isFetching={rosterQuery.isFetching}
        onRetry={() => rosterQuery.refetch()}
        errorMessage={i18n._({ id: "Could not load the household. Check your connection and try again.", message: "Could not load the household. Check your connection and try again." })}
        loadingLabel={i18n._({ id: "Loading household", message: "Loading household" })}
      >
        {(loadedRoster) => (
        <div className="flex flex-col gap-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="text-section">{i18n._({ id: "Users", message: "Users" })}</h2>
              <p className="text-supporting text-muted-foreground">{i18n._({ id: "Who lives here, what they can do and what they can see.", message: "Who lives here, what they can do and what they can see." })}</p>
            </div>
            <Button onClick={() => setAddOpen(true)}>{i18n._({ id: "Add user", message: "Add user" })}</Button>
          </div>

          <div className="flex flex-col gap-4">
            <CardGrid
              items={loadedRoster}
              getKey={(p) => p.id}
              label={i18n._({ id: "Household", message: "Household" })}
              emptyState={{ icon: "users", text: i18n._({ id: "No one is here yet. Choose Add user to add the first person.", message: "No one is here yet. Choose Add user to add the first person." }) }}
              getLabel={(p) => p.id === person.id ? i18n._({ id: "{name}, you", message: "{name}, you", values: { name: p.display_name } }) : i18n._({ id: "{name}, {role}", message: "{name}, {role}", values: { name: p.display_name, role: ROLE_LABELS[p.role] } })}
              isSelected={(p) => selectMode.active && selectMode.isSelected(p.id)}
              onSelect={(p) => {
                if (selectMode.active) {
                  if (canDeletePerson(actorRole, person.id, { id: p.id, role: p.role as Role })) selectMode.toggle(p.id);
                  return;
                }
                if (p.id === person.id) navigate(`/people/${encodeURIComponent(p.id)}`);
                else onOpenPerson(p.id);
              }}
              renderItem={(p) => {
                const line = statusLine(p, person.id);
                return (
                  <div className="flex min-w-0 items-center gap-4 p-4">
                    <Avatar name={p.display_name} seed={p.avatar_seed} size="profile" accent={p.accent ?? undefined} className="shrink-0" />
                    <div className="flex min-w-0 flex-col items-start gap-1">
                      <span className="w-full truncate text-body font-medium">{p.display_name}</span>
                      <Badge variant="secondary">{ROLE_LABELS[p.role]}</Badge>
                      {line ? <span className="text-supporting text-muted-foreground">{line}</span> : null}
                    </div>
                  </div>
                );
              }}
            />
            {deletable.length > 0 ? (
              selectMode.active ? (
                <BatchBar count={selectMode.count} onExit={leaveSelectMode}>
                  <Button variant="destructive" disabled={selectMode.count === 0} onClick={() => setConfirmingBatch(true)}>
                    {i18n._({ id: "Remove selected", message: "Remove selected" })}
                  </Button>
                </BatchBar>
              ) : (
                <div className="flex"><SelectModeToggle label={i18n._({ id: "Select people", message: "Select people" })} onClick={selectMode.enter} /></div>
              )
            ) : null}

            {confirmingBatch ? (
              <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-destructive p-3">
                <p className="text-body font-medium">{i18n._({ id: "{count, plural, one {Remove # person from your household?} other {Remove # people from your household?}}", message: "{count, plural, one {Remove # person from your household?} other {Remove # people from your household?}}", values: { count: selectMode.count } })}</p>
                <p className="text-body text-muted-foreground">
                  {i18n._({ id: "Everything MaiPai remembers about them, every conversation they had, their settings and any voice they recorded will be deleted. So will any files only they could see; files they shared stay with the household. To save someone's files first, remove them one at a time. This cannot be undone.", message: "Everything MaiPai remembers about them, every conversation they had, their settings and any voice they recorded will be deleted. So will any files only they could see; files they shared stay with the household. To save someone's files first, remove them one at a time. This cannot be undone." })}
                </p>
                <p className="text-body text-muted-foreground">
                  {i18n._({ id: "Older backups still hold their data for up to three months, until those backups age out. Restoring a whole older backup would bring them back. The hub's logs still mention them, without anything they said, for 7 days.", message: "Older backups still hold their data for up to three months, until those backups age out. Restoring a whole older backup would bring them back. The hub's logs still mention them, without anything they said, for 7 days." })}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="destructive" onClick={handleDeleteSelected} disabled={busy}>
                    {busy ? i18n._({ id: "Removing…", message: "Removing…" }) : i18n._({ id: "Yes, remove {count}", message: "Yes, remove {count}", values: { count: selectMode.count } })}
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirmingBatch(false)}>
                    {i18n._({ id: "Keep them", message: "Keep them" })}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          {companionKey ? <Field>
            <FieldLabel htmlFor="household-companions-allowed"><Switch size="md" id="household-companions-allowed" checked={Boolean(householdCompanionsAllowed)} disabled={companionsSaving} onCheckedChange={(checked) => setHouseholdCompanionsAllowed(checked === true)} />{i18n._({ id: "AI companions for everyone", message: "AI companions for everyone" })}</FieldLabel>
            <FieldDescription>{companionKey.help}</FieldDescription>
          </Field> : null}
        </div>
        )}
      </AsyncState>

      {roster?.filter((p) => p.age_band === "child").map((p) => (
        <PlainSection key={`memories-${p.id}`} heading={i18n._({ id: "Memories for {name}", message: "Memories for {name}", values: { name: p.display_name } })}>
          <OtherPersonMemories personId={p.id} personName={p.display_name} />
        </PlainSection>
      ))}

      {roster ? (
        <SiteBlocksSection
          roster={roster.filter((p) => (p.role === "child" || p.role === "teen") && p.id !== person.id)}
        />
      ) : null}

      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) setFormError(null); }}>
        <DialogContent scroll="viewport">
          <DialogHeader>
            <DialogTitle>{i18n._({ id: "Add user", message: "Add user" })}</DialogTitle>
            <DialogDescription>{i18n._({ id: "Add someone to your household.", message: "Add someone to your household." })}</DialogDescription>
          </DialogHeader>
          <NewPersonForm actorRole={actorRole} onSubmit={handleAdd} submitLabel={i18n._({ id: "Add to household", message: "Add to household" })} busy={submitting} error={formError} extra={companionKey ? <Field>
            <FieldLabel htmlFor="new-person-companions-allowed"><Checkbox id="new-person-companions-allowed" checked={newPersonCompanionsAllowed ?? Boolean(householdCompanionsAllowed)} disabled={submitting} onCheckedChange={(checked) => { if (checked === true) setNewPersonCompanionsAllowed(true); else setCompanionsConfirm("new-person"); }} />{companionKey.label}</FieldLabel>
            <FieldDescription>{companionKey.help}</FieldDescription>
          </Field> : null} />
        </DialogContent>
      </Dialog>
      <AlertDialog open={companionsConfirm !== null} onOpenChange={(open) => { if (!open) setCompanionsConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{companionKey?.label}</AlertDialogTitle><AlertDialogDescription>{i18n._({ id: "The person may have grown attached to their AI companions. Turn them off with care. Their companion and personality data will be kept.", message: "The person may have grown attached to their AI companions. Turn them off with care. Their companion and personality data will be kept." })}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{i18n._({ id: "Cancel", message: "Cancel" })}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { void confirmCompanionsOff(); }}>{i18n._({ id: "Turn off", message: "Turn off" })}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
