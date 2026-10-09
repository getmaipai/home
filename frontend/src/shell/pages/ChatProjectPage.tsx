import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAui, useAuiState } from "@assistant-ui/react";
import { toast } from "sonner";
import { ProjectMark } from "@maipai/ui/src/elements/project-mark";
import { ThreadListItems, ThreadListRoot, type ThreadListProjects } from "@maipai/ui/src/elements/thread-list.aui";
import { EmptyState, EmptyStateGreeting } from "@maipai/ui/src/elements/empty-state";
import { ProjectSettingsDialog, type ProjectSettingsValue } from "@maipai/ui/src/elements/project-settings";
import { Button } from "@maipai/ui/src/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@maipai/ui/src/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@maipai/ui/src/ui/tabs";
import { api, type ChatFolderView, type ConversationSummary, type Roster } from "@/lib/api";
import { setPendingChatFolder } from "@/apps/chat/chatThreadListAdapter";
import { chatFoldersQueryKey } from "@/apps/chat/chatProjects";
import { PageContext } from "./chatProjectPageContext";

const projectKey = (person: string, id: string) => [...chatFoldersQueryKey(person), "one", id] as const;

export function projectConversationRows(rows: ConversationSummary[], folderId: string): ConversationSummary[] {
  return rows.filter((row) => row.surface === "chat" && row.folder_id === folderId && !row.archived)
    .sort((a, b) => (b.last_turn_at ?? b.created_at).localeCompare(a.last_turn_at ?? a.created_at));
}

export function projectSourcesVisible(role: Roster["role"], projectFilesEnabled = false): boolean {
  return role !== "child" || projectFilesEnabled;
}

function useProject() {
  const value = useContext(PageContext);
  const query = useQuery({ queryKey: projectKey(value?.person.id ?? "", value?.folderId ?? ""), queryFn: () => api.chatFolder(value!.folderId), enabled: value !== null });
  return { value, query, folder: query.data };
}

export function ChatProjectController({ folderId }: { folderId: string }) {
  const aui = useAui();
  useEffect(() => {
    let active = true;
    void Promise.resolve(aui.threads().switchToNewThread()).then(() => {
      if (!active) return;
      return aui.threads().reload().then(() => {
        if (active) setPendingChatFolder({ threadId: aui.threads().getState().mainThreadId, folderId });
      });
    });
    return () => { active = false; };
  }, [aui, folderId]);
  return null;
}

export function ProjectWelcome() {
  const { value, query, folder } = useProject();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mutation = useMutation({
    mutationFn: (patch: { archived?: boolean }) => api.updateChatFolder(value!.folderId, patch),
    onSuccess: async (_data, patch) => {
      await client.invalidateQueries({ queryKey: chatFoldersQueryKey(value!.person.id) });
      if (patch.archived) navigate("/chat/projects");
    },
    onError: () => toast.error("Could not update that project. Try again."),
  });
  if (!value) return null;
  if (query.isError || (query.isSuccess && !folder)) return <EmptyState><EmptyStateGreeting>That project is not available</EmptyStateGreeting><Button variant="outline" onClick={() => navigate("/chat/projects")}>See all projects</Button></EmptyState>;
  if (!folder) return null;
  const canManage = folder.access === "manage" && value.person.role !== "child";
  const canEdit = folder.access === "manage" || folder.access === "edit";
  const settingsValue: ProjectSettingsValue = { name: folder.name, icon: folder.icon, color: folder.color, description: folder.description, instructions: folder.instructions, memory_mode: folder.memory_mode };
  return (
    <div data-slot="chat-project-header" className="flex w-full items-start justify-between gap-3 pb-4">
      <div className="flex min-w-0 items-center gap-3"><ProjectMark icon={folder.icon} color={folder.color} size="lg" /><div className="min-w-0"><h2 className="truncate text-2xl font-semibold">{folder.name}</h2>{folder.description ? <p className="text-muted-foreground text-sm">{folder.description}</p> : null}</div></div>
      {canEdit ? <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="Project options"><span aria-hidden>•••</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setDialogOpen(true)}>Edit project</DropdownMenuItem>{canManage ? <DropdownMenuItem onSelect={() => mutation.mutate({ archived: true })}>Archive project</DropdownMenuItem> : null}{canManage ? <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>Delete project</DropdownMenuItem> : null}</DropdownMenuContent></DropdownMenu> : null}
      <ProjectSettingsDialog open={dialogOpen} onOpenChange={setDialogOpen} value={settingsValue} memoryModes={[]} readOnly={!canEdit} onSave={async (patch) => { await api.updateChatFolder(folder.id, patch); await client.invalidateQueries({ queryKey: chatFoldersQueryKey(value.person.id) }); }} onDelete={canManage ? async () => { await api.deleteChatFolder(folder.id); await client.invalidateQueries({ queryKey: chatFoldersQueryKey(value.person.id) }); navigate("/chat/projects"); } : undefined} labels={{ instructionsHelp: "These instructions shape answers in this project.", confirmDelete: "Its chats stay." }} />
      <DeleteConfirm open={confirmDelete} folder={folder} personId={value.person.id} onClose={() => setConfirmDelete(false)} />
    </div>
  );
}

function DeleteConfirm({ open, folder, personId, onClose }: { open: boolean; folder: ChatFolderView; personId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  return <AlertDialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {folder.name}?</AlertDialogTitle><AlertDialogDescription>Its chats stay.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={async () => { try { await api.deleteChatFolder(folder.id); await client.invalidateQueries({ queryKey: chatFoldersQueryKey(personId) }); navigate("/chat/projects"); } catch { toast.error("Could not delete that project. Try again."); } }}>Delete project</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

function ProjectChats({ folder }: { folder: ChatFolderView }) {
  const { value } = useProject();
  const query = useQuery({ queryKey: ["project-page-chats", value?.person.id, folder.id], queryFn: () => api.conversationList(undefined, undefined, "include"), enabled: value !== null });
  const rows = projectConversationRows(query.data ?? [], folder.id);
  if (!query.isLoading && rows.length === 0) return <EmptyState><EmptyStateGreeting>No chats yet</EmptyStateGreeting><p className="text-muted-foreground text-center">Start a chat above. It will be saved in this project.</p></EmptyState>;
  return <ProjectChatRows folder={folder} rows={rows} />;
}

function ProjectChatRows({ folder, rows }: { folder: ChatFolderView; rows: ConversationSummary[] }) {
  const aui = useAui();
  const runtimeState = useAuiState((state) => `${state.threads.isLoading}:${state.threads.threadIds.length}:${state.threads.threadItems.length}`);
  const rowIds = rows.map((row) => row.id).join("|");
  useEffect(() => { void aui.threads().reload(); }, [aui, folder.id, rowIds]);
  const pageRows: Record<string, { preview?: string | null; date?: string | null; projectIcon?: { icon?: string; color?: string } }> = {};
  for (const row of rows) pageRows[row.id] = { preview: row.preview, date: row.last_turn_at ?? row.created_at, projectIcon: { icon: folder.icon, color: folder.color } };
  const projects: ThreadListProjects = { folders: [], canMove: false, rowVariant: "page", pageRows };
  return <ThreadListRoot data-project-thread-state={runtimeState} data-project-thread-count={rows.length}><ThreadListItems projects={projects} /></ThreadListRoot>;
}

export function ProjectTabs() {
  const { value, folder } = useProject();
  if (!value || !folder) return null;
  const showSources = projectSourcesVisible(value.person.role); // child access opens only after chat.project_files is installed.
  return <div className="w-full pt-2"><Tabs defaultValue="chats"><TabsList variant="line"><TabsTrigger value="chats">Chats</TabsTrigger>{showSources ? <TabsTrigger value="sources">Sources</TabsTrigger> : null}<TabsTrigger value="artifacts">Artifacts</TabsTrigger></TabsList><TabsContent value="chats"><ProjectChats folder={folder} /></TabsContent>{showSources ? <TabsContent value="sources"><EmptyState><EmptyStateGreeting>No sources yet</EmptyStateGreeting><p className="text-muted-foreground text-center">Project sources will appear here when file support is available.</p></EmptyState></TabsContent> : null}<TabsContent value="artifacts"><EmptyState><EmptyStateGreeting>No artifacts yet</EmptyStateGreeting><p className="text-muted-foreground text-center">Artifacts created in this project will appear here.</p></EmptyState></TabsContent></Tabs></div>;
}
