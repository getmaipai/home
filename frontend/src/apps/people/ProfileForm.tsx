import { i18n } from "@lingui/core";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Person } from "@maipai/spec/gen/ts/person.js";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { DialogFooter } from "@maipai/ui/src/dashboard/components/ui/dialog";
import { Input } from "@maipai/ui/src/dashboard/components/ui/input";
import { Label } from "@maipai/ui/src/dashboard/components/ui/label";
import { Textarea } from "@maipai/ui/src/dashboard/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/dashboard/components/ui/select";
import { api, type PersonRosterEntry, type Roster } from "@/lib/api";
import { ACCENT_SELECT_LABELS, ACCENT_SELECT_OPTIONS, NO_ACCENT } from "@/apps/people/roles";
import { registerRouteLeaveGuard } from "@/shell/routeLeaveGuard";
import { errorLine } from "@/lib/hubReachability";
import { StatusCard } from "@maipai/ui/src/elements/status-card";

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
  const draftPersonId = useRef(person.id);
  const dirtyRef = useRef(false);
  const restoringPopState = useRef(false);
  const trimmedName = displayName.trim();
  const nextBio = bio.trim() || null;
  const nextAccent = accent === NO_ACCENT ? null : accent as Person["accent"];
  const hasUnsavedChanges = trimmedName !== savedValues.displayName
    || nextBio !== savedValues.bio
    || nextAccent !== savedValues.accent;
  dirtyRef.current = hasUnsavedChanges;
  const bioTooLong = bio.length > 160;
  const canSave = canEdit && trimmedName.length > 0 && !bioTooLong && !submitting;

  useEffect(() => {
    const changedPerson = draftPersonId.current !== person.id;
    draftPersonId.current = person.id;
    if (!changedPerson && dirtyRef.current) return;
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
    const unregister = registerRouteLeaveGuard(() => window.confirm(i18n._({ id: "Leave without saving?", message: "Leave without saving?" })));
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
      if (!window.confirm(i18n._({ id: "Leave without saving?", message: "Leave without saving?" }))) {
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
      if (!window.confirm(i18n._({ id: "Leave without saving?", message: "Leave without saving?" }))) {
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
      setError(errorLine(err, i18n._({ id: "Could not save those changes. Check your connection and try again.", message: "Could not save those changes. Check your connection and try again." })));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-4">
      {layout === "page" && hasUnsavedChanges ? <p role="status">{i18n._({ id: "Unsaved changes.", message: "Unsaved changes." })}</p> : null}
      {saved ? <p role="status">{i18n._({ id: "Saved.", message: "Saved." })}</p> : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-display-name">{i18n._({ id: "Name", message: "Name" })}</Label>
        <Input id="profile-display-name" value={displayName} onChange={(event) => updateDraft(() => setDisplayName(event.target.value))} disabled={!canEdit || submitting} />
        {!canEdit ? <p className="text-sm text-muted-foreground">{i18n._({ id: "Ask an admin to change this.", message: "Ask an admin to change this." })}</p> : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-bio">{i18n._({ id: "Bio", message: "Bio" })}</Label>
        <Textarea id="profile-bio" value={bio} onChange={(event) => updateDraft(() => setBio(event.target.value))} maxLength={160} placeholder={i18n._({ id: "A line about you", message: "A line about you" })} disabled={!canEdit || submitting} aria-invalid={bioTooLong} />
        <p className="text-sm text-muted-foreground">{bio.length}/160</p>
        {bioTooLong ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={i18n._({ id: "Bio must be 160 characters or less.", message: "Bio must be 160 characters or less." })} /> : null}
        {!canEdit ? <p className="text-sm text-muted-foreground">{i18n._({ id: "Ask an admin to change this.", message: "Ask an admin to change this." })}</p> : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label>{i18n._({ id: "Accent color", message: "Accent color" })}</Label>
        <Select value={accent} onValueChange={(value) => { if (value !== null) updateDraft(() => setAccent(value)); }} disabled={!canEdit || submitting}>
          <SelectTrigger aria-label={i18n._({ id: "Accent color", message: "Accent color" })}><SelectValue>{ACCENT_SELECT_LABELS[accent] ?? accent}</SelectValue></SelectTrigger>
          <SelectContent>{[...ACCENT_SELECT_OPTIONS].map((value) => <SelectItem key={value} value={value}>{ACCENT_SELECT_LABELS[value] ?? value}</SelectItem>)}</SelectContent>
        </Select>
        {!canEdit ? <p className="text-sm text-muted-foreground">{i18n._({ id: "Ask an admin to change this.", message: "Ask an admin to change this." })}</p> : null}
      </div>
      {error ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={error} /> : null}
      {canEdit ? layout === "dialog" ? (
        <DialogFooter>
          <Button type="submit" disabled={!canSave}>{submitting ? i18n._({ id: "Saving…", message: "Saving…" }) : i18n._({ id: "Save", message: "Save" })}</Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>{i18n._({ id: "Cancel", message: "Cancel" })}</Button>
        </DialogFooter>
      ) : (
        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={!canSave}>{submitting ? i18n._({ id: "Saving…", message: "Saving…" }) : i18n._({ id: "Save", message: "Save" })}</Button>
          {onCancel ? <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>{i18n._({ id: "Cancel", message: "Cancel" })}</Button> : null}
        </div>
      ) : null}
    </form>
  );
}
