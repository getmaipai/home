import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAui, useAuiState } from "@assistant-ui/react";
import { toast } from "sonner";
import type { ThreadListProjects } from "@maipai/ui/src/elements/thread-list.aui";
import { ProjectSettingsDialog, type ProjectSettingsValue } from "@maipai/ui/src/elements/project-settings";
import { api, type ChatFolderView, type Roster } from "@/lib/api";
import { pendingChatFolderId, setPendingChatFolder, takeCreatedChatFolder } from "@/apps/chat/chatThreadListAdapter";

// PROJECTS-01b (CHAT-PROJECT-01): the person's projects for the kit thread
// list's projects mode. Data and copy only; the kit draws every row
// (rule 9). Who may do what is the hub's rule (lib/chatFolders.ts): an
// adult or teen manages their own, a child moves chats in and out of the
// projects a parent made, and Incognito offers no project at all.

export const chatFoldersQueryKey = (personId: string) => ["chat-folders", personId] as const;

/** The projects mode for the signed-in person's column, or undefined in
 * Incognito. `onNewChatStarted` closes the phone sheet, the same as New chat. */
export function useChatProjects({ person, temporary, onNewChatStarted }: { person: Roster; temporary: boolean; onNewChatStarted: () => void }): { projects: ThreadListProjects | undefined; settingsDialog: ReactNode } {
  const aui = useAui();
  const queryClient = useQueryClient();
  const foldersQuery = useQuery({ queryKey: chatFoldersQueryKey(person.id), queryFn: () => api.chatFolders(), enabled: !temporary });
  const refresh = () => queryClient.invalidateQueries({ queryKey: chatFoldersQueryKey(person.id) });
  const [editingId, setEditingId] = useState<string | null>(null);

  // A chat "New chat in project" just created: put its project on the
  // thread's own metadata so it lists under the project at once (the hub
  // already stored it; the adapter knows, so nothing is sent again).
  const mainRemoteId = useAuiState((s) => s.threads.threadItems.find((item) => item.id === s.threads.mainThreadId)?.remoteId);
  useEffect(() => {
    if (!mainRemoteId) return;
    const folderId = takeCreatedChatFolder(mainRemoteId);
    if (!folderId) return;
    const item = aui.threads().item("main");
    void item.updateCustom({ ...item.getState().custom, folder_id: folderId });
  }, [aui, mainRemoteId]);

  // A pending "New chat in project" applies only to the new chat it opened:
  // opening any other chat, Incognito, and another person drop it.
  const onNewThread = useAuiState((s) => s.threads.mainThreadId === s.threads.newThreadId);
  useEffect(() => {
    if (!onNewThread) setPendingChatFolder(null);
  }, [onNewThread]);
  // Only on a real change: the panel exists twice (the column and the phone
  // sheet), so a mount or unmount of one copy must not drop the other's.
  const scope = `${person.id}:${temporary}`;
  const scopeRef = useRef(scope);
  useEffect(() => {
    if (scopeRef.current === scope) return;
    scopeRef.current = scope;
    setPendingChatFolder(null);
    setEditingId(null);
  }, [scope]);

  const folders: ChatFolderView[] = Array.isArray(foldersQuery.data) ? foldersQuery.data : [];
  const editing = temporary ? null : folders.find((folder) => folder.id === editingId) ?? null;
  const projects = useMemo<ThreadListProjects | undefined>(() => {
    if (temporary) return undefined;
    const canManage = person.role !== "child";
    const allManage = folders.length > 0 && folders.every((folder) => folder.access === "manage");
    const allEditable = folders.length > 0 && folders.every((folder) => folder.access === "manage" || folder.access === "edit");
    return {
      folders: folders.map((folder) => ({ id: folder.id, name: folder.name, icon: folder.icon, color: folder.color, pinned: folder.pinned })),
      canManage,
      canMove: true,
      onCreate: canManage
        ? async (name) => {
            try {
              const created = await api.createChatFolder(name);
              await refresh();
              setEditingId(created.id);
            } catch {
              toast.error("Could not make that project. Try again.");
            }
          }
        : undefined,
      onDelete: canManage && allManage
        ? async (id) => {
            try {
              if (pendingChatFolderId() === id) setPendingChatFolder(null);
              await api.deleteChatFolder(id);
              await refresh();
              // Its chats are kept, out of any project: reload the list so
              // each chat's own metadata says so.
              await aui.threads().reload();
            } catch {
              toast.error("Could not delete that project. Try again.");
            }
          }
        : undefined,
      onEdit: allEditable ? (id) => setEditingId(id) : undefined,
      onPin: allManage
        ? async (id, pinned) => {
            try {
              await api.updateChatFolder(id, { pinned });
              await refresh();
            } catch {
              toast.error("Could not update that project. Try again.");
            }
          }
        : undefined,
      onNewChat: async (id) => {
        // Awaited: the pending project is keyed to the new thread the switch
        // opens, read only once the switch has finished.
        await Promise.resolve(aui.threads().switchToNewThread());
        setPendingChatFolder({ threadId: aui.threads().getState().mainThreadId, folderId: id });
        onNewChatStarted();
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh only closes over stable values
  }, [temporary, person.role, folders, aui, onNewChatStarted]);

  const value: ProjectSettingsValue | null = editing ? {
    name: editing.name,
    icon: editing.icon,
    color: editing.color,
    description: editing.description,
    instructions: editing.instructions,
    memory_mode: editing.memory_mode,
  } : null;
  const canEdit = editing?.access === "manage" || editing?.access === "edit";
  const settingsDialog = editing && value ? (
    <ProjectSettingsDialog
      open
      onOpenChange={(open) => { if (!open) setEditingId(null); }}
      value={value}
      memoryModes={[]}
      readOnly={!canEdit}
      onSave={async (patch) => {
        try {
          await api.updateChatFolder(editing.id, patch);
          await refresh();
        } catch (error) {
          toast.error("Could not save that project. Try again.");
          throw error;
        }
      }}
      onDelete={editing.access === "manage" ? async () => {
        try {
          if (pendingChatFolderId() === editing.id) setPendingChatFolder(null);
          await api.deleteChatFolder(editing.id);
          await refresh();
          await aui.threads().reload();
        } catch (error) {
          toast.error("Could not delete that project. Try again.");
          throw error;
        }
      } : undefined}
      labels={{
        instructionsHelp: "These instructions shape answers in this project.",
        confirmDelete: "Its chats stay.",
      }}
    />
  ) : null;
  return { projects, settingsDialog };
}
