import { i18n } from "@lingui/core";
import { listWords } from "@/shell/pages/listWords";
import { useContext, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { Section } from "@maipai/ui/src/primitives/Section";
import { CompanionCard as CompanionCardElement } from "@maipai/ui/src/elements/companion-card";
import { CompanionProfileHeader } from "@maipai/ui/src/elements/companion-profile-header";
import { Avatar, AvatarImage } from "@maipai/ui/src/elements/ui/avatar";
import { Avatar as SeededAvatar } from "@maipai/ui/src/primitives/Avatar";
import { Badge } from "@maipai/ui/src/elements/ui/badge";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Select } from "@maipai/ui/src/primitives/Select";
import { companionVoiceKey } from "@/lib/companionVoice";
import { api, ApiError, type CompanionActivity, type CompanionCard, type CompanionDetail, type CompanionList } from "@/lib/api";
import { playableVoices, previewIdFor, voiceChoices } from "@/lib/voice/voiceBrowserRows";
import { voicePreviewPlayer, type VoicePreviewState } from "@/lib/voice/voicePreviewPlayer";
import { useTabItem } from "@/shell/tabIdentity";
import { CompanionShellViewer } from "@/lib/companionShells";
import { CompanionAudienceDialog } from "@/shell/pages/CompanionAudienceDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@maipai/ui/src/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@maipai/ui/src/ui/dropdown-menu";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { getIcon } from "@maipai/ui/src/icons";
import { formatRelative } from "@/lib/time";
import { Status } from "@maipai/ui/src/ui/status";
import { Input } from "@maipai/ui/src/ui/input";
import { useCompanionStills } from "@/apps/chat/useCompanionAvatar";
import { ActivityFeed, type ActivityFeedGroup } from "@maipai/ui/src/elements/activity-feed";
import { TaskBrowser } from "@maipai/ui/src/elements/task-browser";
import { Card } from "@maipai/ui/src/primitives/Card";
import { errorLine } from "@/lib/hubReachability";

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
    onError(errorLine(error, i18n._({ id: "Could not open a chat. Check your connection and try again.", message: "Could not open a chat. Check your connection and try again." })));
  }
}

type MenuActions = { onDelete: (card: CompanionCard) => void; onRemove?: (card: CompanionCard) => void; onSetDefault: (card: CompanionCard) => void; onEdit?: (card: CompanionCard) => void; onCopy?: (card: CompanionCard) => void; onStatus?: (card: CompanionCard, next: "draft" | "ready") => void; onAudience?: (card: CompanionCard) => void };

function companionMenu({ card, discover = false, onDelete, onRemove, onSetDefault, onEdit, onCopy, onStatus, onAudience }: MenuActions & { card: CompanionCard; discover?: boolean }) {
  const own = card.can_edit && card.is_household;
  const actions = <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="ghost" size="icon" aria-label={i18n._({ id: "Companion actions", message: "Companion actions" })} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><MoreIcon aria-hidden="true" /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      {own && onEdit ? <DropdownMenuItem onSelect={() => onEdit(card)}>{i18n._({ id: "Edit", message: "Edit" })}</DropdownMenuItem> : null}
      <DropdownMenuItem disabled={card.is_default} onSelect={() => onSetDefault(card)}>{i18n._({ id: "Set as my default", message: "Set as my default" })}</DropdownMenuItem>
      {card.can_copy && onCopy ? <DropdownMenuItem onSelect={() => onCopy(card)}>{i18n._({ id: "Make a copy", message: "Make a copy" })}</DropdownMenuItem> : null}
      {own && onStatus && card.status === "draft" ? <DropdownMenuItem onSelect={() => onStatus(card, "ready")}>{i18n._({ id: "Mark ready", message: "Mark ready" })}</DropdownMenuItem> : null}
      {own && onStatus && card.status === "ready" ? <DropdownMenuItem onSelect={() => onStatus(card, "draft")}>{i18n._({ id: "Back to draft", message: "Back to draft" })}</DropdownMenuItem> : null}
      {own && onAudience ? <DropdownMenuItem onSelect={() => onAudience(card)}>{i18n._({ id: "Audience", message: "Audience" })}</DropdownMenuItem> : null}
      {!discover && onRemove ? <DropdownMenuItem disabled={card.is_default} onSelect={() => onRemove(card)}>{i18n._({ id: "Remove from Yours", message: "Remove from Yours" })}</DropdownMenuItem> : null}
      {own ? <DropdownMenuItem variant="destructive" onSelect={() => onDelete(card)}>{i18n._({ id: "Delete", message: "Delete" })}</DropdownMenuItem> : null}
    </DropdownMenuContent>
  </DropdownMenu>;
  return actions;
}

/** /companions: the companions this person may use, as a card grid. */
function CompanionsDirectory() {
  useTabItem(i18n._({ id: "Companions", message: "Companions" }));
  const navigate = useNavigate();
  const query = useQuery<CompanionList>({ queryKey: listKey, queryFn: api.companions, retry: false });
  const [discoverFilter, setDiscoverFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CompanionCard | null>(null);
  const [audienceTarget, setAudienceTarget] = useState<CompanionCard | null>(null);
  const viewer = useContext(CompanionShellViewer);
  const admin = viewer?.role === "owner" || viewer?.role === "admin";
  const queryClient = useQueryClient();
  const companionStills = useCompanionStills([...(query.data?.companions ?? []), ...(query.data?.discover ?? [])].map(({ id }) => id));
  const saveDefault = useMutation({ mutationFn: (id: string) => api.setDefaultCompanion(id), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: listKey }); }, onError: (error) => setActionError(errorLine(error, i18n._({ id: "Could not set your default. Check your connection and try again.", message: "Could not set your default. Check your connection and try again." }))) });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteCompanion(id), onSuccess: () => { setDeleteTarget(null); void queryClient.invalidateQueries({ queryKey: listKey }); }, onError: (error) => setActionError(errorLine(error, i18n._({ id: "Could not delete this companion. Check your connection and try again.", message: "Could not delete this companion. Check your connection and try again." }))) });
  const addToYours = useMutation({ mutationFn: (id: string) => api.addCompanion(id), onSuccess: () => { setActionError(null); void queryClient.invalidateQueries({ queryKey: listKey }); }, onError: (error) => setActionError(errorLine(error, i18n._({ id: "Could not add this companion. Check your connection and try again.", message: "Could not add this companion. Check your connection and try again." }))) });
  const removeFromYours = useMutation({ mutationFn: (id: string) => api.removeCompanion(id), onSuccess: () => { setActionError(null); void queryClient.invalidateQueries({ queryKey: listKey }); }, onError: (error) => setActionError(errorLine(error, i18n._({ id: "Could not remove this companion. Check your connection and try again.", message: "Could not remove this companion. Check your connection and try again." }))) });
  const editPath = (id: string) => `/companions/${encodeURIComponent(id)}/create`;
  const copy = useMutation({ mutationFn: (id: string) => api.copyCompanion(id), onSuccess: (result) => { setActionError(null); void queryClient.invalidateQueries({ queryKey: listKey }); navigate(editPath(result.id)); }, onError: (error) => setActionError(errorLine(error, i18n._({ id: "Could not make a copy. Check your connection and try again.", message: "Could not make a copy. Check your connection and try again." }))) });
  const setStatus = useMutation({ mutationFn: (input: { id: string; next: "draft" | "ready" }) => api.setCompanionStatus(input.id, input.next), onSuccess: () => { setActionError(null); void queryClient.invalidateQueries({ queryKey: listKey }); }, onError: (error) => setActionError(errorLine(error, i18n._({ id: "Could not change this companion's status. Check your connection and try again.", message: "Could not change this companion's status. Check your connection and try again." }))) });
  const menuActions: MenuActions = { onDelete: setDeleteTarget, onSetDefault: (item) => saveDefault.mutate(item.id), onEdit: (item) => navigate(editPath(item.id)), onCopy: (item) => copy.mutate(item.id), onStatus: (item, next) => setStatus.mutate({ id: item.id, next }), ...(admin ? { onAudience: setAudienceTarget } : {}) };
  return (
    <>
      {actionError ? <Alert variant="destructive"><AlertDescription>{actionError}</AlertDescription></Alert> : null}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm text-muted-foreground">{i18n._({ id: "Familiar faces. Different ways to help.", message: "Familiar faces. Different ways to help." })}</p>
        </div>
        {query.data?.can_create ? <Link to="/companions/create"><Button>{i18n._({ id: "New companion", message: "New companion" })}</Button></Link> : null}
      </div>
      <AsyncState
        data={query.isError ? null : query.data}
        error={query.isError}
        isFetching={query.isFetching}
        onRetry={() => query.refetch()}
        errorMessage={errorLine(query.error, i18n._({ id: "Could not load the companions. Check your connection and try again.", message: "Could not load the companions. Check your connection and try again." }))}
        loadingLabel={i18n._({ id: "Loading companions", message: "Loading companions" })}
      >
        {(data: CompanionList) => (
          <>
            {!data.allowed ? (
              <EmptyState icon="user" text={i18n._({ id: "Companions are turned off for you. Ask an owner or admin to turn them on.", message: "Companions are turned off for you. Ask an owner or admin to turn them on." })} />
            ) : data.companions.length === 0 ? (
              <EmptyState icon="user" text={i18n._({ id: "No companions are installed yet.", message: "No companions are installed yet." })} />
            ) : (
              <Tabs defaultValue="Yours">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <TabsList>
                    <TabsTrigger value="Yours">{i18n._({ id: "Yours", message: "Yours" })}</TabsTrigger>
                    {data.can_discover ? <TabsTrigger value="Discover">{i18n._({ id: "Discover", message: "Discover" })}</TabsTrigger> : null}
                  </TabsList>
                  <div className="w-full sm:w-72"><Input aria-label={i18n._({ id: "Search companions", message: "Search companions" })} type="search" placeholder={i18n._({ id: "Search companions", message: "Search companions" })} value={search} onChange={(event) => setSearch(event.target.value)} /></div>
                </div>
                <TabsContent value="Yours">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {data.companions.filter((card) => `${card.name} ${card.tagline}`.toLowerCase().includes(search.trim().toLowerCase())).map((card) => { const imageUrl = card.portrait ? api.companionPortrait(card.portrait) : companionStills[card.id]; return <CompanionCardElement key={card.id} name={card.name} line={card.tagline} media={imageUrl ? <Avatar size="lg"><AvatarImage src={imageUrl} alt={card.name} /></Avatar> : <SeededAvatar name={card.name} seed={card.id} />} status={card.is_default ? i18n._({ id: "Your default", message: "Your default" }) : card.status === "ready" ? null : card.status === "draft" ? i18n._({ id: "Draft · needs a portrait", message: "Draft · needs a portrait" }) : card.status} menu={companionMenu({ ...menuActions, card, onRemove: (item) => removeFromYours.mutate(item.id) })} meta={(card.working_count ?? 0) + (card.waiting_count ?? 0) > 0 ? <Status status={(card.waiting_count ?? 0) > 0 ? "degraded" : "online"}>{i18n._({ id: "{working} working · {waiting} waiting on you", message: "{working} working · {waiting} waiting on you", values: { working: card.working_count ?? 0, waiting: card.waiting_count ?? 0 } })}</Status> : formatRelative(card.latest_activity_at) ? i18n._({ id: "Last active {when} · {chats, plural, one {# chat} other {# chats}}", message: "Last active {when} · {chats, plural, one {# chat} other {# chats}}", values: { when: formatRelative(card.latest_activity_at), chats: card.chat_count ?? card.chats } }) : i18n._({ id: "Choose a conversation to get started", message: "Choose a conversation to get started" })} actions={<><Button type="button" onClick={() => void openCompanionChat(card, navigate, setActionError)}>{(card.chat_count ?? card.chats) > 0 ? i18n._({ id: "Continue", message: "Continue" }) : i18n._({ id: "Chat", message: "Chat" })}</Button><Button type="button" variant="outline" onClick={() => navigate(`/companions/${encodeURIComponent(card.id)}`)}>{i18n._({ id: "View profile", message: "View profile" })}</Button></>} />; })}
                  </div>
                </TabsContent>
                {data.can_discover ? <TabsContent value="Discover">
                  <div className="flex flex-wrap gap-2">
                    {([["All", i18n._({ id: "All", message: "All" })], ["Chat", i18n._({ id: "Chat", message: "Chat" })], ["Research", i18n._({ id: "Research", message: "Research" })], ["Shopping", i18n._({ id: "Shopping", message: "Shopping" })], ["Stories", i18n._({ id: "Stories", message: "Stories" })], ["Kids", i18n._({ id: "Kids", message: "Kids" })]] as const).map(([item, label]) =>
                      <Chip key={item} selected={discoverFilter === item} onClick={() => setDiscoverFilter(item)}>{label}</Chip>)}
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {data.discover.filter((card) => `${card.name} ${card.tagline}`.toLowerCase().includes(search.trim().toLowerCase())).filter((card) => discoverFilter === "All" || card.tagline.toLowerCase().includes(discoverFilter.toLowerCase())).map((card) => { const imageUrl = card.portrait ? api.companionPortrait(card.portrait) : companionStills[card.id]; return <CompanionCardElement key={card.id} name={card.name} line={card.tagline} media={imageUrl ? <Avatar size="lg"><AvatarImage src={imageUrl} alt={card.name} /></Avatar> : <SeededAvatar name={card.name} seed={card.id} />} status={card.is_default ? i18n._({ id: "Your default", message: "Your default" }) : card.status === "ready" ? null : card.status === "draft" ? i18n._({ id: "Draft · needs a portrait", message: "Draft · needs a portrait" }) : card.status} menu={companionMenu({ card, discover: true, onDelete: setDeleteTarget, onSetDefault: (item) => saveDefault.mutate(item.id), ...(card.can_copy ? { onCopy: menuActions.onCopy! } : {}) })} meta={(card.working_count ?? 0) + (card.waiting_count ?? 0) > 0 ? <Status status={(card.waiting_count ?? 0) > 0 ? "degraded" : "online"}>{i18n._({ id: "{working} working · {waiting} waiting on you", message: "{working} working · {waiting} waiting on you", values: { working: card.working_count ?? 0, waiting: card.waiting_count ?? 0 } })}</Status> : formatRelative(card.latest_activity_at) ? i18n._({ id: "Last active {when} · {chats, plural, one {# chat} other {# chats}}", message: "Last active {when} · {chats, plural, one {# chat} other {# chats}}", values: { when: formatRelative(card.latest_activity_at), chats: card.chat_count ?? card.chats } }) : i18n._({ id: "Choose a conversation to get started", message: "Choose a conversation to get started" })} actions={<Button disabled={addToYours.isPending} onClick={() => addToYours.mutate(card.id)}>{i18n._({ id: "Add", message: "Add" })}</Button>} />; })}
                  </div>
                  <p className="mt-4 text-sm text-muted-foreground">{i18n._({ id: "More companions from the catalog are coming soon.", message: "More companions from the catalog are coming soon." })}</p>
                </TabsContent> : null}
              </Tabs>
            )}
            {audienceTarget ? <CompanionAudienceDialog companionId={audienceTarget.id} name={audienceTarget.name} onClose={() => setAudienceTarget(null)} /> : null}
            <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
              <AlertDialogContent onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                <AlertDialogHeader><AlertDialogTitle>{i18n._({ id: "Delete {name}?", message: "Delete {name}?", values: { name: deleteTarget?.name } })}</AlertDialogTitle><AlertDialogDescription>{i18n._({ id: "This removes it for the whole home.", message: "This removes it for the whole home." })}</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>{i18n._({ id: "Cancel", message: "Cancel" })}</AlertDialogCancel><AlertDialogAction disabled={remove.isPending} onClick={() => { if (deleteTarget) remove.mutate(deleteTarget.id); }}>{i18n._({ id: "Delete", message: "Delete" })}</AlertDialogAction></AlertDialogFooter>
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
  useTabItem(query.data?.name ?? i18n._({ id: "Companion", message: "Companion" }));
  return (
    <div className="flex flex-col gap-6" data-testid="companion-detail">
      <AsyncState
        data={query.isError ? null : query.data}
        error={query.isError}
        isFetching={query.isFetching}
        onRetry={() => query.refetch()}
        errorMessage={query.error instanceof ApiError && query.error.status === 404 ? i18n._({ id: "That companion is not on your list. Go back and pick one from the gallery.", message: "That companion is not on your list. Go back and pick one from the gallery." }) : i18n._({ id: "Could not load this companion. Check your connection and try again.", message: "Could not load this companion. Check your connection and try again." })}
        loadingLabel={i18n._({ id: "Loading companion", message: "Loading companion" })}
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
    navigate(`/companions/${encodeURIComponent(result.id)}/create`);
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
      setChatError(errorLine(error, i18n._({ id: "Could not start a chat with this companion. Check your connection and try again.", message: "Could not start a chat with this companion. Check your connection and try again." })));
    } finally {
      setStartingChat(false);
    }
  };
  return (
    <>
      <CompanionProfileHeader name={companion.name} eyebrow={companion.is_household ? i18n._({ id: "Household companion", message: "Household companion" }) : i18n._({ id: "Built-in companion", message: "Built-in companion" })} line={companion.tagline} back={<Link to="/companions" className="text-sm underline">{i18n._({ id: "All companions", message: "All companions" })}</Link>} media={companion.portrait ? <Avatar size="lg"><AvatarImage src={api.companionPortrait(companion.portrait)} alt={companion.name} /></Avatar> : stills[companion.id] ? <Avatar size="lg"><AvatarImage src={stills[companion.id]} alt={companion.name} /></Avatar> : <SeededAvatar name={companion.name} seed={companion.id} size="profile" />} chips={<><Badge variant="secondary">{companion.who_can_use}</Badge>{saved ? <Badge>{i18n._({ id: "Your default", message: "Your default" })}</Badge> : null}<Badge variant="outline">{companion.status === "ready" ? i18n._({ id: "Ready", message: "Ready" }) : companion.status === "draft" ? i18n._({ id: "Draft · needs a portrait", message: "Draft · needs a portrait" }) : companion.status}</Badge></>} actions={<>

              <Button type="button" disabled={startingChat} onClick={() => void startChat()}>{startingChat ? i18n._({ id: "Starting chat…", message: "Starting chat…" }) : i18n._({ id: "Chat with {name}", message: "Chat with {name}", values: { name: companion.name } })}</Button>
          {companion.can_copy ? <Button type="button" variant="outline" disabled={copy.isPending} onClick={() => copy.mutate()}>{i18n._({ id: "Customize a copy", message: "Customize a copy" })}</Button> : null}
          {companion.can_edit ? <Link to={`/companions/${encodeURIComponent(companion.id)}/create`}><Button type="button" variant="outline">{i18n._({ id: "Edit", message: "Edit" })}</Button></Link> : null}
      </>} />
      {save.isError ? <Alert variant="destructive"><AlertDescription>{errorLine(save.error, i18n._({ id: "Could not save this. Check your connection and try again.", message: "Could not save this. Check your connection and try again." }))}</AlertDescription></Alert> : null}
      {chatError ? <Alert variant="destructive"><AlertDescription>{chatError}</AlertDescription></Alert> : null}
      {copy.isError ? <Alert variant="destructive"><AlertDescription>{errorLine(copy.error, i18n._({ id: "Could not reach Home. Check your connection and try again.", message: "Could not reach Home. Check your connection and try again." }))}</AlertDescription></Alert> : null}
      {!companion.is_household && companion.can_copy ? <p>{i18n._({ id: "This companion comes with Home, so it can't be changed. Make a copy and edit that.", message: "This companion comes with Home, so it can't be changed. Make a copy and edit that." })}</p> : null}
      <ProfileTabs companion={companion} stills={stills} />
    </>
  );
}

function ProfileTabs({ companion, stills }: { companion: CompanionDetail; stills: Record<string, string | undefined> }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "tasks" ? "Tasks" : params.get("tab") === "about" ? "About" : "Activity";
  const selectTab = (value: string) => {
    const next = new URLSearchParams(params);
    if (value === "Activity") { next.delete("tab"); next.delete("task"); }
    else if (value === "Tasks") next.set("tab", "tasks");
    else { next.set("tab", "about"); next.delete("task"); }
    setParams(next, { replace: false });
  };
  const activityQuery = useQuery<CompanionActivity>({ queryKey: ["companion-activity", companion.id], queryFn: () => api.companionActivity(companion.id), retry: false });
  const rows = activityQuery.data?.activity ?? [];
  const tasks = rows.filter((row) => row.kind !== "chat");
  const active = params.get("task");
  const selected = tasks.find((row) => row.id === active) ?? null;
  const taskTab = params.get("taskTab") ?? "needs";
  const setTaskTab = (value: string) => { const next = new URLSearchParams(params); next.set("tab", "tasks"); next.set("taskTab", value); next.delete("task"); setParams(next); };
  const chooseTask = (id: string) => { const next = new URLSearchParams(params); next.set("tab", "tasks"); next.set("task", id); setParams(next); };
  const selectAndOpenTasks = (row: typeof rows[number]) => { const next = new URLSearchParams(params); next.set("tab", "tasks"); next.set("task", row.id); setParams(next); };
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayLabel = (iso: string) => {
    const date = new Date(iso); const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    if (start === today) return i18n._({ id: "Today", message: "Today" });
    if (start === today - 86400000) return i18n._({ id: "Yesterday", message: "Yesterday" });
    return new Intl.DateTimeFormat(i18n.locale, { weekday: "long", month: "long", day: "numeric" }).format(date);
  };
  const stateLine = (row: typeof rows[number]) => row.kind === "chat" ? i18n._({ id: "Conversation", message: "Conversation" }) : row.needs_you ? row.waiting_reason || i18n._({ id: "Waiting for you", message: "Waiting for you" }) : row.state === "running" || row.state === "queued" ? i18n._({ id: "Working", message: "Working" }) : row.state === "done" ? i18n._({ id: "Finished", message: "Finished" }) : row.state === "failed" ? i18n._({ id: "Stopped", message: "Stopped" }) : row.state;
  const tone = (row: typeof rows[number]) => row.needs_you ? "needs_you" as const : row.state === "running" || row.state === "queued" ? "working" as const : row.state === "done" ? "done" as const : "plain" as const;
  const sorted = [...rows].sort((a, b) => Number(Boolean(b.needs_you)) - Number(Boolean(a.needs_you)) || new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  const grouped = sorted.reduce<ActivityFeedGroup[]>((groups, row) => {
    const label = dayLabel(row.created_at); let group = groups.find((candidate) => candidate.label === label);
    if (!group) { group = { id: label, label, items: [] }; groups.push(group); }
    group.items.push({ id: row.id, title: row.title, line: stateLine(row), meta: `${formatRelative(row.updated_at)} · ${row.kind === "chat" ? i18n._({ id: "Conversation", message: "Conversation" }) : i18n._({ id: "Task", message: "Task" })}`, tone: tone(row), action: row.kind === "chat" ? <Link to={`/chat?conversation=${encodeURIComponent(row.conversation_id ?? "")}`}><Button variant="link" size="sm">{i18n._({ id: "Open chat", message: "Open chat" })}</Button></Link> : <Button variant="link" size="sm" onClick={() => selectAndOpenTasks(row)}>{row.needs_you ? i18n._({ id: "Review", message: "Review" }) : i18n._({ id: "View", message: "View" })}</Button> });
    return groups;
  }, []);
  const needs = tasks.filter((row) => row.needs_you);
  const running = tasks.filter((row) => !row.needs_you && (row.state === "running" || row.state === "queued"));
  const completed = tasks.filter((row) => ["done", "failed", "cancelled"].includes(row.state));
  const visible = taskTab === "running" ? running : taskTab === "completed" ? completed : needs;
  const current = needs[0] ?? running[0];
  const taskStatus = selected ? selected.needs_you && selected.waiting_reason ? i18n._({ id: "Needs your choice", message: "Needs your choice" }) : selected.state : "";
  const progressItems = selected ? [i18n._({ id: "Understood the request", message: "Understood the request" }), ...(selected.needs_you ? [i18n._({ id: "Waiting for your choice", message: "Waiting for your choice" })] : selected.state === "running" || selected.state === "queued" ? [i18n._({ id: "Working", message: "Working" })] : selected.state === "done" ? [i18n._({ id: "Finished", message: "Finished" })] : selected.state === "failed" ? [i18n._({ id: "Stopped", message: "Stopped" })] : [])] : [];
  return <>
      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList><TabsTrigger value="Activity">{i18n._({ id: "Activity", message: "Activity" })}</TabsTrigger><TabsTrigger value="About">{i18n._({ id: "About", message: "About" })}</TabsTrigger><TabsTrigger value="Tasks">{i18n._({ id: "Tasks", message: "Tasks" })}{(companion.task_count ?? 0) > 0 ? <Badge variant="secondary">{companion.task_count}</Badge> : null}</TabsTrigger></TabsList>
        {tab === "Activity" ? <div>
          {activityQuery.isError ? <p>{i18n._({ id: "Could not load activity. Check your connection and try again.", message: "Could not load activity. Check your connection and try again." })}</p> : activityQuery.isLoading ? <p>{i18n._({ id: "Loading activity…", message: "Loading activity…" })}</p> : <ActivityFeed label={i18n._({ id: "Activity", message: "Activity" })} groups={grouped} empty={i18n._({ id: "No activity for {name} yet.", message: "No activity for {name} yet.", values: { name: companion.name } })} aside={current ? <Card label={i18n._({ id: "Current work", message: "Current work" })} far={false}><div className="flex flex-col gap-2 p-4"><h2 className="font-semibold">{i18n._({ id: "Current work", message: "Current work" })}</h2><p className="font-medium">{current.title}</p><p className="text-sm text-muted-foreground">{needs.length ? current.waiting_reason ? i18n._({ id: "Needs your choice", message: "Needs your choice" }) : i18n._({ id: "Needs you", message: "Needs you" }) : i18n._({ id: "Working", message: "Working" })}</p><Button onClick={() => selectAndOpenTasks(current)}>{i18n._({ id: "Review task", message: "Review task" })}</Button></div></Card> : undefined} />}
        </div> : null}
        {tab === "Tasks" ? <div>
          {activityQuery.isError ? <p>{i18n._({ id: "Could not load tasks. Check your connection and try again.", message: "Could not load tasks. Check your connection and try again." })}</p> : activityQuery.isLoading ? <p>{i18n._({ id: "Loading tasks…", message: "Loading tasks…" })}</p> : <TaskBrowser label={i18n._({ id: "Tasks", message: "Tasks" })} tabs={[{ id: "needs", label: i18n._({ id: "Needs you", message: "Needs you" }), count: needs.length }, { id: "running", label: i18n._({ id: "Running", message: "Running" }), count: running.length }, { id: "completed", label: i18n._({ id: "Completed", message: "Completed" }), count: completed.length }]} activeTab={taskTab} onTabChange={setTaskTab} items={visible.map((row) => ({ id: row.id, title: row.title, line: stateLine(row), meta: formatRelative(row.updated_at), badge: row.needs_you ? <Badge>{i18n._({ id: "Needs you", message: "Needs you" })}</Badge> : undefined }))} selectedId={selected?.id ?? null} onSelect={chooseTask} empty={taskTab === "needs" ? i18n._({ id: "Nothing needs you right now.", message: "Nothing needs you right now." }) : taskTab === "running" ? i18n._({ id: "Nothing is running.", message: "Nothing is running." }) : i18n._({ id: "Nothing has finished yet.", message: "Nothing has finished yet." })} backLabel={i18n._({ id: "Back to tasks", message: "Back to tasks" })} detail={selected ? <><div className="flex flex-col gap-4"><div className="flex items-center gap-3">{companion.portrait ? <Avatar><AvatarImage src={api.companionPortrait(companion.portrait)} alt={companion.name} /></Avatar> : stills[companion.id] ? <Avatar><AvatarImage src={stills[companion.id]} alt={companion.name} /></Avatar> : <SeededAvatar name={companion.name} seed={companion.id} />}<span className="font-medium">{companion.name}</span></div><Badge>{taskStatus}</Badge><h2 className="text-xl font-semibold">{selected.title}</h2>{selected.waiting_reason || selected.progress ? <p>{selected.waiting_reason || selected.progress}</p> : null}<section aria-label={i18n._({ id: "Progress", message: "Progress" })}><h3 className="font-semibold">{i18n._({ id: "Progress", message: "Progress" })}</h3><ul>{progressItems.map((line, index) => <li key={line}>{index === 0 || selected?.state === "done" || selected?.state === "failed" ? "✓ " : "• "}{line}</li>)}</ul></section>{selected.needs_you && selected.conversation_id ? <Link to={`/chat?conversation=${encodeURIComponent(selected.conversation_id)}`}><Button>{i18n._({ id: "Open source conversation", message: "Open source conversation" })}</Button></Link> : null}{selected.state === "done" && ["picture", "video", "music"].includes(selected.kind) ? <Link to={`/media/${encodeURIComponent(selected.result_ref || selected.id)}`}><Button>{i18n._({ id: "Open result", message: "Open result" })}</Button></Link> : null}</div></> : <p>{i18n._({ id: "Choose a task to see its details.", message: "Choose a task to see its details." })}</p>} />}
        </div> : null}
        {tab === "About" ? <section aria-label={i18n._({ id: "About", message: "About" })}>
      <Section heading={i18n._({ id: "About", message: "About" })}>
        <p>{companion.about}</p>
        {companion.pronouns ? <p className="text-sm text-muted-foreground">{i18n._({ id: "Pronouns: {pronouns}", message: "Pronouns: {pronouns}", values: { pronouns: companion.pronouns } })}</p> : null}
        {companion.interests.length > 0 ? <p className="text-sm text-muted-foreground">{i18n._({ id: "Likes: {list}.", message: "Likes: {list}.", values: { list: listWords(companion.interests) } })}</p> : null}
        <p className="text-sm text-muted-foreground">{companion.who_can_use}</p>
      </Section>
      <Section heading={i18n._({ id: "How it talks", message: "How it talks" })}>
        <dl className="grid gap-3 sm:grid-cols-2">
          {companion.dials.map((dial) => (
            <div key={dial.label}><dt className="text-sm font-medium">{dial.label}</dt><dd className="text-muted-foreground">{dial.value}</dd></div>
          ))}
        </dl>
      </Section>
      <Section heading={i18n._({ id: "Things it might say", message: "Things it might say" })}>
        <ul className="flex list-none flex-col gap-2 p-0">
          {companion.examples.map((line) => <li key={line}>{i18n._({ id: "“{line}”", message: "“{line}”", values: { line } })}</li>)}
        </ul>
      </Section>
      <Section heading={i18n._({ id: "Voice", message: "Voice" })}><VoiceRow companion={companion} /></Section>
      {companion.used_by ? (
        <Section heading={i18n._({ id: "Who uses it", message: "Who uses it" })}>
          <p>{i18n._({ id: "People: {list}.", message: "People: {list}.", values: { list: companion.used_by.people.length ? listWords(companion.used_by.people.map((person) => person.name)) : i18n._({ id: "nobody yet", message: "nobody yet" }) } })}</p>
          <p>{i18n._({ id: "Robots: {list}.", message: "Robots: {list}.", values: { list: companion.used_by.robots.length ? listWords(companion.used_by.robots.map((robot) => robot.name)) : i18n._({ id: "none yet", message: "none yet" }) } })}{" "}<Link to={ROBOT_SETTINGS} className="underline">{i18n._({ id: "Companion settings", message: "Companion settings" })}</Link></p>
        </Section>
      ) : null}
        </section> : null}
      </Tabs>
  </>;
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
      <p>{companion.voice_is_own ? i18n._({ id: "Its own voice", message: "Its own voice" }) : i18n._({ id: "The voice you chose in Settings", message: "The voice you chose in Settings" })}{choice ? `: ${choice.label}` : "."}</p>
      <div>
        <Button type="button" variant="outline" disabled={previewId === null || busy} onClick={() => (testing ? voicePreviewPlayer.stop() : previewId && void voicePreviewPlayer.start(previewId))}>
          {testing && !busy ? i18n._({ id: "Stop", message: "Stop" }) : i18n._({ id: "Play a sample", message: "Play a sample" })}
        </Button>
      </div>
      {picker ? (
        <div className="flex flex-col gap-1">
          <Select
            aria-label={i18n._({ id: "Voice for this companion", message: "Voice for this companion" })}
            value={picker.selected.value}
            options={picker.options.map((option) => option.value)}
            getLabel={(value) => picker.options.find((option) => option.value === value)?.label ?? value}
            disabled={saveVoice.isPending}
            onValueChange={(value) => saveVoice.mutate(value)}
          />
          {saveVoice.isError ? <Alert variant="destructive"><AlertDescription>{errorLine(saveVoice.error, i18n._({ id: "Could not save this voice. Check your connection and try again.", message: "Could not save this voice. Check your connection and try again." }))}</AlertDescription></Alert> : null}
        </div>
      ) : null}
      {voices.isError ? <Alert variant="destructive"><AlertDescription>{i18n._({ id: "Home can't reach its voice service. Check Repairs, then come back.", message: "Home can't reach its voice service. Check Repairs, then come back." })}</AlertDescription></Alert> : null}
      {preview.error ? <Alert variant="destructive"><AlertDescription>{preview.error}</AlertDescription></Alert> : null}
    </div>
  );
}
