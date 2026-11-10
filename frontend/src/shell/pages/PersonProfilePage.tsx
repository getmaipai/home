import { SafeImage } from "@maipai/ui/src/primitives/SafeImage";
import { i18n } from "@lingui/core";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { MediaGrid, type MediaGridItem } from "@maipai/ui/src/primitives/MediaGrid";
import { MediaShelf } from "@maipai/ui/src/primitives/MediaShelf";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@maipai/ui/src/ui/tabs";
import { Button } from "@maipai/ui/src/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@maipai/ui/src/dashboard/components/ui/dialog";
import { getIcon } from "@maipai/ui/src/icons";
import { api, isOwnerOrAdminRole, type LibraryItem, type PersonRosterEntry, type Roster, type VisibleFile } from "@/lib/api";
import { canManagePerson, isProfileClosedTo, ROLE_LABELS } from "@/apps/people/roles";
import { ProfileForm } from "@/apps/people/ProfileForm";
import { useTabItem } from "@/shell/tabIdentity";
import { SettingsRenderer } from "@/shell/pages/settings/SettingsRenderer";
import { PERSON_KID_PICTURES_GROUP_IDS, PERSON_KID_PICTURES_KEYS, PERSON_LIMIT_GROUP_IDS, PERSON_TOPIC_GROUP_IDS } from "@/shell/pages/settings/personLimits";

const PencilIcon = getIcon("pencil");
type ProfileEntry = PersonRosterEntry | Roster;

/** The person profile page at /people/:id. Its tab permission rule: self, or owner/admin viewing another. */
export function PersonProfilePage({ person, onPersonChange }: { person: Roster; onPersonChange: () => void | Promise<void> }) {
  useTabItem("Profile");
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const [editOpen, setEditOpen] = useState(false);
  const queryClient = useQueryClient();
  const rosterQuery = useQuery<PersonRosterEntry[]>({ queryKey: ["people"], queryFn: () => api.people() });
  const viewingSelf = id === person.id;
  const canViewLimits = !viewingSelf && isOwnerOrAdminRole(person.role)
    && rosterQuery.data?.some((entry) => entry.id === id && entry.age_band === "child") === true;
  const activeTab = params.get("tab") === "limits" && canViewLimits
      ? "limits"
      : params.get("tab") === "topics" && canViewLimits
        ? "topics"
        : "overview";
  function onTabChange(value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value === "limits" || value === "topics") next.set("tab", value);
      else next.delete("tab");
      return next;
    }, { replace: true });
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-6 overflow-y-auto p-4 md:p-6" data-testid="person-profile-page">
      <AsyncState
        data={rosterQuery.data}
        error={rosterQuery.isError}
        isFetching={rosterQuery.isFetching}
        onRetry={() => rosterQuery.refetch()}
        errorMessage={i18n._({ id: "Could not load the household.", message: "Could not load the household." })}
        loadingLabel={i18n._({ id: "Loading profile", message: "Loading profile" })}
      >
        {(roster) => {
          const profile = viewingSelf ? person : roster.find((entry) => entry.id === id);
          if (!profile) {
            return (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <p className="text-base font-medium">{i18n._({ id: "No one in this household has that profile.", message: "No one in this household has that profile." })}</p>
                <Link to="/people" className="text-primary underline">{i18n._({ id: "Back to Family", message: "Back to Family" })}</Link>
              </div>
            );
          }
          if (!viewingSelf && isProfileClosedTo(person, profile)) {
            return (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <p className="text-base font-medium">{i18n._({ id: "You cannot open this profile.", message: "You cannot open this profile." })}</p>
                <p className="text-sm text-muted-foreground">{i18n._({ id: "A teen&rsquo;s profile is private, even from an admin. Go back to Family to open someone else.", message: "A teen&rsquo;s profile is private, even from an admin. Go back to Family to open someone else." })}</p>
                <Link to="/people" className="text-primary underline">{i18n._({ id: "Back to Family", message: "Back to Family" })}</Link>
              </div>
            );
          }
          const showLimits = canViewLimits && profile.age_band === "child" && canManagePerson(person.role, person.id, { id: profile.id, role: profile.role });
          const canEdit = canManagePerson(person.role, person.id, { id: profile.id, role: profile.role });
          return (
            <>
              <ProfileHeaderBody profile={profile} viewer={person} viewingSelf={viewingSelf} canEdit={canEdit} onEdit={() => setEditOpen(true)} />
              {canEdit && !viewingSelf ? (
                <Dialog open={editOpen} onOpenChange={setEditOpen}>
                  <DialogContent>
                    <DialogHeader><DialogTitle>{i18n._({ id: "Edit {name}’s profile", message: "Edit {name}’s profile", values: { name: profile.display_name } })}</DialogTitle></DialogHeader>
                    <ProfileForm
                      key={`${profile.id}-${editOpen}`}
                      person={profile}
                      canEdit
                      layout="dialog"
                      onSaved={async () => {
                        await Promise.all([queryClient.invalidateQueries({ queryKey: ["people"] }), onPersonChange()]);
                      }}
                      onCancel={() => setEditOpen(false)}
                    />
                  </DialogContent>
                </Dialog>
              ) : null}
              <Tabs value={activeTab} onValueChange={onTabChange}>
                <TabsList>
                  <TabsTrigger value="overview">{i18n._({ id: "Overview", message: "Overview" })}</TabsTrigger>
                  {showLimits ? <TabsTrigger value="limits">{i18n._({ id: "Limits", message: "Limits" })}</TabsTrigger> : null}
                  {showLimits ? <TabsTrigger value="topics">{i18n._({ id: "Topics", message: "Topics" })}</TabsTrigger> : null}
                </TabsList>
                <TabsContent value="overview">
                  <div className="flex flex-col gap-4 py-2">
                    {viewingSelf ? null : <p className="text-sm text-muted-foreground">{`${profile.display_name}'s profile in this household.`}</p>}
                    <CreationsSection profile={profile} />
                    <SharedMediaSection profile={profile} />
                  </div>
                </TabsContent>
                {showLimits ? (
                  <TabsContent value="limits">
                    <div className="flex flex-col gap-4 py-2">
                      <p className="text-sm text-muted-foreground">{i18n._({ id: "Daily time limits for {name}.", message: "Daily time limits for {name}.", values: { name: profile.display_name } })}</p>
                      <SettingsRenderer scope="person" scopeValue={`person:${profile.id}`} only={PERSON_LIMIT_GROUP_IDS} titleOverrides={{ "person.storage": "Storage" }} />
                      {/* The per-child cartoon switch (KIDS-CREATE-01): a guardian finds it here, on the child's own page, next to the other limits. The home switch and the daily limits are in Home settings, Pictures and videos. */}
                      {viewingSelf && profile.age_band !== "child" ? <p className="text-sm text-muted-foreground">{i18n._({ id: "Pictures and videos can be made in chat.", message: "Pictures and videos can be made in chat." })}</p> : <SettingsRenderer scope="person" scopeValue={`person:${profile.id}`} only={PERSON_KID_PICTURES_GROUP_IDS} includeKeys={PERSON_KID_PICTURES_KEYS} titleOverrides={{ "person.likeness": "Pictures and videos" }} />}
                    </div>
                  </TabsContent>
                ) : null}
                {showLimits ? (
                  <TabsContent value="topics">
                    <div className="flex flex-col gap-4 py-2">
                      <p className="text-sm text-muted-foreground">{i18n._({ id: "How MaiPai answers {name} about sensitive subjects. Only you and other admins can change these.", message: "How MaiPai answers {name} about sensitive subjects. Only you and other admins can change these.", values: { name: profile.display_name } })}</p>
                      <SettingsRenderer scope="person" scopeValue={`person:${profile.id}`} only={PERSON_TOPIC_GROUP_IDS} titleOverrides={{ "person.topics": "Sensitive subjects" }} />
                      <p className="text-sm text-muted-foreground">{i18n._({ id: "Some things never change for {name}. Feelings and safety always get care first and a trusted grown-up. Bullying, secrets and sharing where they live are never helped. On religion and politics, MaiPai takes no side. In danger, MaiPai points to a grown-up and the emergency number.", message: "Some things never change for {name}. Feelings and safety always get care first and a trusted grown-up. Bullying, secrets and sharing where they live are never helped. On religion and politics, MaiPai takes no side. In danger, MaiPai points to a grown-up and the emergency number.", values: { name: profile.display_name } })}</p>
                    </div>
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

function SharedMediaSection({ profile }: { profile: ProfileEntry }) {
  const query = useQuery<VisibleFile[]>({ queryKey: ["files", "person", profile.id], queryFn: () => api.files(profile.id) });
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">{i18n._({ id: "Shared", message: "Shared" })}</h2>
      <AsyncState data={query.data} error={query.isError} isFetching={query.isFetching} onRetry={() => query.refetch()} errorMessage={i18n._({ id: "Could not load what's been shared.", message: "Could not load what's been shared." })} loadingLabel={i18n._({ id: "Loading shared media", message: "Loading shared media" })}>
        {(files) => {
          const items: MediaGridItem[] = files
            .filter(({ shared }) => shared)
            .filter(({ file }) => file.kind === "image" || file.kind === "video")
            .map(({ file }) => ({ id: file.id, thumbnailUrl: api.fileContentUrl(file.id), mediaType: file.kind as "image" | "video", altText: file.kind === "video" ? `A video ${profile.display_name} shared` : `A photo ${profile.display_name} shared` }));
          return items.length === 0 ? null : <MediaGrid items={items} emptyMessage={i18n._({ id: "Nothing shared yet.", message: "Nothing shared yet." })} />;
        }}
      </AsyncState>
    </div>
  );
}

function CreationsSection({ profile }: { profile: ProfileEntry }) {
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ["library", "person-profile", profile.id], queryFn: () => api.library({ owner: profile.id, limit: 60 }) });
  return <AsyncState data={query.data?.items} error={query.isError} isFetching={query.isFetching} onRetry={() => query.refetch()} errorMessage={i18n._({ id: "Could not load creations.", message: "Could not load creations." })} loadingLabel={i18n._({ id: "Loading creations", message: "Loading creations" })}>
    {(items: LibraryItem[]) => {
      const creations = items.filter((item) => item.kind === "image" || item.kind === "video" || item.kind === "audio");
      return creations.length ? <MediaShelf
        items={creations}
        getKey={(item) => item.id}
        getLabel={(item) => item.name}
        aspect="square"
        layout="grid"
        variant="plain"
        heading={i18n._({ id: "Creations", message: "Creations" })}
        headingStyle="section"
        renderItem={(item) => <SafeImage src={item.thumb_url} alt="" kind={item.kind === "audio" ? "music" : item.kind === "video" ? "video" : "picture"} tintSeed={item.name} className="size-full object-cover" />}
        renderBadge={(item) => item.kind === "video" || item.kind === "audio" ? <Badge variant="secondary">{item.kind === "video" ? i18n._({ id: "Video", message: "Video" }) : i18n._({ id: "Song", message: "Song" })}</Badge> : null}
        onSelect={(item) => navigate(`/library?file=${encodeURIComponent(item.id)}`)}
        seeAll={{ label: i18n._({ id: "See all", message: "See all" }), onSelect: () => navigate("/library") }}
      /> : null;
    }}
  </AsyncState>;
}

/** Profile identity, library counts and profile actions. */
function ProfileHeaderBody({ profile, viewer, viewingSelf, canEdit, onEdit }: { profile: ProfileEntry; viewer: Roster; viewingSelf: boolean; canEdit: boolean; onEdit: () => void }) {
  const showSelfEdit = viewingSelf && isOwnerOrAdminRole(viewer.role);
  const summary = useQuery({ queryKey: ["library-summary", { owner: profile.id }], queryFn: () => api.librarySummary({ owner: profile.id }) });
  const stats = summary.data?.per_kind;
  const counts = stats ? [
    { value: stats.audio?.items ?? 0, label: i18n._({ id: "songs", message: "songs" }) },
    { value: stats.video?.items ?? 0, label: i18n._({ id: "videos", message: "videos" }) },
    { value: stats.image?.items ?? 0, label: i18n._({ id: "pictures", message: "pictures" }) },
  ] : [];
  return (
    <section className="flex flex-col gap-5" aria-label={i18n._({ id: "Profile", message: "Profile" })}>
      <div className="flex flex-wrap items-center gap-5">
        <Avatar name={profile.display_name} seed={profile.avatar_seed} size="profile" accent={profile.accent ?? undefined} />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3"><h1 className="truncate text-hero font-bold">{profile.display_name}</h1><Badge variant="secondary">{ROLE_LABELS[profile.role]}</Badge></div>
          {counts.length ? <div className="flex flex-wrap gap-6" aria-label={i18n._({ id: "Library counts", message: "Library counts" })}>{counts.map((item) => <div key={item.label} className="flex flex-col"><span className="text-section font-semibold">{item.value}</span><span className="text-supporting text-muted-foreground">{item.label}</span></div>)}</div> : null}
          {profile.bio ? <p className="text-body text-muted-foreground">{profile.bio}</p> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {showSelfEdit && canEdit ? <Button asChild variant="inverse" shape="pill" size="control"><Link to="/settings/profile?tab=profile">{i18n._({ id: "Edit profile", message: "Edit profile" })}</Link></Button> : canEdit ? <Button variant="inverse" shape="pill" size="control" onClick={onEdit}><PencilIcon className="size-4" aria-hidden />{i18n._({ id: "Edit profile", message: "Edit profile" })}</Button> : null}
        <Button variant="glass" shape="pill" size="control" onClick={() => { if (navigator.share) void navigator.share({ title: profile.display_name, url: window.location.href }); }}>{i18n._({ id: "Share", message: "Share" })}</Button>
        {viewingSelf ? <Button asChild variant="glass" shape="pill" size="control"><Link to="/settings/profile">{i18n._({ id: "Settings", message: "Settings" })}</Link></Button> : null}
      </div>
    </section>
  );
}
