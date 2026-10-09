import { createContext, useContext, useEffect, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAui, useAuiState } from "@assistant-ui/react";
import { toast } from "sonner";
import { MoreHorizontalIcon, Share2Icon } from "lucide-react";
import { Button } from "@maipai/ui/src/ui/button";
import { Card, CardContent } from "@maipai/ui/src/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@maipai/ui/src/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@maipai/ui/src/ui/tabs";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemSeparator, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@maipai/ui/src/dashboard/components/ui/empty";
import { ArtifactCard } from "@maipai/ui/src/elements/artifact-card";
import { ProjectMark } from "@maipai/ui/src/elements/project-mark";
import { api, type ChatFolderView, type Roster } from "@/lib/api";
import { chatFoldersQueryKey, startChatInProject } from "@/apps/chat/chatProjects";
import { openProjectSettings } from "@/apps/chat/chatProjectSettingsStore";

// PROJECTS-UI-04 (CHAT-PROJECT-01): ChatGPT's project home page inside the chat
// area. The kit Thread draws it: its Welcome slot is the header (icon, name,
// description, Share and "..."), its own composer says "New chat in <name>",
// and its BelowComposer slot is the Chats, Sources, Artifacts and
// Instructions tabs. The hook below returns the slots; the page file never
// draws a composer or a thread of its own (rule 9).

type ProjectPageValue = { person: Roster; folderId: string };
const ProjectPageContext = createContext<ProjectPageValue | null>(null);
export const ProjectPageProvider = ProjectPageContext.Provider;

const projectQueryKey = (personId: string, folderId: string) => [...chatFoldersQueryKey(personId), "one", folderId] as const;

function useProject() {
  const value = useContext(ProjectPageContext);
  const query = useQuery({
    queryKey: projectQueryKey(value?.person.id ?? "", value?.folderId ?? ""),
    queryFn: () => api.chatFolder(value!.folderId),
    enabled: value !== null,
  });
  return { value, query, folder: query.data };
}

/** The project page's slots for the chat thread, or undefined off the page.
 * `value` goes to ProjectPageProvider around the thread. */
export function useChatProjectPage(person: Roster) {
  const match = useMatch("/chat/projects/:id");
  const folderId = match?.params.id ? decodeURIComponent(match.params.id) : undefined;
  const query = useQuery({
    queryKey: projectQueryKey(person.id, folderId ?? ""),
    queryFn: () => api.chatFolder(folderId!),
    enabled: folderId !== undefined,
  });
  if (folderId === undefined) return undefined;
  return {
    folderId,
    value: { person, folderId } satisfies ProjectPageValue,
    slots: {
      Welcome: ChatProjectPageHeader,
      BelowComposer: ChatProjectPageTabs,
      emptyLayout: "top" as const,
      composerPlaceholder: query.data ? `New chat in ${query.data.name}` : "New chat in this project",
    },
  };
}

/** Inside the runtime: opens a new chat in the project when the page opens,
 * and hands over to the chat view as soon as the first message is sent. */
export function ChatProjectPageController({ folderId }: { folderId: string }) {
  const aui = useAui();
  const navigate = useNavigate();
  const hasMessages = useAuiState((s) => s.thread.messages.length > 0);
  useEffect(() => {
    void startChatInProject(aui, folderId);
  }, [aui, folderId]);
  useEffect(() => {
    if (hasMessages) navigate("/chat");
  }, [hasMessages, navigate]);
  return null;
}

function ChatProjectPageHeader() {
  const { value, query, folder } = useProject();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const change = useMutation({
    mutationFn: (patch: { pinned?: boolean; archived?: boolean }) => api.updateChatFolder(value!.folderId, patch),
    onSuccess: async (_data, patch) => {
      await queryClient.invalidateQueries({ queryKey: chatFoldersQueryKey(value!.person.id) });
      if (patch.archived) navigate("/chat/projects");
    },
    onError: () => toast.error("Could not change that project. Try again."),
  });
  if (!value) return null;
  if (query.isError || (query.isSuccess && !folder)) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>That project is not here</EmptyTitle>
          <EmptyDescription>It may have been deleted, or it is private to someone else.</EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" onClick={() => navigate("/chat/projects")}>
          See all projects
        </Button>
      </Empty>
    );
  }
  if (!folder) return null;
  const manages = folder.access === "manage" && value.person.role !== "child";
  const canEdit = folder.access !== "use" && value.person.role !== "child";
  const canShare = manages && value.person.age_band === "adult";
  return (
    <div data-slot="chat-project-header" className="flex w-full items-start justify-between gap-3 pb-4">
      <div className="flex min-w-0 items-center gap-3">
        <ProjectMark icon={folder.icon} color={folder.color} size="lg" />
        <div className="min-w-0">
          <h2 className="truncate text-2xl font-semibold">{folder.name}</h2>
          {folder.description ? <p className="text-muted-foreground text-sm">{folder.description}</p> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {canShare ? (
          <Button variant="outline" onClick={() => openProjectSettings({ kind: "share", id: folder.id })}>
            <Share2Icon aria-hidden className="size-4" />
            Share
          </Button>
        ) : null}
        {canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Project options">
                <MoreHorizontalIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => openProjectSettings({ kind: "edit", id: folder.id })}>Edit project</DropdownMenuItem>
              {manages ? <DropdownMenuItem onSelect={() => change.mutate({ pinned: !folder.pinned })}>{folder.pinned ? "Unpin project" : "Pin project"}</DropdownMenuItem> : null}
              {manages ? <DropdownMenuItem onSelect={() => change.mutate({ archived: true })}>Archive project</DropdownMenuItem> : null}
              {manages ? <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>Delete project</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>{folder.counts.files > 0 ? `${folder.counts.files} files in this project will be removed. Its chats stay.` : "Its chats stay."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  await api.deleteChatFolder(folder.id);
                  await queryClient.invalidateQueries({ queryKey: chatFoldersQueryKey(value.person.id) });
                  navigate("/chat/projects");
                } catch {
                  toast.error("Could not delete that project. Try again.");
                }
              }}
            >
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

function ProjectChats({ folder }: { folder: ChatFolderView }) {
  const navigate = useNavigate();
  const chats = useQuery({ queryKey: ["project-chats", folder.id], queryFn: () => api.conversationList() });
  const rows = (chats.data ?? [])
    .filter((chat) => chat.folder_id === folder.id && !chat.archived)
    .sort((a, b) => (b.last_turn_at ?? b.created_at).localeCompare(a.last_turn_at ?? a.created_at));
  if (chats.isSuccess && rows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No chats yet</EmptyTitle>
          <EmptyDescription>Start one above. It will be saved in this project.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ItemGroup>
      {rows.map((chat, index) => (
        <div key={chat.id}>
          {index > 0 ? <ItemSeparator className="my-0" /> : null}
          <Item render={<button type="button" />} onClick={() => navigate(`/chat?conversation=${encodeURIComponent(chat.id)}`)}>
            <ItemContent>
              <ItemTitle>{chat.title || "New chat"}</ItemTitle>
              {"preview" in chat && typeof chat.preview === "string" && chat.preview ? <ItemDescription className="line-clamp-1">{chat.preview}</ItemDescription> : null}
            </ItemContent>
            <ItemActions>
              <span className="text-muted-foreground text-sm">{shortDate(chat.last_turn_at ?? chat.created_at)}</span>
            </ItemActions>
          </Item>
        </div>
      ))}
    </ItemGroup>
  );
}

function ProjectArtifacts({ folder }: { folder: ChatFolderView }) {
  const navigate = useNavigate();
  const artifacts = useQuery({ queryKey: ["project-artifacts", folder.id], queryFn: () => api.artifactsInFolder(folder.id), retry: false });
  const rows = artifacts.data ?? [];
  if (rows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No artifacts yet</EmptyTitle>
          <EmptyDescription>Documents the assistant writes in this project's chats show up here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map((artifact) => (
        <ArtifactCard
          key={artifact.id}
          title={artifact.title}
          meta={`${artifact.kind} · ${shortDate(artifact.created_at)}`}
          onClick={() => navigate(`/chat?conversation=${encodeURIComponent(artifact.conversation_id)}`)}
        />
      ))}
    </div>
  );
}

function ChatProjectPageTabs() {
  const { value, folder } = useProject();
  if (!value || !folder) return null;
  const isChild = value.person.role === "child";
  const canEdit = folder.access !== "use" && !isChild;
  return (
    <Tabs defaultValue="chats" className="w-full pt-2">
      <TabsList>
        <TabsTrigger value="chats">Chats</TabsTrigger>
        {isChild ? null : <TabsTrigger value="sources">Sources</TabsTrigger>}
        <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
        <TabsTrigger value="instructions">Instructions</TabsTrigger>
      </TabsList>
      <TabsContent value="chats">
        <ProjectChats folder={folder} />
      </TabsContent>
      {isChild ? null : (
        <TabsContent value="sources">
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No sources yet</EmptyTitle>
              <EmptyDescription>Adding files to a project is coming. They will list here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </TabsContent>
      )}
      <TabsContent value="artifacts">
        <ProjectArtifacts folder={folder} />
      </TabsContent>
      <TabsContent value="instructions">
        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            {folder.instructions ? <p className="whitespace-pre-wrap">{folder.instructions}</p> : <p className="text-muted-foreground">No instructions yet.</p>}
            {canEdit ? (
              <Button variant="outline" onClick={() => openProjectSettings({ kind: "edit", id: folder.id })}>
                {folder.instructions ? "Edit instructions" : "Add instructions"}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
