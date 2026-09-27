import { useEffect, useState, type FormEvent } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Person } from "@maipai/spec/gen/ts/person.js";
import { Page } from "@maipai/ui/src/primitives/Page";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { MediaGrid, type MediaGridItem } from "@maipai/ui/src/primitives/MediaGrid";
import { Select } from "@maipai/ui/src/primitives/Select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@maipai/ui/src/ui/tabs";
import { Card, CardContent } from "@maipai/ui/src/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@maipai/ui/src/ui/dialog";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { Button } from "@maipai/ui/src/ui/button";
import { Switch } from "@maipai/ui/src/ui/switch";
import { getIcon } from "@maipai/ui/src/icons";
import { cn, FOCUS_RING } from "@maipai/ui/src/utils";
import { api, ApiError, isOwnerOrAdminRole, type PersonRosterEntry, type Roster, type VisibleFile } from "@/lib/api";
import { ROLE_LABELS, canManagePerson, ACCENT_RING_CLASS, ACCENT_SELECT_OPTIONS, ACCENT_SELECT_LABELS, NO_ACCENT } from "@/apps/people/roles";
import { OwnMemories, OtherPersonMemories } from "@/apps/memory/PersonMemories";

const PencilIcon = getIcon("pencil");

interface PersonProfilePageProps {
  person: Roster;
  /** Refetches the SIGNED-IN person's own record (App.tsx's
   * revalidatePerson, the same callback AppShell/SettingsPage already
   * take as `onPersonChange`) - needed alongside the `["people"]` query
   * invalidation below because viewing your OWN profile reads straight
   * from the `person` prop (never from the roster query), the same
   * shortcut this file's own header comment already explains further
   * down. Without this, saving your own name/bio/accent here would
   * update everyone else's view of you but not the shell chrome (sidebar,
   * avatar menu) built from `person` itself, until the next full reload. */
  onPersonChange: () => void;
}

/** A person's own profile (owner ruling, "Navigation, corrected,"
 * 2026-09-20): "Memories belong to a person, so they live on the
 * person's profile: People, a person, the Memories tab." Deliberately
 * minimal - an Overview tab (name, role, avatar) and the Memories tab,
 * reusing `OwnMemories`/`OtherPersonMemories` unchanged from the
 * retired household-wide MemoryPage.tsx - not the full things-page
 * composition (kind badges as a real things table, a details pane)
 * the ruling describes as the eventual shape. That rebuild is
 * HOME-UI-04's own "People page composition," explicitly out of scope
 * here; this page only has to move Memories off the rail and onto a
 * person, honestly, without inventing 04's work early. */
export function PersonProfilePage({ person, onPersonChange }: PersonProfilePageProps) {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewingSelf = id === person.id;
  const canViewOthers = isOwnerOrAdminRole(person.role);
  // Depends only on the SIGNED-IN person's own role/id, not on the
  // profile being viewed - computed here, not down by the tab list
  // below, so `activeTab` can fall back instead of matching neither
  // tab. A code review caught the gap this closes: switching the
  // signed-in profile mid-session (ProfileSwitcher, no navigation)
  // could leave the URL on `?tab=memories` after the new profile lost
  // permission for it, rendering a Tabs with no active trigger and no
  // visible content at all - a real, reachable blank page, not a
  // hypothetical one.
  const canViewMemories = viewingSelf || canViewOthers;
  const activeTab = searchParams.get("tab") === "memories" && canViewMemories ? "memories" : "overview";
  function onTabChange(value: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === "memories") next.set("tab", value);
        else next.delete("tab");
        return next;
      },
      { replace: true },
    );
  }

  // A code review flagged this as an avoidable fetch when viewing your
  // OWN profile (`profile` below is set straight from the `person`
  // prop then, never from `roster`) - true, but `enabled: !viewingSelf`
  // is the wrong fix: AsyncState's own contract treats `data:
  // undefined` as "still loading" with no other signal, so a disabled
  // query (permanently `data: undefined`, `isFetching: false`) would
  // leave the self-viewing case on AsyncState's loading skeleton
  // forever, trading a minor inefficiency for a real, permanent
  // regression. Left unconditional; `["people"]` is the same cache key
  // PeoplePage's own household list already reads, so a household
  // member who has visited People this session pays nothing extra
  // here either way.
  const rosterQuery = useQuery<PersonRosterEntry[]>({ queryKey: ["people"], queryFn: () => api.people() });

  return (
    <Page title="Profile" hideTitle>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a keyboard-scrollable region, not a widget (DetailPane.tsx's own precedent). */}
      <div tabIndex={0} className={cn("mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto p-4", FOCUS_RING)}>
        <AsyncState
          data={rosterQuery.data}
          error={rosterQuery.isError}
          isFetching={rosterQuery.isFetching}
          onRetry={() => rosterQuery.refetch()}
          errorMessage="Could not load the household."
          loadingLabel="Loading profile"
        >
          {(roster) => {
            const profile = viewingSelf ? person : roster.find((p) => p.id === id);
            if (!profile) {
              return (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <p className="text-base font-medium">No one in this household has that profile.</p>
                  <Link to="/people" className="text-primary underline">
                    Back to People
                  </Link>
                </div>
              );
            }
            return (
              <>
                <ProfileHeaderCard profile={profile} viewer={person} viewingSelf={viewingSelf} onPersonChange={onPersonChange} />

                <Tabs value={activeTab} onValueChange={onTabChange}>
                  <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    {canViewMemories ? <TabsTrigger value="memories">Memories</TabsTrigger> : null}
                  </TabsList>
                  <TabsContent value="overview" className="flex flex-col gap-4 py-2">
                    <p className="text-base text-muted-foreground">
                      {viewingSelf ? "This is your own profile." : `${profile.display_name}'s profile in this household.`}
                    </p>
                    <SharedMediaSection profile={profile} viewingSelf={viewingSelf} />
                  </TabsContent>
                  {canViewMemories ? (
                    <TabsContent value="memories" className="py-2">
                      {viewingSelf ? (
                        <OwnMemories filterIds={idsFilter(searchParams)} actorIsAdult={person.role === "adult"} />
                      ) : (
                        <OtherPersonMemories personId={profile.id} personName={profile.display_name} />
                      )}
                    </TabsContent>
                  ) : null}
                </Tabs>
              </>
            );
          }}
        </AsyncState>
      </div>
    </Page>
  );
}

/** Chat's "memory updated" chip (chatMemoryChip.tsx) and the header
 * search's memory results (search/providers.ts) both deep-link with
 * `?ids=<memory ids>` - unchanged from the retired MemoryPage.tsx's own
 * filter, just read here instead. */
function idsFilter(searchParams: URLSearchParams): Set<string> | null {
  const idsParam = searchParams.get("ids");
  return idsParam ? new Set(idsParam.split(",")) : null;
}

type ProfileEntry = PersonRosterEntry | Roster;

/** PEOPLE-PROFILE-02: what this person has shared, filtered to the
 * SIGNED-IN viewer's own access - `GET /api/files?owner=` reuses
 * STORE-SHARE-01's own visibility rule (`lib/shares.ts`'s
 * `listPersonFilesVisibleToActor`) server-side, so this component does
 * no filtering of its own: nothing appears here that the viewer
 * couldn't already see in their own Library (FilesPage.tsx), and the
 * exact same rule applies whether the viewer is a supervised (child)
 * role or not - the design record's own "not a new rule invented for
 * profiles, it's STORE-SHARE-01's own disclosure filter read from a
 * second surface" (docs/plans/people-profile-2026-09-26.md). A
 * non-image/video file (audio, document, story, other) has no
 * thumbnail concept `MediaGrid` can render yet, so it's left out of
 * this grid rather than shown wrong. */
function SharedMediaSection({ profile, viewingSelf }: { profile: ProfileEntry; viewingSelf: boolean }) {
  const filesQuery = useQuery<VisibleFile[]>({
    queryKey: ["files", "person", profile.id],
    queryFn: () => api.files(profile.id),
  });

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">Shared</h2>
      <AsyncState
        data={filesQuery.data}
        error={filesQuery.isError}
        isFetching={filesQuery.isFetching}
        onRetry={() => filesQuery.refetch()}
        errorMessage="Could not load what's been shared."
        loadingLabel="Loading shared media"
      >
        {(files) => {
          const items: MediaGridItem[] = files
            .filter((row) => row.file.kind === "image" || row.file.kind === "video")
            .map((row) => ({
              id: row.file.id,
              thumbnailUrl: api.fileContentUrl(row.file.id),
              mediaType: row.file.kind as "image" | "video",
              altText: row.file.kind === "video" ? `A video ${profile.display_name} shared` : `A photo ${profile.display_name} shared`,
            }));
          return (
            <MediaGrid
              items={items}
              emptyMessage={viewingSelf ? "You haven't shared anything yet." : `${profile.display_name} hasn't shared anything with you yet.`}
            />
          );
        }}
      </AsyncState>
    </div>
  );
}

/** PEOPLE-PROFILE-01: photo/avatar, name, role, bio, plus the Edit action
 * and the manage-actions link-out `docs/plans/people-profile-2026-09-26.md`
 * names. `canManagePerson` is the exact frontend mirror of the backend's
 * `canManage` (PATCH /api/people/:id's own gate) - "owner-or-self", not
 * just self, since the design record's bio field is explicitly "in the
 * person's own words or (for a child) a parent's": an owner/admin editing
 * a child's bio on their behalf is the intended case, not a loophole. */
function ProfileHeaderCard({
  profile,
  viewer,
  viewingSelf,
  onPersonChange,
}: {
  profile: ProfileEntry;
  viewer: Roster;
  viewingSelf: boolean;
  onPersonChange: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const canEdit = canManagePerson(viewer.role, viewer.id, { id: profile.id, role: profile.role });
  // Manage (role, session lock, delete) stays at Settings -> Household ->
  // Users (PEOPLE-EXPAND-01's own home) - never duplicated onto this page,
  // the design record's own "the profile page is for looking at a person,
  // not administering one." Gated on the VIEWER's role alone, same as
  // AdminGatedContent's own gate on that page, not on canManage/the
  // target's role: the link only ever points somewhere already gated a
  // second time on arrival.
  const showManageLink = isOwnerOrAdminRole(viewer.role) && !viewingSelf;
  const accentClass = profile.accent ? ACCENT_RING_CLASS[profile.accent] : null;

  return (
    <Card className={accentClass ? cn("ring-2 ring-offset-2 ring-offset-background", accentClass) : undefined}>
      <CardContent className="flex flex-wrap items-center gap-4 p-6">
        <Avatar
          name={profile.display_name}
          className={accentClass ? cn("h-16 w-16 text-xl ring-2 ring-offset-2 ring-offset-card", accentClass) : "h-16 w-16 text-xl"}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="truncate text-xl font-semibold">{profile.display_name}</h1>
          <p className="text-sm text-muted-foreground">{ROLE_LABELS[profile.role]}</p>
          {profile.bio ? <p className="text-base text-muted-foreground">{profile.bio}</p> : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          {canEdit ? (
            <Button variant="outline" onClick={() => setEditOpen(true)} className="gap-1.5">
              <PencilIcon className="size-4" aria-hidden />
              Edit
            </Button>
          ) : null}
          {showManageLink ? (
            <Link to="/settings/users" className={cn("text-sm text-primary underline", FOCUS_RING)}>
              Manage in Settings
            </Link>
          ) : null}
        </div>
      </CardContent>
      {canEdit ? <EditProfileDialog profile={profile} open={editOpen} onOpenChange={setEditOpen} onPersonChange={onPersonChange} /> : null}
    </Card>
  );
}

/** The Pencil + Dialog pattern the vendored `UserProfile` demonstrates
 * (`commons/ui/src/dashboard/components/user-profile/index.tsx`) -
 * composed from `Dialog`/`Input`/`Label`/`Button` primitives, not that
 * component itself (it takes no props; every field is local hardcoded
 * state for fields `Person` doesn't have). Covers exactly the design
 * record's "Customization, bounded" list: bio, accent, the photo opt-in,
 * and display name (moved here from Settings -> Me's own
 * `DisplayNameSection.tsx`, Jesse's 2026-09-26 ruling, decision 3). */
function EditProfileDialog({
  profile,
  open,
  onOpenChange,
  onPersonChange,
}: {
  profile: ProfileEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPersonChange: () => void;
}) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [accent, setAccent] = useState<string>(profile.accent ?? NO_ACCENT);
  const [photoOptIn, setPhotoOptIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset to the current record every time the dialog opens - the same
  // "temp state seeded from the real state on open" shape the vendored
  // UserProfile's own tempPersonal/tempAddress use, so a cancelled edit
  // (or reopening on a different profile) never leaks stale input.
  useEffect(() => {
    if (!open) return;
    setDisplayName(profile.display_name);
    setBio(profile.bio ?? "");
    setAccent(profile.accent ?? NO_ACCENT);
    setPhotoOptIn(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- profile is a fresh object every render (query data); re-running on its identity would reset mid-edit on every unrelated refetch.
  }, [open, profile.id]);

  const trimmedName = displayName.trim();
  const canSave = trimmedName.length > 0 && !submitting;
  // Decision 1 (owner, 2026-09-26): a supervised/limited-role person
  // (today's "child" role value) proposing a real photo needs an admin
  // to confirm it before it goes live - the same shape
  // entities.ts/confirmTransition's "an inferred entity becomes local
  // only once a household adult confirms it" consent floor. There is no
  // `avatar_file_id` field on `Person` yet (spec-v0.1.43 shipped bio/
  // accent only; a real photo needs its own spec field plus
  // STORE-SPEC-01's storage, both still ahead) and no upload endpoint to
  // send bytes to, so this toggle is real UI state - not yet a real
  // upload - and says so plainly rather than pretending a picker here
  // would do anything: TODO(AVATAR-RENDER-01, STORE-SPEC-01) wire an
  // actual file picker plus the admin-confirmation transition once both
  // land.
  const isSupervised = profile.role === "child";

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setError(null);
    setSubmitting(true);
    try {
      const edit: { displayName?: string; bio?: string | null; accent?: Person["accent"] } = {};
      if (trimmedName !== profile.display_name) edit.displayName = trimmedName;
      const nextBio = bio.trim().length > 0 ? bio.trim() : null;
      if (nextBio !== (profile.bio ?? null)) edit.bio = nextBio;
      const nextAccent = accent === NO_ACCENT ? null : (accent as Person["accent"]);
      if (nextAccent !== (profile.accent ?? null)) edit.accent = nextAccent;
      if (Object.keys(edit).length > 0) {
        await api.updatePerson(profile.id, edit);
        // Independent round trips (a roster refetch vs. the shell's own
        // `api.me()`), so run them together rather than serially - a
        // code-review finding on this item (2026-09-26).
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
        <DialogHeader>
          <DialogTitle>Edit {profile.display_name}&rsquo;s profile</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-display-name">Name</Label>
            <Input
              id="profile-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-bio">Bio</Label>
            <Textarea
              id="profile-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 160))}
              maxLength={160}
              placeholder="A line about you"
              disabled={submitting}
            />
            <p className="text-sm text-muted-foreground">{bio.length}/160</p>
          </div>
          <div className="flex flex-col gap-2">
            {/* The Select primitive takes its accessible name from `aria-label`
                below, not a paired `htmlFor`/`id` (same as the memory
                audience control's "Who may hear this" combobox) - this
                Label is the visible caption for a sighted user only. */}
            <Label>Accent color</Label>
            <Select
              value={accent}
              onValueChange={setAccent}
              options={[...ACCENT_SELECT_OPTIONS]}
              getLabel={(v) => ACCENT_SELECT_LABELS[v] ?? v}
              disabled={submitting}
              aria-label="Accent color"
            />
          </div>
          <div className="flex flex-col gap-2 rounded-[var(--radius)] border p-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="profile-photo-opt-in">Use a real photo</Label>
              <Switch id="profile-photo-opt-in" checked={photoOptIn} onCheckedChange={setPhotoOptIn} disabled={submitting} />
            </div>
            {photoOptIn ? (
              <p className="text-sm text-muted-foreground">
                {isSupervised
                  ? `An admin needs to approve a real photo for ${profile.display_name} before it shows anywhere.`
                  : "Photo uploads aren't wired up yet. This will use MaiPai Home's own storage once it ships."}
              </p>
            ) : null}
          </div>
          {error ? <p className="text-base text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={!canSave}>
              {submitting ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
