import { useEffect, useState, type FormEvent } from "react";
import type { Person } from "@maipai/spec/gen/ts/person.js";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { DialogFooter } from "@maipai/ui/src/dashboard/components/ui/dialog";
import { Input } from "@maipai/ui/src/dashboard/components/ui/input";
import { Label } from "@maipai/ui/src/dashboard/components/ui/label";
import { Switch } from "@maipai/ui/src/dashboard/components/ui/switch";
import { Textarea } from "@maipai/ui/src/dashboard/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/dashboard/components/ui/select";
import { api, ApiError, type PersonRosterEntry, type Roster } from "@/lib/api";
import { ACCENT_SELECT_LABELS, ACCENT_SELECT_OPTIONS, NO_ACCENT } from "@/apps/people/roles";

export type ProfileFormPerson = PersonRosterEntry | Roster;

export interface ProfileFormProps {
  person: ProfileFormPerson;
  canEdit: boolean;
  onSaved?: (person: PersonRosterEntry) => void | Promise<void>;
  onCancel?: () => void;
  layout?: "dialog" | "page";
}

export function ProfileForm({ person, canEdit, onSaved, onCancel, layout = "dialog" }: ProfileFormProps) {
  const [displayName, setDisplayName] = useState(person.display_name);
  const [bio, setBio] = useState(person.bio ?? "");
  const [accent, setAccent] = useState<string>(person.accent ?? NO_ACCENT);
  const [photoOptIn, setPhotoOptIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const trimmedName = displayName.trim();
  const bioTooLong = bio.length > 160;
  const canSave = canEdit && trimmedName.length > 0 && !bioTooLong && !submitting;
  const isSupervised = person.role === "child";

  useEffect(() => {
    setDisplayName(person.display_name);
    setBio(person.bio ?? "");
    setAccent(person.accent ?? NO_ACCENT);
    setPhotoOptIn(false);
    setError(null);
  }, [person.id, person.display_name, person.bio, person.accent]);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setError(null);
    setSubmitting(true);
    try {
      const edit: { displayName?: string; bio?: string | null; accent?: Person["accent"] } = {};
      if (trimmedName !== person.display_name) edit.displayName = trimmedName;
      const nextBio = bio.trim() || null;
      if (nextBio !== (person.bio ?? null)) edit.bio = nextBio;
      const nextAccent = accent === NO_ACCENT ? null : accent as Person["accent"];
      if (nextAccent !== (person.accent ?? null)) edit.accent = nextAccent;
      if (Object.keys(edit).length > 0) {
        const saved = await api.updatePerson(person.id, edit);
        await onSaved?.(saved);
      }
      if (layout === "dialog") onCancel?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save those changes.");
    } finally {
      setSubmitting(false);
    }
  }

  const body = (
    <form onSubmit={handleSave} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-display-name">Name</Label>
        <Input id="profile-display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={!canEdit || submitting} />
        {!canEdit ? <p className="text-sm text-muted-foreground">Ask an admin to change this.</p> : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-bio">Bio</Label>
        <Textarea id="profile-bio" value={bio} onChange={(event) => setBio(event.target.value)} maxLength={160} placeholder="A line about you" disabled={!canEdit || submitting} aria-invalid={bioTooLong} />
        <p className="text-sm text-muted-foreground">{bio.length}/160</p>
        {bioTooLong ? <p className="text-sm text-destructive">Bio must be 160 characters or less.</p> : null}
        {!canEdit ? <p className="text-sm text-muted-foreground">Ask an admin to change this.</p> : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label>Accent color</Label>
        <Select value={accent} onValueChange={(value) => { if (value !== null) setAccent(value); }} disabled={!canEdit || submitting}>
          <SelectTrigger aria-label="Accent color"><SelectValue>{ACCENT_SELECT_LABELS[accent] ?? accent}</SelectValue></SelectTrigger>
          <SelectContent>{[...ACCENT_SELECT_OPTIONS].map((value) => <SelectItem key={value} value={value}>{ACCENT_SELECT_LABELS[value] ?? value}</SelectItem>)}</SelectContent>
        </Select>
        {!canEdit ? <p className="text-sm text-muted-foreground">Ask an admin to change this.</p> : null}
      </div>
      <div className="flex flex-col gap-2 rounded-lg border p-3">
        <div className="flex items-center justify-between gap-3"><Label htmlFor="profile-photo-opt-in">Use a real photo</Label><Switch id="profile-photo-opt-in" checked={photoOptIn} onCheckedChange={setPhotoOptIn} disabled={!canEdit || submitting} /></div>
        {photoOptIn ? <p className="text-sm text-muted-foreground">{isSupervised ? `An admin needs to approve a real photo for ${person.display_name} before it shows anywhere.` : "Photo uploads aren't wired up yet. This will use MaiPai Home's own storage once it ships."}</p> : null}
        {!canEdit ? <p className="text-sm text-muted-foreground">Ask an admin to change this.</p> : null}
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {canEdit ? layout === "dialog" ? (
        <DialogFooter>
          <Button type="submit" disabled={!canSave}>{submitting ? "Saving…" : "Save"}</Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>Cancel</Button>
        </DialogFooter>
      ) : (
        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={!canSave}>{submitting ? "Saving…" : "Save"}</Button>
          {onCancel ? <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>Cancel</Button> : null}
        </div>
      ) : null}
    </form>
  );

  if (layout === "dialog") return body;
  return (
    <Card>
      <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
