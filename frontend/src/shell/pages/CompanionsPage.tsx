import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { Section } from "@maipai/ui/src/primitives/Section";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { CardGrid } from "@maipai/ui/src/primitives/CardGrid";
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

/** The inside of one gallery card, shared by Yours and Discover. */
function CompanionBody({ card, preview = false, discover = false, onFailure, onDelete }: { card: CompanionCard; preview?: boolean; discover?: boolean; onFailure: (message: string) => void; onDelete: (card: CompanionCard) => void }) {
  const queryClient = useQueryClient();
  const save = useMutation({ mutationFn: () => api.setDefaultCompanion(card.id), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: listKey }); }, onError: (error) => onFailure(error instanceof ApiError ? error.message : "Could not set your default. Check your connection and try again.") });
  const title = <span className="font-semibold">{card.name}</span>;
  const actions = <div className="flex justify-end"><DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="ghost" size="icon" aria-label="Companion actions" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><MoreIcon aria-hidden="true" /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <DropdownMenuItem disabled={card.is_default || save.isPending} onSelect={() => save.mutate()}>{card.is_default ? "Your default" : "Set as my default"}</DropdownMenuItem>
      {card.can_edit && card.is_household ? <DropdownMenuItem variant="destructive" onSelect={() => onDelete(card)}>Delete</DropdownMenuItem> : null}
    </DropdownMenuContent>
  </DropdownMenu></div>;
  if (preview && !discover) {
    const sample = companionPreviewSample(card.id);
    const statusClass = sample.status === "Working" ? "bg-[color:var(--hue-teal)] text-foreground" : sample.status === "Needs approval" ? "bg-[color:var(--hue-orange)] text-foreground" : "bg-muted text-foreground";
    return (
      <div className="flex flex-col gap-3 text-left">
        <div className="flex items-center justify-between gap-3">
          <Avatar name={card.name} size="profile" />
          <div className="ml-auto flex items-center gap-2">{actions}</div>
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${statusClass}`}>{sample.status}</span>
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-base">{title}</h2>
          <p className="text-sm text-muted-foreground">{card.tagline}</p>
          <p className="text-sm text-muted-foreground">{sample.activityLine}</p>
        </div>
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{sample.tasks} tasks · {card.chats} chats</span>
          <ChevronRightIcon aria-hidden="true" />
        </div>
      </div>
    );
  }
  return (
    <div className="relative flex flex-col items-center gap-3 text-center">
      <div className="absolute right-0 top-0">{actions}</div>
      <Avatar name={card.name} size="profile" />
      <div className="flex flex-col gap-1">
        <h2 className="text-base">{title}</h2>
        <p className="text-sm text-muted-foreground">{card.tagline}</p>
        <p className="text-sm text-muted-foreground">{card.who_can_use}</p>
        {preview && !discover ? <p className="text-sm text-muted-foreground">{card.chats} chats</p> : null}
        {preview && !discover ? <p className="text-sm text-muted-foreground">Voice: {card.voice}</p> : null}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Badge>{card.type_label}</Badge>
        {discover ? <Badge>{card.is_household ? "Made at home" : "Included"}</Badge> : null}
        {!discover && card.is_household ? <Badge>Made at home</Badge> : null}
        {!discover && card.status === "draft" ? <Badge>Draft</Badge> : null}
        {!discover && card.is_default ? <Badge>Your default</Badge> : null}
      </div>
      {discover ? <Button disabled>Add</Button> : null}
      {!discover ? <ul className="flex list-none flex-col gap-1 p-0 text-sm text-muted-foreground">
        {card.dials.map((dial) => <li key={dial.label}>{dial.value}</li>)}
      </ul> : null}
    </div>
  );
}

/** /companions: the companions this person may use, as a card grid. An owner or admin also sees which companion each robot has. */
export function CompanionsPage() {
  useTabItem("Companions");
  const navigate = useNavigate();
  const query = useQuery<CompanionList>({ queryKey: listKey, queryFn: api.companions, retry: false });
  const preview = useCompanionShells();
  const [discoverFilter, setDiscoverFilter] = useState("All");
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CompanionCard | null>(null);
  const queryClient = useQueryClient();
  const remove = useMutation({ mutationFn: (id: string) => api.deleteCompanion(id), onSuccess: () => { setDeleteTarget(null); void queryClient.invalidateQueries({ queryKey: listKey }); }, onError: (error) => setActionError(error instanceof ApiError ? error.message : "Could not delete this companion. Check your connection and try again.") });
  return (
    <div className="flex flex-col gap-6" data-testid="companions">
      {actionError ? <Alert variant="destructive"><AlertDescription>{actionError}</AlertDescription></Alert> : null}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Companions</h1>
          <p className="text-sm text-muted-foreground">A companion is how your assistant sounds. Pick one, read about it, and make it your default.</p>
        </div>
        {query.data?.can_create ? <Link to={preview === true ? "/companions/start" : "/companions/new"}><Button>New companion</Button></Link> : null}
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
                  <CardGrid label="Companions" items={data.companions} getKey={(card) => card.id} getLabel={(card) => card.name}
                    onSelect={(card) => navigate(`/companions/${encodeURIComponent(card.id)}`)}
                    renderItem={(card) => <CompanionBody card={card} preview onFailure={setActionError} onDelete={setDeleteTarget} />} />
                  <p className="mt-4 text-sm text-muted-foreground">Sample activity. Real activity is coming soon.</p>
                </TabsContent>
                {data.can_discover ? <TabsContent value="Discover">
                  <div className="flex flex-wrap gap-2">
                    {["All", "Chat", "Research", "Shopping", "Stories", "Kids"].map((item) =>
                      <Chip key={item} selected={discoverFilter === item} onClick={() => setDiscoverFilter(item)}>{item}</Chip>)}
                  </div>
                  <CardGrid label="Discover companions" items={data.companions.filter((card) => !card.is_default)}
                    getKey={(card) => card.id} renderItem={(card) => <CompanionBody card={card} discover onFailure={setActionError} onDelete={setDeleteTarget} />} />
                  <p className="mt-4 text-sm text-muted-foreground">Coming soon: add a companion to your set from here.</p>
                </TabsContent> : null}
              </Tabs>
            ) : (
              <CardGrid
                label="Companions"
                items={data.companions}
                getKey={(card) => card.id}
                getLabel={(card) => card.name}
                onSelect={(card) => navigate(`/companions/${encodeURIComponent(card.id)}`)}
                renderItem={(card) => <CompanionBody card={card} onFailure={setActionError} onDelete={setDeleteTarget} />}
              />
            )}
            <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
              <AlertDialogContent onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                <AlertDialogHeader><AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle><AlertDialogDescription>This removes it for the whole home.</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={remove.isPending} onClick={() => { if (deleteTarget) remove.mutate(deleteTarget.id); }}>Delete</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            {data.robots ? <RobotAssignments robots={data.robots} /> : null}
          </>
        )}
      </AsyncState>
    </div>
  );
}

function RobotAssignments({ robots }: { robots: NonNullable<CompanionList["robots"]> }) {
  return (
    <Section heading="Robots">
      {robots.length === 0 ? (
        <p className="text-sm text-muted-foreground">No robots are set up yet.</p>
      ) : (
        <ul aria-label="Robots" className="flex list-none flex-col gap-2 p-0">
          {robots.map((robot) => (
            <li key={robot.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>{robot.name}: {robot.companion_name ?? "No companion yet"} <span className="text-sm text-muted-foreground">({robot.controls} controls)</span></span>
              <Link to={ROBOT_SETTINGS} className="text-sm underline">Companion settings</Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
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
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <Avatar name={companion.name} size="profile" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{companion.name}</h1>
          <p className="text-muted-foreground">{companion.tagline}</p>
          <div className="flex flex-wrap gap-2"><Badge>{companion.type_label}</Badge>{saved ? <Badge>Your default</Badge> : null}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {preview ? <Button type="button" disabled title="Coming soon">Chat</Button> : null}
          {companion.can_edit ? <Link to={`/companions/${encodeURIComponent(companion.id)}/edit`}><Button type="button" variant="ghost" size="icon" aria-label="Companion settings" title="Companion settings"><SettingsIcon /></Button></Link> : null}
          {companion.can_copy ? <Button type="button" variant="outline" disabled={copy.isPending} onClick={() => copy.mutate()}>{companion.is_household ? "Make a copy" : "Edit a copy"}</Button> : null}
          <Button type="button" disabled={saved || save.isPending} onClick={() => save.mutate()}>{saved ? "Your default" : "Set as my default"}</Button>
        </div>
      </div>
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
