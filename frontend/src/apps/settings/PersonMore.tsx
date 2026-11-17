import { i18n } from "@lingui/core";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Input } from "@maipai/ui/src/ui/input";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { SettingsRenderer } from "@/shell/pages/settings/SettingsRenderer";
import { api, type PersonDeletionPreview, type PersonRosterEntry, type Role, type Roster } from "@/lib/api";
import { canDeletePerson, canManagePerson } from "@/apps/people/roles";
import { errorLine } from "@/lib/hubReachability";

/** The "Companions" section of one person's page: their AI companions switch, the same setting and write path the Users list used to repeat per row. */
export function PersonCompanions({ target }: { target: PersonRosterEntry }) {
  return <section className="flex flex-col gap-3" aria-labelledby="person-companions">
    <h3 id="person-companions" className="text-section">{i18n._({ id: "Companions", message: "Companions" })}</h3>
    <SettingsRenderer scope="person" scopeValue={`person:${target.id}`} settingKey="companions.allowed" only={["person.companions"]} plainRows labelOverrides={{ "companions.allowed": i18n._({ id: "AI companions for {name}", message: "AI companions for {name}", values: { name: target.display_name } }) }} />
  </section>;
}

/** The quiet "More" section at the bottom of a person's page: change their name, require a PIN lock, remove them.
 * Moved from the Users list's row icons; the permission checks, the confirmation and the files note are unchanged.
 * Removing someone is the most destructive thing here: it names them and says what goes before anything is deleted. */
export function PersonMore({ viewer, target, onRemoved }: { viewer: Pick<Roster, "id" | "role">; target: PersonRosterEntry; onRemoved: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(target.display_name);
  const [lockRequired, setLockRequired] = useState(target.sessionLockRequired);
  const [lockMinutes, setLockMinutes] = useState(target.sessionLockTimeoutMinutes);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actor = viewer.role as Role;
  const subject = { id: target.id, role: target.role as Role };
  const mayEdit = canManagePerson(actor, viewer.id, subject);
  const mayDelete = canDeletePerson(actor, viewer.id, subject);
  // STORE-DELETE-01 (decision 5): the export is offered before a person's files are purged, so the confirmation reads what would happen to their files first.
  const preview = useQuery<PersonDeletionPreview>({ queryKey: ["person-deletion-preview", target.id], queryFn: () => api.personDeletionPreview(target.id), enabled: confirming });
  if (!mayEdit && !mayDelete) return null;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.updatePerson(target.id, {
        displayName: name,
        // Only what changed is sent, so an unchanged value is never a no-op write.
        sessionLockRequired: lockRequired !== target.sessionLockRequired ? lockRequired : undefined,
        sessionLockTimeoutMinutes: lockMinutes !== target.sessionLockTimeoutMinutes ? lockMinutes : undefined,
      });
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["people"] });
    } catch (reason) {
      setError(errorLine(reason, i18n._({ id: "Could not save those changes. Check your connection and try again.", message: "Could not save those changes. Check your connection and try again." })));
    } finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deletePerson(target.id);
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: ["people"] });
      onRemoved();
    } catch (reason) {
      setError(errorLine(reason, i18n._({ id: "Could not remove that person. Check your connection and try again.", message: "Could not remove that person. Check your connection and try again." })));
    } finally { setBusy(false); }
  }

  return <section className="flex flex-col gap-4 border-t pt-6" aria-labelledby="person-more">
    <h3 id="person-more" className="text-section text-muted-foreground">{i18n._({ id: "More", message: "More" })}</h3>
    {error ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={error} /> : null}
    {mayEdit ? (editing ? <div className="flex flex-col gap-3">
      <div className="w-full max-w-sm">
        <Input value={name} onChange={(event) => setName(event.target.value)} aria-label={i18n._({ id: "Name for {name}", message: "Name for {name}", values: { name: target.display_name } })} />
      </div>
      <label className="flex items-center gap-2 text-supporting text-muted-foreground">
        <Checkbox checked={lockRequired} onCheckedChange={(checked) => setLockRequired(checked === true)} aria-label={i18n._({ id: "Require session lock for {name}", message: "Require session lock for {name}", values: { name: target.display_name } })} />
        {i18n._({ id: "Require PIN lock", message: "Require PIN lock" })}
      </label>
      {lockRequired ? <div className="w-24">
        <Input type="number" min={1} max={120} value={lockMinutes} onChange={(event) => setLockMinutes(Number(event.target.value))} aria-label={i18n._({ id: "Session lock timeout, minutes, for {name}", message: "Session lock timeout, minutes, for {name}", values: { name: target.display_name } })} />
      </div> : null}
      <div className="flex gap-2">
        <Button onClick={() => void save()} disabled={busy}>{i18n._({ id: "Save", message: "Save" })}</Button>
        <Button variant="ghost" onClick={() => setEditing(false)}>{i18n._({ id: "Cancel", message: "Cancel" })}</Button>
      </div>
    </div> : <div>
      <Button variant="secondary" size="control" onClick={() => { setEditing(true); setName(target.display_name); setLockRequired(target.sessionLockRequired); setLockMinutes(target.sessionLockTimeoutMinutes); }}>
        {i18n._({ id: "Edit name and PIN lock", message: "Edit name and PIN lock" })}
      </Button>
    </div>) : null}
    {mayDelete ? (confirming ? <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-destructive p-3">
      <p className="text-body font-medium">{i18n._({ id: "Remove {display_name} from your household?", message: "Remove {display_name} from your household?", values: { display_name: target.display_name } })}</p>
      <p className="text-body text-muted-foreground">{i18n._({ id: "Everything MaiPai remembers about {display_name}, every conversation they had, their settings and any voice they recorded will be deleted. This cannot be undone.", message: "Everything MaiPai remembers about {display_name}, every conversation they had, their settings and any voice they recorded will be deleted. This cannot be undone.", values: { display_name: target.display_name } })}</p>
      <p className="text-body text-muted-foreground">{i18n._({ id: "Older backups still hold their data for up to three months, until those backups age out. Restoring a whole older backup would bring them back. The hub's logs still mention them, without anything they said, for 7 days.", message: "Older backups still hold their data for up to three months, until those backups age out. Restoring a whole older backup would bring them back. The hub's logs still mention them, without anything they said, for 7 days." })}</p>
      {preview.isError
        ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={i18n._({ id: "Could not check {name}'s files. Their files will be deleted with them unless someone else can see them.", message: "Could not check {name}'s files. Their files will be deleted with them unless someone else can see them.", values: { name: target.display_name } })} />
        : <DeletionFilesNote name={target.display_name} preview={preview.data} />}
      <div className="flex flex-wrap gap-2">
        {/* The export is offered before the files go, so the delete waits for the preview that offers it. */}
        <Button variant="destructive" onClick={() => void remove()} disabled={busy || preview.isPending}>
          {busy ? i18n._({ id: "Removing…", message: "Removing…" }) : i18n._({ id: "Yes, remove", message: "Yes, remove" })}
        </Button>
        <Button variant="ghost" onClick={() => setConfirming(false)}>{i18n._({ id: "Keep them", message: "Keep them" })}</Button>
      </div>
    </div> : <div>
      <Button variant="ghost" size="control" onClick={() => setConfirming(true)}>
        {i18n._({ id: "Remove {name}", message: "Remove {name}", values: { name: target.display_name } })}
      </Button>
    </div>) : null}
  </section>;
}

/** What happens to a person's files when they are removed, and the export
 * offered first (STORE-DELETE-01). Only shown once the preview loads; the
 * download link appears only for someone allowed to export them (yourself,
 * or a parent for a child), never an adult's private files to an admin. */
export function DeletionFilesNote({ name, preview }: { name: string; preview: PersonDeletionPreview | undefined }) {
  if (!preview) return null;
  const { purged, keptForHousehold } = preview.files;
  if (purged.files === 0 && keptForHousehold.files === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {purged.files > 0 ? (
        <p className="text-body text-muted-foreground">{preview.export.url
          ? i18n._({ id: "{count, plural, one {# file only {name} could see will be deleted too. Download it first if you want to keep it.} other {# files only {name} could see will be deleted too. Download them first if you want to keep them.}}", message: "{count, plural, one {# file only {name} could see will be deleted too. Download it first if you want to keep it.} other {# files only {name} could see will be deleted too. Download them first if you want to keep them.}}", values: { count: purged.files, name } })
          : i18n._({ id: "{count, plural, one {# file only {name} could see will be deleted too. Only {name} can download their own files, so ask them to save anything they want to keep before you remove them.} other {# files only {name} could see will be deleted too. Only {name} can download their own files, so ask them to save anything they want to keep before you remove them.}}", message: "{count, plural, one {# file only {name} could see will be deleted too. Only {name} can download their own files, so ask them to save anything they want to keep before you remove them.} other {# files only {name} could see will be deleted too. Only {name} can download their own files, so ask them to save anything they want to keep before you remove them.}}", values: { count: purged.files, name } })}</p>
      ) : null}
      {keptForHousehold.files > 0 ? (
        <p className="text-body text-muted-foreground">{i18n._({ id: "{count, plural, one {# file other people can still see will stay, kept by the household.} other {# files other people can still see will stay, kept by the household.}}", message: "{count, plural, one {# file other people can still see will stay, kept by the household.} other {# files other people can still see will stay, kept by the household.}}", values: { count: keptForHousehold.files } })}</p>
      ) : null}
      {purged.files > 0 && preview.export.url ? (
        <Button asChild variant="secondary" className="self-start">
          <a href={preview.export.url} download>{i18n._({ id: "Download {name}'s files", message: "Download {name}'s files", values: { name } })}</a>
        </Button>
      ) : null}
    </div>
  );
}

