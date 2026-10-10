import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { MediaGrid, type MediaGridItem } from "@maipai/ui/src/primitives/MediaGrid";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@maipai/ui/src/dashboard/components/ui/tabs";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@maipai/ui/src/dashboard/components/ui/dialog";
import { getIcon } from "@maipai/ui/src/icons";
import { api, isOwnerOrAdminRole, type PersonRosterEntry, type Roster, type VisibleFile } from "@/lib/api";
import { ACCENT_RING_CLASS, canManagePerson, ROLE_LABELS } from "@/apps/people/roles";
import { ProfileForm } from "@/apps/people/ProfileForm";
import { FaceEnrollmentCard } from "@/apps/people/FaceEnrollmentCard";
import { OwnMemories, OtherPersonMemories } from "@/apps/memory/PersonMemories";
import { useTabItem } from "@/shell/tabIdentity";
import { SettingsRenderer } from "@/shell/pages/settings/SettingsRenderer";
import { PERSON_LIMIT_GROUP_IDS } from "@/shell/pages/settings/personLimits";

const PencilIcon = getIcon("pencil");
type ProfileEntry = PersonRosterEntry | Roster;

function idsFilter(params: URLSearchParams): Set<string> | null {
  const value = params.get("ids");
  return value ? new Set(value.split(",")) : null;
}

/** The /next equivalent of /people/:id. Its tab permission rule is kept
 * identical to PersonProfilePage: self, or owner/admin viewing another. */
export function PersonProfilePage({ person, onPersonChange }: { person: Roster; onPersonChange: () => void | Promise<void> }) {
  useTabItem("Profile");
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const [editOpen, setEditOpen] = useState(false);
  const queryClient = useQueryClient();
  const rosterQuery = useQuery<PersonRosterEntry[]>({ queryKey: ["people"], queryFn: () => api.people() });
  const viewingSelf = id === person.id;
  const canViewMemories = viewingSelf || isOwnerOrAdminRole(person.role);
  const canViewLimits = !viewingSelf && isOwnerOrAdminRole(person.role)
    && rosterQuery.data?.some((entry) => entry.id === id && entry.age_band === "child") === true;
  const activeTab = params.get("tab") === "memories" && canViewMemories
    ? "memories"
    : params.get("tab") === "limits" && canViewLimits
      ? "limits"
      : "overview";
  function onTabChange(value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value === "memories" || value === "limits") next.set("tab", value);
      else next.delete("tab");
      return next;
    }, { replace: true });
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto p-4">
      <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
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
                <Link to="/people" className="text-primary underline">Back to Family</Link>
              </div>
            );
          }
          const showLimits = canViewLimits && profile.age_band === "child" && canManagePerson(person.role, person.id, { id: profile.id, role: profile.role });
          const canEdit = canManagePerson(person.role, person.id, { id: profile.id, role: profile.role });
          return (
            <>
              <Card>
                <CardContent>
                  <ProfileHeaderBody profile={profile} viewer={person} viewingSelf={viewingSelf} canEdit={canEdit} onEdit={() => setEditOpen(true)} />
                </CardContent>
              </Card>
              {canEdit && !viewingSelf ? (
                <Dialog open={editOpen} onOpenChange={setEditOpen}>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Edit {profile.display_name}&rsquo;s profile</DialogTitle></DialogHeader>
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
                <TabsList className="h-auto min-h-14 p-1">
                  <TabsTrigger value="overview" className="min-h-12">Overview</TabsTrigger>
                  {canViewMemories ? <TabsTrigger value="memories" className="min-h-12">Memories</TabsTrigger> : null}
                  {showLimits ? <TabsTrigger value="limits" className="min-h-12">Limits</TabsTrigger> : null}
                </TabsList>
                <TabsContent value="overview">
                  <div className="flex flex-col gap-4 py-2">
                    {viewingSelf ? null : <p className="text-sm text-muted-foreground">{`${profile.display_name}'s profile in this household.`}</p>}
                    <SharedMediaSection profile={profile} viewingSelf={viewingSelf} />
                    {viewingSelf ? <FaceStatusRow profile={profile} /> : <FaceEnrollmentCard profile={profile} viewer={person} viewingSelf={false} />}
                  </div>
                </TabsContent>
                {canViewMemories ? (
                  <TabsContent value="memories">
                    <div className="py-2">
                      {viewingSelf
                        ? <OwnMemories filterIds={idsFilter(params)} actorIsAdult={person.role === "adult"} />
                        : <OtherPersonMemories personId={profile.id} personName={profile.display_name} />}
                    </div>
                  </TabsContent>
                ) : null}
                {showLimits ? (
                  <TabsContent value="limits">
                    <div className="flex flex-col gap-4 py-2">
                      <p className="text-sm text-muted-foreground">Daily time limits for {profile.display_name}.</p>
                      <SettingsRenderer scope="person" scopeValue={`person:${profile.id}`} only={PERSON_LIMIT_GROUP_IDS} titleOverrides={{ "person.storage": "Storage" }} />
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

function FaceStatusRow({ profile }: { profile: ProfileEntry }) {
  const query = useQuery({
    queryKey: ["biometric-prints", profile.id],
    queryFn: () => api.biometricPrints(profile.id),
  });
  const setUp = query.data?.some((print) => print.modality === "face") === true;
  return <p className="text-sm text-muted-foreground">Face recognition: {query.isLoading ? "Checking" : setUp ? "Set up" : "Not set up yet"}</p>;
}

/** The inside of the page's profile header card (the page owns the Card and
 * the edit Dialog). The person's accent shows as the ring on their Avatar,
 * not on the Card, so no kit Element carries a className override. */
function ProfileHeaderBody({ profile, viewer, viewingSelf, canEdit, onEdit }: { profile: ProfileEntry; viewer: Roster; viewingSelf: boolean; canEdit: boolean; onEdit: () => void }) {
  const showSelfEdit = viewingSelf && isOwnerOrAdminRole(viewer.role);
  const accentClass = profile.accent ? ACCENT_RING_CLASS[profile.accent] : null;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Avatar name={profile.display_name} className={accentClass ? `h-16 w-16 text-xl ring-2 ring-offset-2 ring-offset-card ${accentClass}` : "h-16 w-16 text-xl"} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 className="truncate text-xl font-semibold">{profile.display_name}</h1>
        <p className="text-sm text-muted-foreground">{ROLE_LABELS[profile.role]}</p>
        {profile.bio ? <p className="text-base text-muted-foreground">{profile.bio}</p> : null}
      </div>
      <div className="flex basis-full flex-row items-center justify-end gap-4 sm:w-auto sm:basis-auto sm:flex-col sm:items-end sm:gap-2">
        {showSelfEdit && canEdit ? <Link to="/settings/account/profile" className="min-h-12 content-center text-sm text-primary underline">Edit profile</Link> : canEdit ? <Button variant="outline" size="row" onClick={onEdit}><PencilIcon className="size-4" aria-hidden />Edit</Button> : null}
      </div>
    </div>
  );
}
