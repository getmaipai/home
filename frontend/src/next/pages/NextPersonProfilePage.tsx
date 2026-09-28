import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Person } from "@maipai/spec/gen/ts/person.js";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { MediaGrid, type MediaGridItem } from "@maipai/ui/src/primitives/MediaGrid";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@maipai/ui/src/dashboard/components/ui/tabs";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@maipai/ui/src/dashboard/components/ui/dialog";
import { Input } from "@maipai/ui/src/dashboard/components/ui/input";
import { Label } from "@maipai/ui/src/dashboard/components/ui/label";
import { Switch } from "@maipai/ui/src/dashboard/components/ui/switch";
import { Textarea } from "@maipai/ui/src/dashboard/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/dashboard/components/ui/select";
import { getIcon } from "@maipai/ui/src/icons";
import { api, ApiError, isOwnerOrAdminRole, type PersonRosterEntry, type Roster, type VisibleFile } from "@/lib/api";
import { ACCENT_RING_CLASS, ACCENT_SELECT_LABELS, ACCENT_SELECT_OPTIONS, canManagePerson, NO_ACCENT, ROLE_LABELS } from "@/apps/people/roles";
import { OwnMemories, OtherPersonMemories } from "@/apps/memory/PersonMemories";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

const PencilIcon = getIcon("pencil");
type ProfileEntry = PersonRosterEntry | Roster;

function idsFilter(params: URLSearchParams): Set<string> | null {
  const value = params.get("ids");
  return value ? new Set(value.split(",")) : null;
}

/** The /next equivalent of /people/:id. Its tab permission rule is kept
 * identical to PersonProfilePage: self, or owner/admin viewing another. */
export function NextPersonProfilePage({ person, onPersonChange }: { person: Roster; onPersonChange: () => void | Promise<void> }) {
  useDocumentTitle("Profile");
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const viewingSelf = id === person.id;
  const canViewMemories = viewingSelf || isOwnerOrAdminRole(person.role);
  const activeTab = params.get("tab") === "memories" && canViewMemories ? "memories" : "overview";
  const rosterQuery = useQuery<PersonRosterEntry[]>({ queryKey: ["people"], queryFn: () => api.people() });

  function onTabChange(value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value === "memories") next.set("tab", value);
      else next.delete("tab");
      return next;
    }, { replace: true });
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto p-4">
      <CardHeader className="p-0"><CardTitle>Profile</CardTitle></CardHeader>
      <AsyncState
        data={rosterQuery.data}
        error={rosterQuery.isError}
        isFetching={rosterQuery.isFetching}
        onRetry={() => rosterQuery.refetch()}
        errorMessage="Could not load the household."
        loadingLabel="Loading profile"
      >
        {(roster) => {
          const profile = viewingSelf ? person : roster.find((entry) => entry.id === id);
          if (!profile) {
            return (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <p className="text-base font-medium">No one in this household has that profile.</p>
                <Link to="/people" className="text-primary underline">Back to People</Link>
              </div>
            );
          }
          return (
            <>
              <ProfileHeaderCard profile={profile} viewer={person} viewingSelf={viewingSelf} onPersonChange={onPersonChange} />
              <Tabs value={activeTab} onValueChange={onTabChange}>
              <TabsList className="h-auto min-h-14 p-1">
                <TabsTrigger value="overview" className="min-h-12">Overview</TabsTrigger>
                  {canViewMemories ? <TabsTrigger value="memories" className="min-h-12">Memories</TabsTrigger> : null}
                </TabsList>
                <TabsContent value="overview" className="flex flex-col gap-4 py-2">
                  <p className="text-sm text-muted-foreground">{viewingSelf ? "This is your own profile." : `${profile.display_name}'s profile in this household.`}</p>
                  <SharedMediaSection profile={profile} viewingSelf={viewingSelf} />
                </TabsContent>
                {canViewMemories ? (
                  <TabsContent value="memories" className="py-2">
                    {viewingSelf
                      ? <OwnMemories filterIds={idsFilter(params)} actorIsAdult={person.role === "adult"} />
                      : <OtherPersonMemories personId={profile.id} personName={profile.display_name} />}
                  </TabsContent>
                ) : null}
              </Tabs>
            </>
          );
        }}
      </AsyncState>
    </div>
  );
}

function SharedMediaSection({ profile, viewingSelf }: { profile: ProfileEntry; viewingSelf: boolean }) {
  const query = useQuery<VisibleFile[]>({ queryKey: ["files", "person", profile.id], queryFn: () => api.files(profile.id) });
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">Shared</h2>
      <AsyncState data={query.data} error={query.isError} isFetching={query.isFetching} onRetry={() => query.refetch()} errorMessage="Could not load what's been shared." loadingLabel="Loading shared media">
        {(files) => {
          const items: MediaGridItem[] = files
            .filter(({ file }) => file.kind === "image" || file.kind === "video")
            .map(({ file }) => ({ id: file.id, thumbnailUrl: api.fileContentUrl(file.id), mediaType: file.kind as "image" | "video", altText: file.kind === "video" ? `A video ${profile.display_name} shared` : `A photo ${profile.display_name} shared` }));
          return <MediaGrid items={items} emptyMessage={viewingSelf ? "You haven't shared anything yet." : `${profile.display_name} hasn't shared anything with you yet.`} />;
        }}
      </AsyncState>
    </div>
  );
}

function ProfileHeaderCard({ profile, viewer, viewingSelf, onPersonChange }: { profile: ProfileEntry; viewer: Roster; viewingSelf: boolean; onPersonChange: () => void | Promise<void> }) {
  const [editOpen, setEditOpen] = useState(false);
  const canEdit = canManagePerson(viewer.role, viewer.id, { id: profile.id, role: profile.role });
  const showManageLink = isOwnerOrAdminRole(viewer.role) && !viewingSelf;
  const accentClass = profile.accent ? ACCENT_RING_CLASS[profile.accent] : null;
  return (
    <Card className={accentClass ? `ring-2 ring-offset-2 ring-offset-background ${accentClass}` : undefined}>
      <CardContent className="flex flex-wrap items-center gap-4 p-6">
        <Avatar name={profile.display_name} className={accentClass ? `h-16 w-16 text-xl ring-2 ring-offset-2 ring-offset-card ${accentClass}` : "h-16 w-16 text-xl"} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="truncate text-xl font-semibold">{profile.display_name}</h1>
          <p className="text-sm text-muted-foreground">{ROLE_LABELS[profile.role]}</p>
          {profile.bio ? <p className="text-base text-muted-foreground">{profile.bio}</p> : null}
        </div>
        <div className="flex basis-full flex-row items-center justify-end gap-4 sm:w-auto sm:basis-auto sm:flex-col sm:items-end sm:gap-2">
          {canEdit ? <Button variant="outline" onClick={() => setEditOpen(true)} className="min-h-12 gap-1.5"><PencilIcon className="size-4" aria-hidden />Edit</Button> : null}
          {showManageLink ? <Link to="/settings?tab=household" className="text-sm text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Manage in Settings</Link> : null}
        </div>
      </CardContent>
      {canEdit ? <EditProfileDialog profile={profile} open={editOpen} onOpenChange={setEditOpen} onPersonChange={onPersonChange} /> : null}
    </Card>
  );
}

function EditProfileDialog({ profile, open, onOpenChange, onPersonChange }: { profile: ProfileEntry; open: boolean; onOpenChange: (open: boolean) => void; onPersonChange: () => void | Promise<void> }) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [accent, setAccent] = useState<string>(profile.accent ?? NO_ACCENT);
  const [photoOptIn, setPhotoOptIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (!open) return;
    setDisplayName(profile.display_name);
    setBio(profile.bio ?? "");
    setAccent(profile.accent ?? NO_ACCENT);
    setPhotoOptIn(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- profile is refetched as a fresh object; only reset on opening or changing profile.
  }, [open, profile.id]);
  const trimmedName = displayName.trim();
  const canSave = trimmedName.length > 0 && !submitting;
  const isSupervised = profile.role === "child";

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setError(null);
    setSubmitting(true);
    try {
      const edit: { displayName?: string; bio?: string | null; accent?: Person["accent"] } = {};
      if (trimmedName !== profile.display_name) edit.displayName = trimmedName;
      const nextBio = bio.trim() || null;
      if (nextBio !== (profile.bio ?? null)) edit.bio = nextBio;
      const nextAccent = accent === NO_ACCENT ? null : accent as Person["accent"];
      if (nextAccent !== (profile.accent ?? null)) edit.accent = nextAccent;
      if (Object.keys(edit).length > 0) {
        await api.updatePerson(profile.id, edit);
        await Promise.all([queryClient.invalidateQueries({ queryKey: ["people"] }), onPersonChange()]);
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save those changes.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit {profile.display_name}&rsquo;s profile</DialogTitle></DialogHeader>
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2"><Label htmlFor="profile-display-name">Name</Label><Input id="profile-display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={submitting} /></div>
          <div className="flex flex-col gap-2"><Label htmlFor="profile-bio">Bio</Label><Textarea id="profile-bio" value={bio} onChange={(event) => setBio(event.target.value.slice(0, 160))} maxLength={160} placeholder="A line about you" disabled={submitting} /><p className="text-sm text-muted-foreground">{bio.length}/160</p></div>
          <div className="flex flex-col gap-2">
            <Label>Accent color</Label>
            <Select value={accent} onValueChange={(value) => { if (value !== null) setAccent(value); }} disabled={submitting}>
              <SelectTrigger aria-label="Accent color"><SelectValue>{ACCENT_SELECT_LABELS[accent] ?? accent}</SelectValue></SelectTrigger>
              <SelectContent>{[...ACCENT_SELECT_OPTIONS].map((value) => <SelectItem key={value} value={value}>{ACCENT_SELECT_LABELS[value] ?? value}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-3"><Label htmlFor="profile-photo-opt-in">Use a real photo</Label><Switch id="profile-photo-opt-in" checked={photoOptIn} onCheckedChange={setPhotoOptIn} disabled={submitting} /></div>
            {photoOptIn ? <p className="text-sm text-muted-foreground">{isSupervised ? `An admin needs to approve a real photo for ${profile.display_name} before it shows anywhere.` : "Photo uploads aren't wired up yet. This will use MaiPai Home's own storage once it ships."}</p> : null}
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={!canSave}>{submitting ? "Saving…" : "Save"}</Button>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
