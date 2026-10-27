import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { Section } from "@maipai/ui/src/primitives/Section";
import { CompanionCard as CompanionCardElement } from "@maipai/ui/src/elements/companion-card";
import { CompanionProfileHeader } from "@maipai/ui/src/elements/companion-profile-header";
import { Avatar, AvatarFallback, AvatarImage } from "@maipai/ui/src/elements/ui/avatar";
import { Badge } from "@maipai/ui/src/elements/ui/badge";
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
import { formatRelative } from "@maipai/ui/src/relativeTime";
import { Status } from "@maipai/ui/src/ui/status";
import { Input } from "@maipai/ui/src/ui/input";
import { useCompanionStills } from "@/apps/chat/useCompanionAvatar";

const listKey = ["companions"] as const;
const ROBOT_SETTINGS = "/settings/apps?tab=robot";
const MoreIcon = getIcon("more-horizontal");

async function openCompanionChat(card: CompanionCard, navigate: ReturnType<typeof useNavigate>, onError: (message: string) => void) {
  try {
    const chats = await api.conversationList();
    const latest = chats.filter((chat) => chat.companion_id === card.id)
      .sort((a, b) => new Date(b.last_turn_at ?? b.created_at).getTime() - new Date(a.last_turn_at ?? a.created_at).getTime())[0];
    if (latest) navigate(`/chat?conversation=${encodeURIComponent(latest.id)}`);
    else {
      const conversation = await api.createConversation(undefined, undefined, undefined, card.id);
      navigate(`/chat?conversation=${encodeURIComponent(conversation.id)}`);
    }
  } catch (error) {
    onError(error instanceof ApiError ? error.message : "Could not open a chat. Check your connection and try again.");
  }
}

function companionMenu({ card, discover = false, onDelete, onRemove, onSetDefault }: { card: CompanionCard; discover?: boolean; onDelete: (card: CompanionCard) => void; onRemove?: (card: CompanionCard) => void; onSetDefault: (card: CompanionCard) => void }) {
  const actions = <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="ghost" size="icon" aria-label="Companion actions" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><MoreIcon aria-hidden="true" /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <DropdownMenuItem disabled={card.is_default} onSelect={() => onSetDefault(card)}>Set as my default</DropdownMenuItem>
      {!discover && onRemove ? <DropdownMenuItem disabled={card.is_default} onSelect={() => onRemove(card)}>Remove from Yours</DropdownMenuItem> : null}
      {card.can_edit && card.is_household ? <DropdownMenuItem variant="destructive" onSelect={() => onDelete(card)}>Delete</DropdownMenuItem> : null}
    </DropdownMenuContent>
  </DropdownMenu>;
  return actions;
}

/** /companions: the companions this person may use, as a card grid. */
function CompanionsDirectory() {
  useTabItem("Companions");
  const navigate = useNavigate();
  const preview = useCompanionShells();
  const query = useQuery<CompanionList>({ queryKey: listKey, queryFn: api.companions, retry: false });
  const [discoverFilter, setDiscoverFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CompanionCard | null>(null);
  const queryClient = useQueryClient();
  const companionStills = useCompanionStills([...(query.data?.companions ?? []), ...(query.data?.discover ?? [])].map(({ id }) => id));
  const saveDefault = useMutation({ mutationFn: (id: string) => api.setDefaultCompanion(id), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: listKey }); }, onError: (error) => setActionError(error instanceof ApiError ? error.message : "Could not set your default. Check your connection and try again.") });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteCompanion(id), onSuccess: () => { setDeleteTarget(null); void queryClient.invalidateQueries({ queryKey: listKey }); }, onError: (error) => setActionError(error instanceof ApiError ? error.message : "Could not delete this companion. Check your connection and try again.") });
  const addToYours = useMutation({ mutationFn: (id: string) => api.addCompanion(id), onSuccess: () => { setActionError(null); void queryClient.invalidateQueries({ queryKey: listKey }); }, onError: (error) => setActionError(error instanceof ApiError ? error.message : "Could not add this companion. Check your connection and try again.") });
  const removeFromYours = useMutation({ mutationFn: (id: string) => api.removeCompanion(id), onSuccess: () => { setActionError(null); void queryClient.invalidateQueries({ queryKey: listKey }); }, onError: (error) => setActionError(error instanceof ApiError ? error.message : "Could not remove this companion. Check your connection and try again.") });
  return (
    <>
      {actionError ? <Alert variant="destructive"><AlertDescription>{actionError}</AlertDescription></Alert> : null}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Companions</h1>
          <p className="text-sm text-muted-foreground">Familiar faces. Different ways to help.</p>
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
            ) : (
              <Tabs defaultValue="Yours">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <TabsList>
                    <TabsTrigger value="Yours">Yours</TabsTrigger>
                    {data.can_discover ? <TabsTrigger value="Discover">Discover</TabsTrigger> : null}
                  </TabsList>
                  <div className="w-full sm:w-72"><Input aria-label="Search companions" type="search" placeholder="Search companions" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
                </div>
                <TabsContent value="Yours">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {data.companions.filter((card) => `${card.name} ${card.tagline}`.toLowerCase().includes(search.trim().toLowerCase())).map((card) => <CompanionCardElement key={card.id} name={card.name} line={card.tagline} media={<Avatar><AvatarImage src={companionStills[card.id]} alt={card.name} /><AvatarFallback>{card.name.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>} status={card.is_default ? "Your default" : card.status === "ready" ? "Ready" : card.status === "draft" ? "Draft · needs a portrait" : card.status} menu={companionMenu({ card, onDelete: setDeleteTarget, onRemove: (item) => removeFromYours.mutate(item.id), onSetDefault: (item) => saveDefault.mutate(item.id) })} meta={(card.working_count ?? 0) + (card.waiting_count ?? 0) > 0 ? <Status status={(card.waiting_count ?? 0) > 0 ? "degraded" : "online"}>{card.working_count ?? 0} working · {card.waiting_count ?? 0} waiting on you</Status> : card.latest_activity ? `Last active ${formatRelative(card.latest_activity)} · ${card.chat_count ?? card.chats} chats` : "Choose a conversation to get started"} actions={<><Button type="button" onClick={() => void openCompanionChat(card, navigate, setActionError)}>{(card.chat_count ?? card.chats) > 0 ? "Continue" : "Chat"}</Button><Button type="button" variant="outline" onClick={() => navigate(`/companions/${encodeURIComponent(card.id)}`)}>View profile</Button></>} />)}
                  </div>
                </TabsContent>
                {data.can_discover ? <TabsContent value="Discover">
                  <div className="flex flex-wrap gap-2">
                    {["All", "Chat", "Research", "Shopping", "Stories", "Kids"].map((item) =>
                      <Chip key={item} selected={discoverFilter === item} onClick={() => setDiscoverFilter(item)}>{item}</Chip>)}
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {data.discover.filter((card) => `${card.name} ${card.tagline}`.toLowerCase().includes(search.trim().toLowerCase())).filter((card) => discoverFilter === "All" || card.tagline.toLowerCase().includes(discoverFilter.toLowerCase())).map((card) => <CompanionCardElement key={card.id} name={card.name} line={card.tagline} media={<Avatar><AvatarImage src={companionStills[card.id]} alt={card.name} /><AvatarFallback>{card.name.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>} status={card.is_default ? "Your default" : card.status === "ready" ? "Ready" : card.status === "draft" ? "Draft · needs a portrait" : card.status} menu={companionMenu({ card, discover: true, onDelete: setDeleteTarget, onSetDefault: (item) => saveDefault.mutate(item.id) })} meta={(card.working_count ?? 0) + (card.waiting_count ?? 0) > 0 ? <Status status={(card.waiting_count ?? 0) > 0 ? "degraded" : "online"}>{card.working_count ?? 0} working · {card.waiting_count ?? 0} waiting on you</Status> : card.latest_activity ? `Last active ${formatRelative(card.latest_activity)} · ${card.chat_count ?? card.chats} chats` : "Choose a conversation to get started"} actions={<Button disabled={addToYours.isPending} onClick={() => addToYours.mutate(card.id)}>Add</Button>} />)}
                  </div>
                  <p className="mt-4 text-sm text-muted-foreground">More companions from the catalog are coming soon.</p>
                </TabsContent> : null}
              </Tabs>
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
    </>
  );
}

export function CompanionsPage() {
  return <CompanionsDirectory />;
}

/** /companions/:id: one companion in full, a voice preview, and Set as my default. */
export function CompanionDetailPage() {
  const { id = "" } = useParams();
  const query = useQuery<CompanionDetail>({ queryKey: [...listKey, id], queryFn: () => api.companion(id), retry: false });
  useTabItem(query.data?.name ?? "Companion");
  return (
    <div className="flex flex-col gap-6" data-testid="companion-detail">
      <AsyncState
        data={query.isError ? null : query.data}
        error={query.isError}
        isFetching={query.isFetching}
        onRetry={() => query.refetch()}
        errorMessage={query.error instanceof ApiError && query.error.status === 404 ? "That companion is not on your list. Go back and pick one from the gallery." : "Could not load this companion. Check your connection and try again."}
        loadingLabel="Loading companion"
      >
        {(companion: CompanionDetail) => <DetailBody companion={companion} />}
      </AsyncState>
    </div>
  );
}

function DetailBody({ companion }: { companion: CompanionDetail }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const copy = useMutation({ mutationFn: () => api.copyCompanion(companion.id), onSuccess: (result) => {
    void queryClient.invalidateQueries({ queryKey: listKey });
    navigate(`/companions/${encodeURIComponent(result.id)}/edit`);
  } });
  const save = useMutation({ mutationFn: () => api.setDefaultCompanion(companion.id), onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: listKey });
  } });
  return <DetailSetup companion={companion} saved={save.isSuccess || companion.is_default} copy={copy} save={save} />;
}

function DetailSetup({ companion, saved, copy, save }: { companion: CompanionDetail; saved: boolean; copy: UseMutationResult<unknown, Error, void>; save: UseMutationResult<unknown, Error, void> }) {
  const navigate = useNavigate();
  const stills = useCompanionStills([companion.id]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [startingChat, setStartingChat] = useState(false);
  const startChat = async () => {
    setStartingChat(true);
    setChatError(null);
    try {
      const conversation = await api.createConversation(undefined, undefined, undefined, companion.id);
      navigate(`/chat?conversation=${encodeURIComponent(conversation.id)}`);
    } catch (error) {
      setChatError(error instanceof ApiError ? `${error.message} Choose another companion or try again.` : "Could not start a chat with this companion. Check your connection and try again.");
    } finally {
      setStartingChat(false);
    }
  };
  return (
    <>
      <CompanionProfileHeader name={companion.name} eyebrow={companion.is_household ? "Household companion" : "Built-in companion"} line={companion.tagline} back={<Link to="/companions" className="text-sm underline">All companions</Link>} media={<Avatar size="lg"><AvatarImage src={stills[companion.id]} alt={companion.name} /><AvatarFallback>{companion.name.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>} chips={<><Badge variant="secondary">{companion.who_can_use}</Badge>{saved ? <Badge>Your default</Badge> : null}<Badge variant="outline">{companion.status === "ready" ? "Ready" : companion.status === "draft" ? "Draft · needs a portrait" : companion.status}</Badge></>} actions={<>

              <Button type="button" disabled={startingChat} onClick={() => void startChat()}>{startingChat ? "Starting chat…" : `Chat with ${companion.name}`}</Button>
          {companion.can_copy ? <Button type="button" variant="outline" disabled={copy.isPending} onClick={() => copy.mutate()}>Customize a copy</Button> : null}
          {companion.can_edit ? <Link to={`/companions/${encodeURIComponent(companion.id)}/edit`}><Button type="button" variant="outline">Edit</Button></Link> : null}
      </>} />
      {save.isError ? <Alert variant="destructive"><AlertDescription>{save.error instanceof ApiError ? save.error.message : "Could not save this. Check your connection and try again."}</AlertDescription></Alert> : null}
      {chatError ? <Alert variant="destructive"><AlertDescription>{chatError}</AlertDescription></Alert> : null}
      {copy.isError ? <Alert variant="destructive"><AlertDescription>{copy.error instanceof ApiError ? copy.error.message : "Could not reach Home. Check your connection and try again."}</AlertDescription></Alert> : null}
      {!companion.is_household && companion.can_copy ? <p>This companion comes with Home, so it can't be changed. Make a copy and edit that.</p> : null}
      <Tabs defaultValue="Activity">
        <TabsList><TabsTrigger value="Activity">Activity</TabsTrigger><TabsTrigger value="About">About</TabsTrigger><TabsTrigger value="Tasks">Tasks{(companion.task_count ?? 0) > 0 ? <Badge variant="secondary">{companion.task_count}</Badge> : null}</TabsTrigger></TabsList>
        <TabsContent value="Activity"><CompanionWorkList companion={companion} mode="activity" /></TabsContent>
        <TabsContent value="Tasks"><CompanionWorkList companion={companion} mode="tasks" /></TabsContent>
        <TabsContent value="About">
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
        </TabsContent>
      </Tabs>
    </>
  );
}

function CompanionWorkList({ companion, mode }: { companion: CompanionDetail; mode: "activity" | "tasks" }) {
  const query = useQuery({ queryKey: ["companion-activity", companion.id], queryFn: () => api.companionActivity(companion.id), retry: false });
  const rows = query.data?.activity ?? [];
  const tasks = mode === "tasks" ? rows : rows;
  if (query.isLoading) return <p>Loading {mode}…</p>;
  if (query.isError) return <p>Could not load {mode}. Check your connection and try again.</p>;
  if (!tasks.length) return <p>No {mode} for {companion.name} yet.</p>;
  return <ul className="flex list-none flex-col gap-3 p-0">{tasks.map((item) => <li key={item.id}><p className="font-medium">{item.title}</p><p className="text-sm text-muted-foreground">{item.state} · {formatRelative(item.updated_at)}</p></li>)}</ul>;
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
