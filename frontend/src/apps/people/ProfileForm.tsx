import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Person } from "@maipai/spec/gen/ts/person.js";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { DialogFooter } from "@maipai/ui/src/dashboard/components/ui/dialog";
import { Input } from "@maipai/ui/src/dashboard/components/ui/input";
import { Label } from "@maipai/ui/src/dashboard/components/ui/label";
import { Textarea } from "@maipai/ui/src/dashboard/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/dashboard/components/ui/select";
import { api, ApiError, type PersonRosterEntry, type Roster } from "@/lib/api";
import { ACCENT_SELECT_LABELS, ACCENT_SELECT_OPTIONS, NO_ACCENT } from "@/apps/people/roles";
import { registerRouteLeaveGuard } from "@/shell/routeLeaveGuard";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";

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
  const [savedValues, setSavedValues] = useState({
    displayName: person.display_name,
    bio: person.bio ?? null,
    accent: person.accent ?? null,
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const lastHistoryIndex = useRef<number>(window.history.state?.idx ?? 0);
  const restoringPopState = useRef(false);
  const trimmedName = displayName.trim();
  const nextBio = bio.trim() || null;
  const nextAccent = accent === NO_ACCENT ? null : accent as Person["accent"];
  const hasUnsavedChanges = trimmedName !== savedValues.displayName
    || nextBio !== savedValues.bio
    || nextAccent !== savedValues.accent;
  const bioTooLong = bio.length > 160;
  const canSave = canEdit && trimmedName.length > 0 && !bioTooLong && !submitting;

  useEffect(() => {
    setDisplayName(person.display_name);
    setBio(person.bio ?? "");
    setAccent(person.accent ?? NO_ACCENT);
    setSavedValues({
      displayName: person.display_name,
      bio: person.bio ?? null,
      accent: person.accent ?? null,
    });
    setError(null);
    setSaved(false);
  }, [person.id, person.display_name, person.bio, person.accent]);

  useEffect(() => {
    if (layout !== "page" || !hasUnsavedChanges) return;
    const unregister = registerRouteLeaveGuard(() => window.confirm("Leave without saving?"));
    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      const currentHref = window.location.origin === "null" ? "http://localhost/" : window.location.href;
      const destination = new URL(href, currentHref);
      if (destination.href === currentHref) return;
      if (!window.confirm("Leave without saving?")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      window.setTimeout(() => {
        lastHistoryIndex.current = Number(window.history.state?.idx ?? lastHistoryIndex.current);
      }, 0);
    };
    const handlePopState = (event: PopStateEvent) => {
      const currentIndex = Number(window.history.state?.idx ?? lastHistoryIndex.current);
      if (restoringPopState.current) {
        restoringPopState.current = false;
        lastHistoryIndex.current = currentIndex;
        return;
      }
      if (!window.confirm("Leave without saving?")) {
        event.stopImmediatePropagation();
        const delta = lastHistoryIndex.current - currentIndex;
        if (delta !== 0) {
          restoringPopState.current = true;
          window.history.go(delta);
        }
      } else {
        lastHistoryIndex.current = currentIndex;
      }
    };
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("click", handleClick, true);
    window.addEventListener("popstate", handlePopState, true);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("popstate", handlePopState, true);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      unregister();
    };
  }, [hasUnsavedChanges, layout]);

  function updateDraft(update: () => void) {
    setSaved(false);
    setError(null);
    update();
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setError(null);
    setSaved(false);
    setSubmitting(true);
    try {
      const edit: { displayName?: string; bio?: string | null; accent?: Person["accent"] } = {};
      if (trimmedName !== savedValues.displayName) edit.displayName = trimmedName;
      if (nextBio !== savedValues.bio) edit.bio = nextBio;
      if (nextAccent !== savedValues.accent) edit.accent = nextAccent;
      let savedPerson: PersonRosterEntry | null = null;
      if (Object.keys(edit).length > 0) {
        savedPerson = await api.updatePerson(person.id, edit);
        await onSaved?.(savedPerson);
      }
      const confirmed = savedPerson ?? person;
      setDisplayName(confirmed.display_name);
      setBio(confirmed.bio ?? "");
      setAccent(confirmed.accent ?? NO_ACCENT);
      setSavedValues({
        displayName: confirmed.display_name,
        bio: confirmed.bio ?? null,
        accent: confirmed.accent ?? null,
      });
      setSaved(true);
      if (layout === "dialog") onCancel?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save those changes.");
    } finally {
      setSubmitting(false);
    }
  }

  const body = (
    <form onSubmit={handleSave} className="flex flex-col gap-4">
      {layout === "page" && hasUnsavedChanges ? <p role="status">Unsaved changes.</p> : null}
      {saved ? <p role="status">Saved.</p> : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-display-name">Name</Label>
        <Input id="profile-display-name" value={displayName} onChange={(event) => updateDraft(() => setDisplayName(event.target.value))} disabled={!canEdit || submitting} />
        {!canEdit ? <p className="text-sm text-muted-foreground">Ask an admin to change this.</p> : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-bio">Bio</Label>
        <Textarea id="profile-bio" value={bio} onChange={(event) => updateDraft(() => setBio(event.target.value))} maxLength={160} placeholder="A line about you" disabled={!canEdit || submitting} aria-invalid={bioTooLong} />
        <p className="text-sm text-muted-foreground">{bio.length}/160</p>
        {bioTooLong ? <p className="text-sm text-destructive">Bio must be 160 characters or less.</p> : null}
        {!canEdit ? <p className="text-sm text-muted-foreground">Ask an admin to change this.</p> : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label>Accent color</Label>
        <Select value={accent} onValueChange={(value) => { if (value !== null) updateDraft(() => setAccent(value)); }} disabled={!canEdit || submitting}>
          <SelectTrigger aria-label="Accent color"><SelectValue>{ACCENT_SELECT_LABELS[accent] ?? accent}</SelectValue></SelectTrigger>
          <SelectContent>{[...ACCENT_SELECT_OPTIONS].map((value) => <SelectItem key={value} value={value}>{ACCENT_SELECT_LABELS[value] ?? value}</SelectItem>)}</SelectContent>
        </Select>
        <Card data-testid="profile-accent-preview" aria-label="Accent preview" accent={nextAccent ?? undefined} size="sm">
          <Avatar name={trimmedName || person.display_name} accent={nextAccent ?? undefined} size="profile" />
        </Card>
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
