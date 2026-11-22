// CODE-UX-01: the row menu's actions (rename, pin, archive, delete with Undo) and the "seen" mark. Chat's thread list does these through its adapter; Code has
// plain routes, so this is the same set of verbs over `codeApi`. A failure toasts what went wrong and what to do, as Chat's adapter does, and the row stays as it was.
import { i18n } from "@lingui/core";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useHubMutation } from "@/lib/useHubMutation";
import { codeApi, type CodeSession } from "./codeApi";
import { CODE_SESSIONS_KEY } from "./NewSession";

export function useSessionActions(currentId: string | undefined) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const refresh = () => queryClient.invalidateQueries({ queryKey: CODE_SESSIONS_KEY });
  /** Put the hub's answer into the list at once, so the row moves before the next poll. */
  const apply = (next: CodeSession) => queryClient.setQueryData<CodeSession[]>(CODE_SESSIONS_KEY, (rows) => rows?.map((row) => (row.id === next.id ? { ...row, ...next } : row)));
  // useHubMutation is Home's one pattern for a failed action: it toasts the hub's own words or "Could not <verb>." and a next step, and never throws into the click.
  const rename = useHubMutation({ verb: "rename this session", mutationFn: (v: { id: string; title: string }) => codeApi.rename(v.id, v.title), onSuccess: apply });
  const pin = useHubMutation({ verb: "pin or unpin this session", mutationFn: (v: { id: string; pinned: boolean }) => codeApi.pin(v.id, v.pinned), onSuccess: apply });
  const archive = useHubMutation({ verb: "archive or unarchive this session", mutationFn: (v: { id: string; archived: boolean }) => codeApi.archive(v.id, v.archived), onSuccess: apply });
  const remove = useHubMutation({ verb: "delete this session", mutationFn: (session: Pick<CodeSession, "id" | "title">) => codeApi.remove(session.id).then(() => session) });
  const retry = useHubMutation({ verb: "retry this session", mutationFn: (id: string) => codeApi.retry(id), onSuccess: (_, id) => { void refresh(); void queryClient.invalidateQueries({ queryKey: ["code-session", id] }); void queryClient.invalidateQueries({ queryKey: ["code-messages", id] }); } });
  const restore = useHubMutation({ verb: "bring this session back", mutationFn: (id: string) => codeApi.restore(id), onSuccess: () => void refresh() });
  /** A failed action leaves the row as the hub has it: ask again at once. */
  const settle = (result: unknown): boolean => { if (result === undefined) void refresh(); return result !== undefined; };
  return {
    rename: async (id: string, title: string): Promise<boolean> => settle(await rename.run({ id, title })),
    pin: async (id: string, pinned: boolean): Promise<boolean> => settle(await pin.run({ id, pinned })),
    archive: async (id: string, archived: boolean): Promise<boolean> => settle(await archive.run({ id, archived })),
    /** CODE-FIX-01: run the last message of a failed session again. The red dot goes at once and the next poll shows the turn working. */
    retry: async (id: string): Promise<boolean> => {
      const done = await retry.run(id);
      if (done === undefined) { void refresh(); return false; }
      queryClient.setQueryData<CodeSession[]>(CODE_SESSIONS_KEY, (rows) => rows?.map((row) => (row.id === id ? { ...row, state: "queued", failure: null } : row)));
      return true;
    },
    /** Moves the session to the household Trash and offers Undo on the toast. */
    remove: async (session: Pick<CodeSession, "id" | "title">): Promise<boolean> => {
      if (!(await remove.run(session))) { void refresh(); return false; }
      queryClient.setQueryData<CodeSession[]>(CODE_SESSIONS_KEY, (rows) => rows?.filter((row) => row.id !== session.id));
      if (session.id === currentId) navigate("/apps/code");
      toast(i18n._({ id: "Deleted ‘{title}’. It stays in Trash for 30 days.", message: "Deleted ‘{title}’. It stays in Trash for 30 days.", values: { title: session.title } }), {
        action: { label: i18n._({ id: "Undo", message: "Undo" }), onClick: () => { void restore.run(session.id); } },
      });
      return true;
    },
  };
}
