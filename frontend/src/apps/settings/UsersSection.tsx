import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Section } from "@maipai/ui/src/primitives/Section";
import { List } from "@maipai/ui/src/primitives/List";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { Input } from "@maipai/ui/src/ui/input";
import { Select } from "@maipai/ui/src/primitives/Select";
import { Button } from "@maipai/ui/src/ui/button";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Switch } from "@maipai/ui/src/dashboard/components/ui/switch";
import { Field, FieldDescription, FieldLabel } from "@maipai/ui/src/dashboard/components/ui/field";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { BatchBar, SelectModeToggle } from "@maipai/ui/src/primitives/BatchBar";
import { useSelectMode } from "@/kit/hooks/useSelectMode";
import { SiteBlocksSection } from "./SiteBlocksSection";
import { NewPersonForm, type NewPersonValues } from "@/apps/people/NewPersonForm";
import { api, ApiError, type PersonDeletionPreview, type PersonRosterEntry, type Role, type Roster } from "@/lib/api";
import { ROLE_LABELS, canDeletePerson, canManagePerson, creatableRoles } from "@/apps/people/roles";
import { SettingsRenderer } from "@/shell/pages/settings/SettingsRenderer";
import { OtherPersonMemories } from "@/apps/memory/PersonMemories";

interface UsersSectionProps {
  person: Roster;
}

// Moved from PeoplePage.tsx (Jesse, 2026-09-06: "the edit part is for
// USERS, not people" - roster management is an admin/account concern,
// not the social "who's in my household" directory PeoplePage.tsx is
// becoming). Nested under Settings -> Household via UsersPage.tsx
// (App.tsx's route, AdminGatedContent's gate) - the People page itself
// stays a plain, everyone-readable roster with none of this.
//
// Deleting a person is the most destructive thing in the product: it
// erases their memories, their conversations, their settings and their
// recordings for real (backend/src/lib/personLifecycle.ts). So it gets a
// confirmation that names them and says what goes, never a bare button,
// and the batch version names the count.
export function UsersSection({ person }: UsersSectionProps) {
  const queryClient = useQueryClient();
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
  const [actionError, setActionError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<Role>("adult");
  const [editSessionLockRequired, setEditSessionLockRequired] = useState(false);
  const [editSessionLockTimeoutMinutes, setEditSessionLockTimeoutMinutes] = useState(5);

  const [confirmingDelete, setConfirmingDelete] = useState<"batch" | string | null>(null);
  const [busy, setBusy] = useState(false);
  const settingsRegistryQuery = useQuery({ queryKey: ["settings-registry"], queryFn: () => api.settingsRegistry(), staleTime: Infinity });
  const householdSettingsQuery = useQuery({ queryKey: ["settings-values", "household", "companions.allowed"], queryFn: () => api.settingsValues("household", "companions.allowed") });
  const companionKey = settingsRegistryQuery.data?.find((entry) => entry.key === "companions.allowed");
  const householdCompanionsAllowed = householdSettingsQuery.data?.find((entry) => entry.key === "companions.allowed")?.value ?? companionKey?.default;
  const [newPersonCompanionsAllowed, setNewPersonCompanionsAllowed] = useState<boolean | null>(null);
  const [companionsConfirm, setCompanionsConfirm] = useState<"household" | "new-person" | null>(null);
  const [companionsSaving, setCompanionsSaving] = useState(false);

  // STORE-DELETE-01 (decision 5): the export is offered before a person's
  // files are purged, so the single-person confirmation reads what would
  // happen to their files first.
  const confirmingPersonId = confirmingDelete && confirmingDelete !== "batch" ? confirmingDelete : null;
  const previewQuery = useQuery<PersonDeletionPreview>({
    queryKey: ["person-deletion-preview", confirmingPersonId],
    queryFn: () => api.personDeletionPreview(confirmingPersonId!),
    enabled: confirmingPersonId !== null,
  });

  const actorRole = person.role as Role;
  // Always true here: UsersPage.tsx's AdminGatedContent already restricts
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
    setConfirmingDelete(null);
  }

  async function handleAdd(values: NewPersonValues) {
    setFormError(null);
    setSubmitting(true);
    try {
      const created = await api.createPerson({
        displayName: values.displayName,
        role: values.role,
        secret: values.secret,
      });
      const allowed = newPersonCompanionsAllowed ?? Boolean(householdCompanionsAllowed);
      if (allowed !== Boolean(householdCompanionsAllowed)) await api.setSetting(`person:${created.id}`, "companions.allowed", allowed);
      await invalidateRoster();
    } catch (err) {
      setFormError(err instanceof ApiError && /profile requires a secret/i.test(err.message)
        ? "This role requires a PIN or password. Enter one above, then try again."
        : err instanceof ApiError ? err.message : "Could not add that person.");
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
      setActionError(err instanceof ApiError ? err.message : "Could not save the AI companions setting.");
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
      setActionError(err instanceof ApiError ? err.message : "Could not save the AI companions setting.");
    } finally { setCompanionsSaving(false); }
  }

  async function handleSaveEdit(id: string) {
    setBusy(true);
    setActionError(null);
    try {
      const target = (roster ?? []).find((p) => p.id === id);
      await api.updatePerson(id, {
        displayName: editName,
        // Only sent when it actually changed: the backend refuses a role
        // change from anyone but the owner, and sending an unchanged role
        // would turn a rename by an admin into a 403.
        role: target && editRole !== target.role ? editRole : undefined,
        // INCOGNITO-07: same "only send what changed" reasoning, though
        // here it's not an authorization concern (UsersSection only ever
        // renders for an owner/admin actor, and the backend re-checks
        // regardless) - just avoids a no-op write on every edit.
        sessionLockRequired: target && editSessionLockRequired !== target.sessionLockRequired ? editSessionLockRequired : undefined,
        sessionLockTimeoutMinutes:
          target && editSessionLockTimeoutMinutes !== target.sessionLockTimeoutMinutes ? editSessionLockTimeoutMinutes : undefined,
      });
      setEditingId(null);
      await invalidateRoster();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not save those changes.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteOne(id: string) {
    setBusy(true);
    setActionError(null);
    try {
      await api.deletePerson(id);
      setConfirmingDelete(null);
      await invalidateRoster();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not remove that person.");
    } finally {
      setBusy(false);
    }
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
        const names = refused.map((o) => (roster ?? []).find((p) => p.id === o.id)?.display_name ?? "someone");
        setActionError(`${names.join(", ")} could not be removed: ${refused[0]?.reason ?? "not allowed"}`);
      }
      leaveSelectMode();
      await invalidateRoster();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not remove those people.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {actionError ? <p className="text-base text-destructive">{actionError}</p> : null}

      <AsyncState
        data={roster}
        error={rosterQuery.isError}
        isFetching={rosterQuery.isFetching}
        onRetry={() => rosterQuery.refetch()}
        errorMessage="Could not load the household."
        loadingLabel="Loading household"
      >
        {(loadedRoster) => (
        <Section heading="Users">
          {companionKey ? <Field>
            <FieldLabel htmlFor="household-companions-allowed"><Switch size="md" id="household-companions-allowed" checked={Boolean(householdCompanionsAllowed)} disabled={companionsSaving} onCheckedChange={(checked) => setHouseholdCompanionsAllowed(checked === true)} />{companionKey.label}</FieldLabel>
            <FieldDescription>{companionKey.help}</FieldDescription>
          </Field> : null}
          {deletable.length > 0 ? (
            selectMode.active ? (
              <BatchBar count={selectMode.count} onExit={leaveSelectMode}>
                <Button
                  variant="destructive"
                  disabled={selectMode.count === 0}
                  onClick={() => setConfirmingDelete("batch")}
                >
                  Remove selected
                </Button>
              </BatchBar>
            ) : (
              <SelectModeToggle label="Select people" onClick={selectMode.enter} />
            )
          ) : null}

          {confirmingDelete === "batch" ? (
            <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-destructive p-3">
              <p className="text-base font-medium">
                Remove {selectMode.count} {selectMode.count === 1 ? "person" : "people"} from your household?
              </p>
              <p className="text-base text-muted-foreground">
                Everything MaiPai remembers about them, every conversation they had, their settings and any voice
                they recorded will be deleted. So will any files only they could see; files they shared stay with
                the household. To save someone&apos;s files first, remove them one at a time. This cannot be undone.
              </p>
              <p className="text-base text-[var(--muted-foreground)]">
                Older backups still hold their data for up to three months, until those backups age out. Restoring a whole older backup would bring them back. The hub&apos;s logs still mention them, without anything they said, for 7 days.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" onClick={handleDeleteSelected} disabled={busy}>
                  {busy ? "Removing…" : `Yes, remove ${selectMode.count}`}
                </Button>
                <Button variant="secondary" onClick={() => setConfirmingDelete(null)}>
                  Keep them
                </Button>
              </div>
            </div>
          ) : null}

          <List
            items={loadedRoster}
            getKey={(p) => p.id}
            label="Household"
            renderItem={(p) => {
              if (editingId === p.id) {
                return (
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 py-1">
                    <div className="w-full max-w-48">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        aria-label={`Name for ${p.display_name}`}
                      />
                    </div>
                    {actorRole === "owner" && p.id !== person.id ? (
                      <Select
                        value={editRole}
                        onValueChange={(v) => setEditRole(v as Role)}
                        options={creatableRoles("owner")}
                        getLabel={(v) => ROLE_LABELS[v as Role]}
                        aria-label={`Role for ${p.display_name}`}
                      />
                    ) : null}
                    {/* INCOGNITO-07: admin-configurable per account, any
                        role (assertCanSetSessionLock's own wider reach
                        than the generic person-scope gate) - shown for
                        every row here since UsersSection only ever
                        renders for an owner/admin actor. */}
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Checkbox
                        checked={editSessionLockRequired}
                        onCheckedChange={(checked) => setEditSessionLockRequired(checked === true)}
                        aria-label={`Require session lock for ${p.display_name}`}
                      />
                      Require PIN lock
                    </span>
                    {editSessionLockRequired ? (
                      <div className="w-20 shrink-0">
                        <Input
                          type="number"
                          min={1}
                          max={120}
                          value={editSessionLockTimeoutMinutes}
                          onChange={(e) => setEditSessionLockTimeoutMinutes(Number(e.target.value))}
                          aria-label={`Session lock timeout, minutes, for ${p.display_name}`}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              }
              if (confirmingDelete === p.id) {
                return (
                  <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
                    <p className="text-base font-medium">Remove {p.display_name} from your household?</p>
                    <p className="text-base text-muted-foreground">
                      Everything MaiPai remembers about {p.display_name}, every conversation they had, their
                      settings and any voice they recorded will be deleted. This cannot be undone.
                    </p>
                    <p className="text-base text-[var(--muted-foreground)]">
                      Older backups still hold their data for up to three months, until those backups age out. Restoring a whole older backup would bring them back. The hub&apos;s logs still mention them, without anything they said, for 7 days.
                    </p>
                    <DeletionFilesNote name={p.display_name} preview={previewQuery.data} failed={previewQuery.isError} />
                  </div>
                );
              }
              return (
                <div className="flex min-w-0 flex-1 flex-col items-stretch gap-2 py-2 break-words">
                  <div className="flex min-w-0 flex-wrap items-center gap-3">
                    {selectMode.active && canDeletePerson(actorRole, person.id, { id: p.id, role: p.role as Role }) ? (
                      // The box stays its designed 16px; `kit/ui/checkbox.tsx`
                      // already carries its own 48px hit area (docs/UI.md's
                      // floor - the fix a code review (2026-09-05) applied
                      // here before Checkbox existed, now the kit's own), so
                      // no wrapping div is needed to reach it (a second code
                      // review, same night, caught one left behind here).
                      <Checkbox
                        checked={selectMode.isSelected(p.id)}
                        onCheckedChange={() => selectMode.toggle(p.id)}
                        aria-label={`Select ${p.display_name}`}
                        className="shrink-0"
                      />
                    ) : null}
                    <Avatar name={p.display_name} className="h-10 w-10 shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col break-words">
                      <span className="truncate text-base">{p.display_name}</span>
                      <span className="text-sm text-muted-foreground">{ROLE_LABELS[p.role]}</span>
                    </div>
                  </div>
                  <SettingsRenderer scope="person" scopeValue={`person:${p.id}`} settingKey="companions.allowed" only={["person.companions"]} plainRows />
                </div>
              );
            }}
            renderAction={(p) => {
              if (editingId === p.id) {
                return (
                  <div className="flex gap-2">
                    <Button onClick={() => handleSaveEdit(p.id)} disabled={busy}>
                      Save
                    </Button>
                    <Button variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                );
              }
              if (confirmingDelete === p.id) {
                return (
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      onClick={() => handleDeleteOne(p.id)}
                      // The export is offered before the files go, so the
                      // delete waits for the preview that offers it.
                      disabled={busy || previewQuery.isPending}
                    >
                      {busy ? "Removing…" : "Yes, remove"}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmingDelete(null)}>
                      Keep them
                    </Button>
                  </div>
                );
              }
              if (selectMode.active) return null;
              const mayEdit = canManagePerson(actorRole, person.id, { id: p.id, role: p.role as Role });
              const mayDelete = canDeletePerson(actorRole, person.id, { id: p.id, role: p.role as Role });
              if (!mayEdit && !mayDelete) return null;
              return (
                <div className="flex flex-col items-stretch gap-1">
                  {mayEdit ? (
                    <Button
                      variant="ghost"
                      aria-label={`Edit ${p.display_name}`}
                      onClick={() => {
                        setEditingId(p.id);
                        setEditName(p.display_name);
                        setEditRole(p.role as Role);
                        setEditSessionLockRequired(p.sessionLockRequired);
                        setEditSessionLockTimeoutMinutes(p.sessionLockTimeoutMinutes);
                      }}
                    >
                      Edit
                    </Button>
                  ) : null}
                  {mayDelete ? (
                    <Button
                      variant="ghost"
                      aria-label={`Remove ${p.display_name}`}
                      onClick={() => setConfirmingDelete(p.id)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              );
            }}
          />
        </Section>
        )}
      </AsyncState>

      {roster?.filter((p) => p.age_band === "child").map((p) => (
        <Section key={`memories-${p.id}`} heading={`Memories for ${p.display_name}`}>
          <OtherPersonMemories personId={p.id} personName={p.display_name} />
        </Section>
      ))}

      {roster ? (
        <SiteBlocksSection
          roster={roster.filter((p) => (p.role === "child" || p.role === "teen") && p.id !== person.id)}
        />
      ) : null}

      <Section heading="Add someone">
        <NewPersonForm actorRole={actorRole} onSubmit={handleAdd} submitLabel="Add to household" busy={submitting} error={formError} extra={companionKey ? <Field>
          <FieldLabel htmlFor="new-person-companions-allowed"><Checkbox id="new-person-companions-allowed" checked={newPersonCompanionsAllowed ?? Boolean(householdCompanionsAllowed)} disabled={submitting} onCheckedChange={(checked) => { if (checked === true) setNewPersonCompanionsAllowed(true); else setCompanionsConfirm("new-person"); }} />{companionKey.label}</FieldLabel>
          <FieldDescription>{companionKey.help}</FieldDescription>
        </Field> : null} />
        <AlertDialog open={companionsConfirm !== null} onOpenChange={(open) => { if (!open) setCompanionsConfirm(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>{companionKey?.label}</AlertDialogTitle><AlertDialogDescription>The person may have grown attached to their AI companions. Turn them off with care. Their companion and personality data will be kept.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { void confirmCompanionsOff(); }}>Turn off</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Section>
    </>
  );
}

/** What happens to a person's files when they are removed, and the export
 * offered first (STORE-DELETE-01). Only shown once the preview loads; the
 * download link appears only for someone allowed to export them (yourself,
 * or a parent for a child), never an adult's private files to an admin. */
function DeletionFilesNote({ name, preview, failed }: { name: string; preview: PersonDeletionPreview | undefined; failed: boolean }) {
  if (failed) {
    return (
      <p className="text-base text-destructive">
        Could not check {name}&apos;s files. Their files will be deleted with them unless someone else can see them.
      </p>
    );
  }
  if (!preview) return null;
  const { purged, keptForHousehold } = preview.files;
  if (purged.files === 0 && keptForHousehold.files === 0) return null;
  const files = (n: number) => `${n} ${n === 1 ? "file" : "files"}`;
  return (
    <div className="flex flex-col gap-2">
      {purged.files > 0 ? (
        <p className="text-base text-muted-foreground">
          {files(purged.files)} only {name} could see will be deleted too.{" "}
          {preview.export.url ? "Download them first if you want to keep them." : `Only ${name} can download their own files, so ask them to save anything they want to keep before you remove them.`}
        </p>
      ) : null}
      {keptForHousehold.files > 0 ? (
        <p className="text-base text-muted-foreground">
          {files(keptForHousehold.files)} other people can still see will stay, kept by the household.
        </p>
      ) : null}
      {purged.files > 0 && preview.export.url ? (
        <Button asChild variant="secondary" className="self-start">
          <a href={preview.export.url} download>
            Download {name}&apos;s files
          </a>
        </Button>
      ) : null}
    </div>
  );
}

