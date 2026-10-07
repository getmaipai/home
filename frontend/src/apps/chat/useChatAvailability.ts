import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, isOwnerOrAdminRole, type HealthStatus, type Roster } from "@/lib/api";
import { chatAvailability } from "@/apps/chat/chatAvailability";
import type { ChatComposerNoticeValue } from "@/apps/chat/chatThreadContexts";
import { useStatusApps } from "@/shell/useStatusApps";
import { isSearchLimitedChat } from "@/shell/statusApps";

export const ChatAvailabilityContext = createContext<"ready" | "starting" | "unavailable">("ready");

function useHealthQuery() {
  return useQuery<HealthStatus>({
    queryKey: ["health"],
    queryFn: () => api.health(),
    retry: false,
    refetchInterval: (current) => chatAvailability(current.state.data?.engines?.chat) === "unavailable" ? 5_000 : 15_000,
  });
}

/** ENGINE-DOWN-UI-01: the one reason string every engine-dependent control
 * shows while chat cannot answer (undefined while ready). ChatThread hands it
 * to the kit Thread's `engineDown`; Home's own slots read it here, so the
 * controls never disagree about whether chat is up. */
export function engineDownReason(availability: "ready" | "starting" | "unavailable"): string | undefined {
  return availability === "ready" ? undefined : availability === "starting" ? "Chat is starting" : "Chat is paused";
}

export function useEngineDownReason(): string | undefined {
  return engineDownReason(useContext(ChatAvailabilityContext));
}

/** Read aloud depends on the voice service (the Stack's speech role, in the
 * health row as `engines.voice`), never on chat, and is open to every person,
 * not only owners and admins. False until the health row has answered. */
export function useVoiceAvailable(): boolean {
  const voice = useHealthQuery().data?.engines?.voice;
  return voice !== undefined && chatAvailability(voice) === "ready";
}

export function useChatAvailability() {
  return chatAvailability(useHealthQuery().data?.engines?.chat);
}

/** CHAT-CALM-ERRORS-01d: the composer line for this person, picked by band
 * from the health row's `notice` (the words live in backend failureCopy.ts,
 * never here). The same ["health"] query as above, so one fetch serves both. */
export function useChatComposerNotice(person: Pick<Roster, "role" | "age_band">): ChatComposerNoticeValue | null {
  const health = useHealthQuery().data?.engines?.chat;
  const notice = health?.notice;
  const apps = useStatusApps().data;
  if (chatAvailability(health) === "ready" && Array.isArray(apps) && apps.some(isSearchLimitedChat)) {
    return { text: "Searches may be limited right now.", repairsLink: null };
  }
  if (!notice || chatAvailability(health) === "ready") return null;
  const text = person.age_band === "child" ? notice.child : person.age_band === "teen" ? notice.teen : person.age_band === "adult" ? notice.adult : null;
  return text === null ? null : { text, repairsLink: isOwnerOrAdminRole(person.role) ? notice.repairs_link : null };
}
