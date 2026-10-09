import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAui, useAuiState } from "@assistant-ui/react";
import { toast } from "sonner";
import type { ThreadListProjects } from "@maipai/ui/src/elements/thread-list.aui";
import { api, type Roster } from "@/lib/api";
import { openProjectSettings } from "@/apps/chat/chatProjectSettingsStore";
import { pendingChatFolderId, setPendingChatFolder, takeCreatedChatFolder } from "@/apps/chat/chatThreadListAdapter";

// PROJECTS-01b (CHAT-PROJECT-01): the person's projects for the kit thread
// list's projects mode. Data and copy only; the kit draws every row
// (rule 9). Who may do what is the hub's rule (lib/chatFolders.ts): an
// adult or teen manages their own, a child moves chats in and out of the
// projects a parent made, and Incognito offers no project at all.

export const chatFoldersQueryKey = (personId: string) => ["chat-folders", personId] as const;

/** Starts a new chat that lands in the project: the same path as "New chat
 * in project" on a column row, shared with the project page's composer. */
export async function startChatInProject(aui: ReturnType<typeof useAui>, folderId: string): Promise<void> {
  // Awaited: the pending project is keyed to the new thread the switch
  // opens, read only once the switch has finished.
  await Promise.resolve(aui.threads().switchToNewThread());
  setPendingChatFolder({ threadId: aui.threads().getState().mainThreadId, folderId });
}

/** The projects mode for the signed-in person's column, or undefined in
 * Incognito. `onNewChatStarted` closes the phone sheet, the same as New chat. */
export function useChatProjects({ person, temporary, onNewChatStarted }: { person: Roster; temporary: boolean; onNewChatStarted: () => void }): ThreadListProjects | undefined {
  const aui = useAui();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const foldersQuery = useQuery({ queryKey: chatFoldersQueryKey(person.id), queryFn: () => api.chatFolders(undefined, { scope: "all" }), enabled: !temporary });
  const refresh = () => queryClient.invalidateQueries({ queryKey: chatFoldersQueryKey(person.id) });

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
  }, [scope]);

  const folders = foldersQuery.data;
  return useMemo<ThreadListProjects | undefined>(() => {
    if (temporary) return undefined;
    const canManage = person.role !== "child";
    return {
      folders: (Array.isArray(folders) ? folders : []).map((folder) => ({ id: folder.id, name: folder.name, icon: folder.icon, color: folder.color, pinned: Boolean(folder.pinned) })),
      canManage,
      canMove: true,
      onCreate: canManage
        ? async (name) => {
            try {
              await api.createChatFolder(name);
              await refresh();
            } catch {
              toast.error("Could not make that project. Try again.");
            }
          }
        : undefined,
      onRename: canManage
        ? async (id, name) => {
            try {
              await api.renameChatFolder(id, name);
              await refresh();
            } catch {
              toast.error("Could not rename that project. Try again.");
            }
          }
        : undefined,
      onDelete: canManage
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
      onNewChat: async (id) => {
        await startChatInProject(aui, id);
        onNewChatStarted();
      },
      // PROJECTS-UI-04: the name opens the project page; Edit project opens
      // the one settings dialog; Pin and See all projects are the listing's.
      onOpen: (id) => {
        navigate(`/chat/projects/${encodeURIComponent(id)}`);
        onNewChatStarted();
      },
      onEdit: canManage ? (id) => openProjectSettings({ kind: "edit", id }) : undefined,
      onPin: canManage
        ? async (id, pinned) => {
            try {
              await api.updateChatFolder(id, { pinned });
              await refresh();
            } catch {
              toast.error("Could not change that. Try again.");
            }
          }
        : undefined,
      onSeeAll: () => {
        navigate("/chat/projects");
        onNewChatStarted();
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh only closes over stable values
  }, [temporary, person.role, folders, aui, onNewChatStarted, navigate]);
}
