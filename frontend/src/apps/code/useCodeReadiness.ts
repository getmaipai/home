// CODE-FIX-02: the one hook the Code app reads to know whether a message can run (GET /api/code/readiness). It returns the notice in Chat's own value type, so the
// New session page and the session view fill the kit's composer notice slot with Chat's line (ChatComposerNotice) and add no status UI of their own. Owners and admins
// get the Repairs link; everyone else gets the plain line. While the answer is unknown, or Code is ready, the notice is null: a failed read never blocks a person.
import { i18n } from "@lingui/core";
import { useQuery } from "@tanstack/react-query";
import { codeApi } from "./codeApi";
import { translateServerLine } from "@/apps/chat/serverLines";
import type { ChatComposerNoticeValue } from "@/apps/chat/chatThreadContexts";

export const CODE_READINESS_KEY = ["code-readiness"];

export function useCodeReadiness(): { ready: boolean | null; notice: ChatComposerNoticeValue | null } {
  const query = useQuery({ queryKey: CODE_READINESS_KEY, queryFn: codeApi.readiness, retry: false, refetchInterval: 15_000, staleTime: 5_000 });
  const data = query.data;
  if (!data) return { ready: null, notice: null };
  if (data.ready !== false) return { ready: true, notice: null };
  const text = data.line ? translateServerLine(data.line, false) : i18n._({ id: "Code is not ready. Ask an admin to check it in Settings, Coding.", message: "Code is not ready. Ask an admin to check it in Settings, Coding." });
  return { ready: false, notice: { text, repairsLink: data.can_fix ? i18n._({ id: "Open Repairs", message: "Open Repairs" }) : null, level: "red" } };
}
