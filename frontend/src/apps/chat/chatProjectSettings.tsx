import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAui } from "@assistant-ui/react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ProjectSettingsDialog, type ProjectSettingsValue } from "@maipai/ui/src/elements/project-settings";
import { ProjectShareDialog, type ProjectShareRole } from "@maipai/ui/src/elements/project-share";
import { api, type ChatFolderLook, type ChatFolderPatch, type ChatFolderView, type Roster } from "@/lib/api";
import { chatFoldersQueryKey } from "@/apps/chat/chatProjects";
import { closeProjectSettings, useProjectSettingsTarget } from "@/apps/chat/chatProjectSettingsStore";

// PROJECTS-UI-02 and 02b: the one project settings dialog and the Share
// dialog, hosted once by the chat page. A hook that returns the dialogs (not
// a component), so the page draws the kit's parts itself and Home adds no
// wrapper around them (rule 9). Who may do what is the hub's rule
// (lib/chatFolders.ts); this only hides what the hub would refuse.

/** The model does not read a project's instructions, and recall does not
 * follow its memory mode, until those slices land (PROJECTS-PARITY P5 and
 * P7). While this is false the form says so and hides the memory control, so
 * it never promises an effect that is not there. Flip it when they land. */
export const PROJECT_PROMPT_EFFECTS_LIVE = false;

const NEW_PROJECT: ProjectSettingsValue = { name: "", icon: "folder", color: "neutral", description: "", instructions: "", memory_mode: "shared" };

const valueOf = (folder: ChatFolderView): ProjectSettingsValue => ({
  name: folder.name,
  icon: folder.icon ?? "folder",
  color: folder.color ?? "neutral",
  description: folder.description ?? "",
  instructions: folder.instructions ?? "",
  memory_mode: folder.memory_mode ?? "shared",
});

const SETTINGS_LABELS = {
  instructionsHelp: PROJECT_PROMPT_EFFECTS_LIVE
    ? "Set context and customize how the assistant responds in this project."
    : "Saved with the project. The assistant does not use these notes yet.",
};

function useChatProjectSettings(person: Roster) {
  const target = useProjectSettingsTarget();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const aui = useAui();
  const foldersQuery = useQuery({ queryKey: chatFoldersQueryKey(person.id), queryFn: () => api.chatFolders(undefined, { scope: "all" }), enabled: target !== null });
  const folder = target && target.kind !== "new" ? foldersQuery.data?.find((item) => item.id === target.id) : undefined;
  const isChild = person.role === "child";
  const refresh = () => queryClient.invalidateQueries({ queryKey: chatFoldersQueryKey(person.id) });
  const peopleQuery = useQuery({ queryKey: ["people-for-share"], queryFn: () => api.people(), enabled: target?.kind === "share" });

  const settingsOpen = (target?.kind === "new") || (target?.kind === "edit" && folder !== undefined);
  const editing = target?.kind === "edit" ? folder : undefined;

  const dialog = (
    <ProjectSettingsDialog
      open={settingsOpen}
      onOpenChange={(open) => {
        if (!open) closeProjectSettings();
      }}
      value={editing ? valueOf(editing) : NEW_PROJECT}
      readOnly={isChild || (editing !== undefined && editing.access === "use")}
      memoryModes={PROJECT_PROMPT_EFFECTS_LIVE ? ["shared", "project_only"] : ["shared"]}
      labels={{
        title: target?.kind === "new" ? "New project" : "Project settings",
        instructionsHelp: SETTINGS_LABELS.instructionsHelp,
        confirmDelete: editing && editing.counts.files > 0 ? `${editing.counts.files} files in this project will be removed. Its chats stay.` : "Its chats stay.",
      }}
      onDelete={
        editing && editing.access === "manage"
          ? async () => {
              try {
                await api.deleteChatFolder(editing.id);
                await refresh();
                // Its chats are kept, out of any project: reload the list.
                await aui.threads().reload();
                if (location.pathname.startsWith(`/chat/projects/${editing.id}`)) navigate("/chat/projects");
              } catch {
                toast.error("Could not delete that project. Try again.");
                throw new Error("delete failed");
              }
            }
          : undefined
      }
      onSave={async (patch) => {
        try {
          if (target?.kind === "new") {
            const { name = "", ...look } = patch;
            const made = await api.createChatFolder(name, undefined, look as ChatFolderLook);
            await refresh();
            navigate(`/chat/projects/${encodeURIComponent(made.id)}`);
          } else if (editing) {
            await api.updateChatFolder(editing.id, patch as ChatFolderPatch);
            await refresh();
            await queryClient.invalidateQueries({ queryKey: ["chat-folder", editing.id] });
          }
        } catch {
          toast.error("Could not save that project. Try again.");
          throw new Error("save failed");
        }
      }}
    />
  );

  const shareFolder = target?.kind === "share" ? foldersQuery.data?.find((item) => item.id === target.id) : undefined;
  const roleOf = (personId: string): ProjectShareRole => shareFolder?.shares?.find((share) => share.person === personId)?.role ?? "none";
  const members = (peopleQuery.data ?? [])
    .filter((entry) => entry.id !== shareFolder?.person && entry.age_band === "adult")
    .map((entry) => ({ id: entry.id, name: entry.display_name, role: roleOf(entry.id) }));
  const share = (
    <ProjectShareDialog
      open={shareFolder !== undefined}
      onOpenChange={(open) => {
        if (!open) closeProjectSettings();
      }}
      members={members}
      disabled={!shareFolder || shareFolder.access !== "manage"}
      onRoleChange={async (memberId, role) => {
        if (!shareFolder) return;
        try {
          if (role === "none") await api.unshareChatFolder(shareFolder.id, memberId);
          else await api.shareChatFolder(shareFolder.id, memberId, role);
          await refresh();
        } catch {
          toast.error("Could not change who can use this project. Try again.");
        }
      }}
    />
  );

  return { dialog, share };
}

/** The chat page's one project settings dialog and Share dialog. */
export function ChatProjectSettingsHost({ person }: { person: Roster }) {
  const { dialog, share } = useChatProjectSettings(person);
  return (
    <>
      {dialog}
      {share}
    </>
  );
}
