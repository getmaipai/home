import { createContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, isOwnerOrAdminRole, type HealthStatus, type Roster } from "@/lib/api";
import { chatAvailability } from "@/apps/chat/chatAvailability";
import type { ChatComposerNoticeValue } from "@/apps/chat/chatThreadContexts";

export const ChatAvailabilityContext = createContext<"ready" | "starting" | "unavailable">("ready");

function useHealthQuery() {
  return useQuery<HealthStatus>({
    queryKey: ["health"],
    queryFn: () => api.health(),
    retry: false,
    refetchInterval: (current) => chatAvailability(current.state.data?.engines?.chat) === "unavailable" ? 5_000 : 15_000,
  });
}

export function useChatAvailability() {
  return chatAvailability(useHealthQuery().data?.engines?.chat);
}

/** CHAT-CALM-ERRORS-01d: the composer line for this person, picked by band
 * from the health row's `notice` (the words live in backend failureCopy.ts,
 * never here). The same ["health"] query as above, so one fetch serves both. */
export function useChatComposerNotice(person: Pick<Roster, "role">): ChatComposerNoticeValue | null {
  const health = useHealthQuery().data?.engines?.chat;
  const notice = health?.notice;
  if (!notice || chatAvailability(health) === "ready") return null;
  const text = person.role === "child" ? notice.child : person.role === "teen" ? notice.teen : notice.adult;
  return { text, repairsLink: isOwnerOrAdminRole(person.role) ? notice.repairs_link : null };
}
