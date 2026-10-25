import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { Section } from "@maipai/ui/src/primitives/Section";
import { CharacterHero } from "@maipai/ui/src/elements/character-hero";
import { CharacterTile } from "@maipai/ui/src/primitives/CharacterTile";
import { Badge } from "@maipai/ui/src/dashboard/components/ui/badge";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Select } from "@maipai/ui/src/primitives/Select";
import { companionVoiceKey } from "@/lib/companionVoice";
import { api, ApiError, type CompanionCard, type CompanionDetail, type CompanionList } from "@/lib/api";
import { playableVoices, previewIdFor, voiceChoices } from "@/lib/voice/voiceBrowserRows";
import { voicePreviewPlayer, type VoicePreviewState } from "@/lib/voice/voicePreviewPlayer";
import { useTabItem } from "@/shell/tabIdentity";
import { useCompanionShells } from "@/lib/companionShells";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@maipai/ui/src/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@maipai/ui/src/ui/dropdown-menu";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { getIcon } from "@maipai/ui/src/icons";
import { companionPreviewSample } from "@/shell/pages/companionPreviewSample";

const listKey = ["companions"] as const;
const ROBOT_SETTINGS = "/settings/apps?tab=robot";
const SettingsIcon = getIcon("settings-2");
const ChevronRightIcon = getIcon("chevron-right");
const MoreIcon = getIcon("more-horizontal");

/** Props for one companion tile, shared by Yours and Discover. */
function companionTileProps({ card, preview = false, discover = false, onDelete, onSelect, onSetDefault }: { card: CompanionCard; preview?: boolean; discover?: boolean; onDelete: (card: CompanionCard) => void; onSelect: () => void; onSetDefault: (card: CompanionCard) => void }) {
  const actions = <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="ghost" size="icon" aria-label="Companion actions" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><MoreIcon aria-hidden="true" /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <DropdownMenuItem disabled={card.is_default} onSelect={() => onSetDefault(card)}>Set as my default</DropdownMenuItem>
      {card.can_edit && card.is_household ? <DropdownMenuItem variant="destructive" onSelect={() => onDelete(card)}>Delete</DropdownMenuItem> : null}
    </DropdownMenuContent>
  </DropdownMenu>;
  let status: ReactNode;
  if (preview && !discover) {
    const sample = companionPreviewSample(card.id);
    status = <Badge tone={sample.status === "Working" ? "success" : sample.status === "Needs approval" ? "warning" : "default"}>{sample.status}</Badge>;
  }
  return {
    name: card.name,
    seed: card.id,
    line: card.tagline,
    status,
    selected: card.is_default,
    menu: actions,
    onSelect,
  };
}

/** /companions: the companions this person may use, as a card grid. */
export function CompanionsPage() {
  useTabItem("Companions");
  const navigate = useNavigate();
  const query = useQuery<CompanionList>({ queryKey: listKey, queryFn: api.companions, retry: false });
  const preview = useCompanionShells();
  const [discoverFilter, setDiscoverFilter] = useState("All");
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CompanionCard | null>(null);
  const queryClient = useQueryClient();
  const saveDefault = useMutation({ mutationFn: (id: string) => api.setDefaultCompanion(id), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: listKey }); }, onError: (error) => setActionError(error instanceof ApiError ? error.message : "Could not set your default. Check your connection and try again.") });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteCompanion(id), onSuccess: () => { setDeleteTarget(null); void queryClient.invalidateQueries({ queryKey: listKey }); }, onError: (error) => setActionError(error instanceof ApiError ? error.message : "Could not delete this companion. Check your connection and try again.") });
  return (
    <div className="flex flex-col gap-6" data-testid="companions">
      {actionError ? <Alert variant="destructive"><AlertDescription>{actionError}</AlertDescription></Alert> : null}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Companions</h1>
          <p className="text-sm text-muted-foreground">A companion is how your assistant sounds. Pick one, read about it, and make it your default.</p>
        </div>
      </div>
      <AsyncState
        data={query.isError ? null : query.data}
        error={query.isError}
        isFetching={query.isFetching}
        onRetry={() => query.refetch()}
        errorMessage={query.error instanceof ApiError ? query.error.message : "Could not load the companions. Check your connection and try again."}
        loadingLabel="Loading companions"
      >
        {(data: CompanionList) => (
          <>
            {!data.allowed ? (
              <EmptyState icon="user" text="Companions are turned off for you. Ask an owner or admin to turn them on." />
            ) : data.companions.length === 0 ? (
              <EmptyState icon="user" text="No companions are installed yet." />
            ) : preview === true ? (
              <Tabs defaultValue="Yours">
                <TabsList>
                  <TabsTrigger value="Yours">Yours</TabsTrigger>
                  {data.can_discover ? <TabsTrigger value="Discover">Discover</TabsTrigger> : null}
                </TabsList>
                <TabsContent value="Yours">
                  <div className="grid grid-cols-2 justify-items-center gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {data.companions.map((card) => <div key={card.id}>
                      <CharacterTile {...companionTileProps({ card, preview: true, onDelete: setDeleteTarget, onSetDefault: (item) => saveDefault.mutate(item.id), onSelect: () => navigate(`/companions/${encodeURIComponent(card.id)}`) })} />
                      <p className="mt-1 text-center text-sm text-muted-foreground">{companionPreviewSample(card.id).activityLine}</p>
                    </div>)}
                    {data.can_create ? <CharacterTile name="New companion" variant="add" onSelect={() => navigate("/companions/start")} /> : null}
                  </div>
                  <p className="mt-4 text-sm text-muted-foreground">Sample activity. Real activity is coming soon.</p>
                </TabsContent>
                {data.can_discover ? <TabsContent value="Discover">
                  <div className="flex flex-wrap gap-2">
                    {["All", "Chat", "Research", "Shopping", "Stories", "Kids"].map((item) =>
                      <Chip key={item} selected={discoverFilter === item} onClick={() => setDiscoverFilter(item)}>{item}</Chip>)}
                  </div>
                  <div className="grid grid-cols-2 justify-items-center gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {data.companions.filter((card) => !card.is_default).map((card) => <div key={card.id}>
                      <CharacterTile {...companionTileProps({ card, discover: true, onDelete: setDeleteTarget, onSetDefault: (item) => saveDefault.mutate(item.id), onSelect: () => navigate(`/companions/${encodeURIComponent(card.id)}`) })} />
                      <div className="mt-2"><Button disabled>Add</Button></div>
                    </div>)}
                  </div>
                  <p className="mt-4 text-sm text-muted-foreground">Coming soon: add a companion to your set from here.</p>
                </TabsContent> : null}
              </Tabs>
            ) : (
              <div className="grid grid-cols-2 justify-items-center gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {data.companions.map((card) => <CharacterTile key={card.id} {...companionTileProps({ card, onDelete: setDeleteTarget, onSetDefault: (item) => saveDefault.mutate(item.id), onSelect: () => navigate(`/companions/${encodeURIComponent(card.id)}`) })} />)}
                {data.can_create ? <CharacterTile name="New companion" variant="add" onSelect={() => navigate("/companions/new")} /> : null}
              </div>
            )}
            <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
              <AlertDialogContent onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                <AlertDialogHeader><AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle><AlertDialogDescription>This removes it for the whole home.</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={remove.isPending} onClick={() => { if (deleteTarget) remove.mutate(deleteTarget.id); }}>Delete</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </AsyncState>
    </div>
  );
}

/** /companions/:id: one companion in full, a voice preview, and Set as my default. */
export function CompanionDetailPage() {
  const { id = "" } = useParams();
  const preview = useCompanionShells();
  const query = useQuery<CompanionDetail>({ queryKey: [...listKey, id], queryFn: () => api.companion(id), retry: false });
  useTabItem(query.data?.name ?? "Companion");
  return (
    <div className="flex flex-col gap-6" data-testid="companion-detail">
      <Link to="/companions" className="text-sm underline">All companions</Link>
      <AsyncState
        data={query.isError ? null : query.data}
        error={query.isError}
        isFetching={query.isFetching}
        onRetry={() => query.refetch()}
        errorMessage={query.error instanceof ApiError && query.error.status === 404 ? "That companion is not on your list. Go back and pick one from the gallery." : "Could not load this companion. Check your connection and try again."}
        loadingLabel="Loading companion"
      >
        {(companion: CompanionDetail) => <>
          {preview === true ? <>
            <DetailBody companion={companion} headerOnly />
            <Tabs defaultValue="Activity">
            <TabsList>
              <TabsTrigger value="Activity">Activity</TabsTrigger>
              <TabsTrigger value="About">About</TabsTrigger>
              <TabsTrigger value="Tasks">Tasks</TabsTrigger>
              <TabsTrigger value="Chats">Chats</TabsTrigger>
            </TabsList>
            <TabsContent value="Activity">
              <section aria-labelledby="recent-activity-heading" className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="recent-activity-heading" className="text-lg font-semibold">Recent activity</h2>
                  <span className="text-sm text-muted-foreground">Today</span>
                </div>
                <ul className="flex list-none flex-col gap-2 p-0">
                  {companionPreviewSample(companion.id).activities.map((activity) => {
                    const ActivityIcon = getIcon(activity.icon);
                    return <li key={activity.title} className="flex items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted"><ActivityIcon aria-hidden="true" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{activity.title}</p>
                        <p className="text-sm text-muted-foreground">{activity.detail}</p>
                      </div>
                      <ChevronRightIcon aria-hidden="true" className="text-muted-foreground" />
                    </li>;
                  })}
                </ul>
                <p className="text-sm text-muted-foreground">Sample activity. Real activity is coming soon.</p>
              </section>
            </TabsContent>
            <TabsContent value="About"><DetailBody companion={companion} aboutOnly /></TabsContent>
            <TabsContent value="Tasks"><EmptyState icon="check" text={`Coming soon: tasks ${companion.name} is working on.`} /></TabsContent>
            <TabsContent value="Chats"><EmptyState icon="message-circle" text={`Coming soon: your chats with ${companion.name}.`} /></TabsContent>
          </Tabs>
          </> : <DetailBody companion={companion} />}
        </>}
      </AsyncState>
    </div>
  );
}

function DetailBody({ companion, headerOnly = false, aboutOnly = false }: { companion: CompanionDetail; headerOnly?: boolean; aboutOnly?: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const copy = useMutation({ mutationFn: () => api.copyCompanion(companion.id), onSuccess: (result) => {
    void queryClient.invalidateQueries({ queryKey: listKey });
    navigate(`/companions/${encodeURIComponent(result.id)}/edit`);
  } });
  const save = useMutation({ mutationFn: () => api.setDefaultCompanion(companion.id), onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: listKey });
  } });
  return <DetailSetup companion={companion} saved={save.isSuccess || companion.is_default} copy={copy} save={save} headerOnly={headerOnly} aboutOnly={aboutOnly} />;
}

function DetailSetup({ companion, saved, copy, save, headerOnly = false, aboutOnly = false }: { companion: CompanionDetail; saved: boolean; copy: UseMutationResult<unknown, Error, void>; save: UseMutationResult<unknown, Error, void>; headerOnly?: boolean; aboutOnly?: boolean }) {
  const preview = useCompanionShells() === true;
  return (
    <>
      {!aboutOnly ? <>
      <>
      <h1 className="sr-only">{companion.name}</h1>
      <CharacterHero name={companion.name} seed={companion.id} line={<><span>{companion.tagline}</span><div className="flex flex-wrap justify-center gap-2"><Badge>{companion.type_label}</Badge>{saved ? <Badge>Your default</Badge> : null}</div></>} actions={<>
          {preview ? <Button type="button" disabled title="Coming soon">Chat</Button> : null}
          {companion.can_edit ? <Link to={`/companions/${encodeURIComponent(companion.id)}/edit`}><Button type="button" variant="ghost" size="icon" aria-label="Companion settings" title="Companion settings"><SettingsIcon /></Button></Link> : null}
          {companion.can_copy ? <Button type="button" variant="outline" disabled={copy.isPending} onClick={() => copy.mutate()}>{companion.is_household ? "Make a copy" : "Edit a copy"}</Button> : null}
          <Button type="button" disabled={saved || save.isPending} onClick={() => save.mutate()}>{saved ? "Your default" : "Set as my default"}</Button>
      </>} />
      </>
      {save.isError ? <Alert variant="destructive"><AlertDescription>{save.error instanceof ApiError ? save.error.message : "Could not save this. Check your connection and try again."}</AlertDescription></Alert> : null}
      {copy.isError ? <Alert variant="destructive"><AlertDescription>{copy.error instanceof ApiError ? copy.error.message : "Could not reach Home. Check your connection and try again."}</AlertDescription></Alert> : null}
      </> : null}
      {!headerOnly ? <>
      {!companion.is_household && companion.can_copy ? <p>This companion comes with Home, so it can't be changed. Make a copy and edit that.</p> : null}
      <Section heading="About">
        <p>{companion.about}</p>
        {companion.pronouns ? <p className="text-sm text-muted-foreground">Pronouns: {companion.pronouns}</p> : null}
        {companion.interests.length > 0 ? <p className="text-sm text-muted-foreground">Likes: {companion.interests.join(", ")}.</p> : null}
        <p className="text-sm text-muted-foreground">{companion.who_can_use}</p>
      </Section>
      <Section heading="How it talks">
        <dl className="grid gap-3 sm:grid-cols-2">
          {companion.dials.map((dial) => (
            <div key={dial.label}><dt className="text-sm font-medium">{dial.label}</dt><dd className="text-muted-foreground">{dial.value}</dd></div>
          ))}
        </dl>
      </Section>
      <Section heading="Things it might say">
        <ul className="flex list-none flex-col gap-2 p-0">
          {companion.examples.map((line) => <li key={line}>&ldquo;{line}&rdquo;</li>)}
        </ul>
      </Section>
      <Section heading="Voice"><VoiceRow companion={companion} /></Section>
      {companion.used_by ? (
        <Section heading="Who uses it">
          <p>People: {companion.used_by.people.length ? companion.used_by.people.map((person) => person.name).join(", ") : "nobody yet"}.</p>
          <p>Robots: {companion.used_by.robots.length ? companion.used_by.robots.map((robot) => robot.name).join(", ") : "none yet"}. <Link to={ROBOT_SETTINGS} className="underline">Companion settings</Link></p>
        </Section>
      ) : null}
      </> : null}
    </>
  );
}

/** The voice this companion speaks in, with a Test button that plays the same preview Settings uses. */
function VoiceRow({ companion }: { companion: CompanionDetail }) {
  const voices = useQuery({ queryKey: ["stack-voices"], queryFn: api.stackVoices, retry: false });
  const [preview, setPreview] = useState<VoicePreviewState>(voicePreviewPlayer.getState());
  useEffect(() => {
    const unsubscribe = voicePreviewPlayer.subscribe(setPreview);
    return () => { unsubscribe(); voicePreviewPlayer.stop(); };
  }, []);
  const queryClient = useQueryClient();
  const saveVoice = useMutation({
    mutationFn: (voiceId: string) => api.setSetting("household", companionVoiceKey(companion.id), voiceId),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: listKey }); },
  });
  const list = voices.data?.voices ?? [];
  const picker = companion.voice_setting !== null && list.length ? voiceChoices(playableVoices(list), companion.voice_setting, []) : null;
  const choice = list.length ? voiceChoices(list, companion.voice_value, [companion.voice_value]).selected : null;
  const previewId = choice ? previewIdFor(choice, list) : null;
  const testing = previewId !== null && preview.voiceId === previewId;
  const busy = testing && preview.busy;
  return (
    <div className="flex flex-col gap-2">
      <p>{companion.voice_is_own ? "Its own voice" : "The voice you chose in Settings"}{choice ? `: ${choice.label}` : "."}</p>
      <div>
        <Button type="button" variant="outline" disabled={previewId === null || busy} onClick={() => (testing ? voicePreviewPlayer.stop() : previewId && void voicePreviewPlayer.start(previewId))}>
          {testing && !busy ? "Stop" : "Play a sample"}
        </Button>
      </div>
      {picker ? (
        <div className="flex flex-col gap-1">
          <Select
            aria-label="Voice for this companion"
            value={picker.selected.value}
            options={picker.options.map((option) => option.value)}
            getLabel={(value) => picker.options.find((option) => option.value === value)?.label ?? value}
            disabled={saveVoice.isPending}
            onValueChange={(value) => saveVoice.mutate(value)}
          />
          {saveVoice.isError ? <Alert variant="destructive"><AlertDescription>{saveVoice.error instanceof ApiError ? saveVoice.error.message : "Could not save this voice. Check your connection and try again."}</AlertDescription></Alert> : null}
        </div>
      ) : null}
      {voices.isError ? <Alert variant="destructive"><AlertDescription>Home can't reach its voice service. Check Repairs, then come back.</AlertDescription></Alert> : null}
      {preview.error ? <Alert variant="destructive"><AlertDescription>{preview.error}</AlertDescription></Alert> : null}
    </div>
  );
}
