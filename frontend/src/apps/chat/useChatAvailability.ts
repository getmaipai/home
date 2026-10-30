import { createContext, useContext, useEffect, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, isOwnerOrAdminRole, type EngineHealthEntry, type HealthStatus, type Roster } from "@/lib/api";
import { chatAvailability } from "@/apps/chat/chatAvailability";
import type { ChatComposerNoticeValue } from "@/apps/chat/chatThreadContexts";
import { useStatusApps } from "@/shell/useStatusApps";
import { isSearchLimitedChat } from "@/shell/statusApps";

export const ChatAvailabilityContext = createContext<"ready" | "starting" | "unavailable">("ready");

/** CHAT-PAUSE-01: how long the hub can fail to answer before it reads as
 * offline instead of restarting (the Stack and the hub both restart in under a minute). */
export const RESTART_GRACE_MS = 60_000;
/** How far back a not-ready reading still explains a reply that failed. */
export const RECENT_NOT_READY_MS = 90_000;

let notReadySince: number | null = null;

/** Where the page records, in the query cache (so it is per app and per test,
 * never a module global), the last time chat read as not ready. */
export const NOT_READY_SEEN_KEY = ["chat-not-ready-seen"] as const;

/** True when chat was not ready within `withinMs`. */
export function chatWasRecentlyNotReady(queryClient: QueryClient | undefined, withinMs = RECENT_NOT_READY_MS, now = Date.now()): boolean {
  const seen = queryClient?.getQueryData<number>(NOT_READY_SEEN_KEY);
  return seen !== undefined && now - seen <= withinMs;
}

/** The one polling rule: every 2 s while chat is not ready (easing to 5 s
 * after 30 s and 10 s after two minutes), every 15 s when ready, and none while
 * the tab is hidden (TanStack resumes it when the tab shows again). */
export function chatPollInterval(down: boolean, hidden: boolean, now = Date.now()): number | false {
  if (!down) { notReadySince = null; return hidden ? false : 15_000; }
  notReadySince ??= now;
  if (hidden) return false;
  const elapsed = now - notReadySince;
  return elapsed < 30_000 ? 2_000 : elapsed < 120_000 ? 5_000 : 10_000;
}

export function useHealthQuery() {
  return useQuery<HealthStatus>({
    queryKey: ["health"],
    queryFn: () => api.health(),
    retry: false,
    refetchInterval: (current) => chatPollInterval(
      current.state.status === "error" || chatAvailability(current.state.data?.engines?.chat) !== "ready",
      typeof document !== "undefined" && document.hidden,
    ),
  });
}

/** CHAT-PAUSE-01: the one reading of "can chat answer", from the health row
 * plus the hub itself not answering (a hub restart, an update). The hub
 * failing to answer reads as "starting" for a minute and "unavailable" after,
 * so the existing composer line, Send hold and Welcome state cover it; a
 * health row that never arrived reads as ready, as before. */
function useChatReadiness(): { availability: "ready" | "starting" | "unavailable"; chat: EngineHealthEntry | undefined; hubDown: "restarting" | "offline" | null } {
  const query = useHealthQuery();
  const queryClient = useQueryClient();
  // One failed read before any answer is a page still loading; the hub
  // having answered before, or failing twice, is the hub being down.
  const failing = query.status === "error" && (query.data !== undefined || query.errorUpdateCount >= 2);
  const notReady = failing || chatAvailability(query.data?.engines?.chat) !== "ready";
  useEffect(() => {
    if (notReady) queryClient.setQueryData(NOT_READY_SEEN_KEY, Date.now());
  }, [notReady, queryClient, query.dataUpdatedAt, query.errorUpdatedAt]);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!failing) return;
    const timer = setInterval(() => setTick((value) => value + 1), 5_000);
    return () => clearInterval(timer);
  }, [failing]);
  const chat = query.data?.engines?.chat;
  if (failing) {
    const since = query.dataUpdatedAt || query.errorUpdatedAt - 1;
    const hubDown = Date.now() - since > RESTART_GRACE_MS ? "offline" : "restarting";
    return { availability: hubDown === "offline" ? "unavailable" : "starting", chat, hubDown };
  }
  return { availability: chatAvailability(chat), chat, hubDown: null };
}

/** ENGINE-DOWN-UI-01: the one reason string every engine-dependent control
 * shows while chat cannot answer (undefined while ready). ChatThread hands it
 * to the kit Thread's `engineDown`; Home's own slots read it here, so the
 * controls never disagree about whether chat is up. */
export function engineDownReason(availability: "ready" | "starting" | "unavailable"): string | undefined {
  return availability === "ready" ? undefined : availability === "starting" ? "Getting ready, one moment" : "Chat is paused";
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
  return useChatReadiness().availability;
}

/** CHAT-CALM-ERRORS-01d: the composer line for this person, picked by band
 * from the health row's `notice` (the words live in backend failureCopy.ts,
 * never here). The same ["health"] query as above, so one fetch serves both. */
export function useChatComposerNotice(person: Pick<Roster, "role" | "age_band">): ChatComposerNoticeValue | null {
  const readiness = useChatReadiness();
  const health = readiness.chat;
  const notice = health?.notice;
  const apps = useStatusApps().data;
  if (readiness.hubDown) {
    const text = person.age_band === "child"
      ? (readiness.hubDown === "offline" ? "I'm taking a break. Ask a grown-up." : "I'm waking up. Try again in a minute.")
      : (readiness.hubDown === "offline" ? "The AI isn't answering." : "The AI is restarting. Chat will start again by itself in a minute.");
    return { text, repairsLink: readiness.hubDown === "offline" && isOwnerOrAdminRole(person.role) ? "Check Repairs" : null };
  }
  if (chatAvailability(health) === "ready" && Array.isArray(apps)) {
    if (apps.some(isSearchLimitedChat)) return { text: "Searches may be limited right now.", repairsLink: null };
    // STATUS-REASON-01: chat answers, but one of its optional parts is not
    // fully up. Owners and admins read the status reason and get the Repairs
    // link; everyone else gets the plain line with no part names.
    const degraded = apps.find((app) => app.state === "degraded" && (app.id === "chat" || app.name.toLocaleLowerCase() === "chat"));
    if (degraded) {
      return isOwnerOrAdminRole(person.role)
        ? { text: degraded.reason ?? "Chat is working, but some parts aren't fully running.", repairsLink: "Open Repairs" }
        : { text: "Some chat features may be limited right now.", repairsLink: null };
    }
  }
  if (chatAvailability(health) === "ready") return null;
  if (health?.kind === "starting" && (health.reason as string | undefined) === "ai_installing") {
    const text = person.age_band === "child"
      ? "The AI is still installing. Ask a grown-up; chat will work when it finishes."
      : "The AI is still installing. Chat will work when the install finishes.";
    return { text, repairsLink: null };
  }
  if (!notice) return null;
  const text = person.age_band === "child" ? notice.child : person.age_band === "teen" ? notice.teen : person.age_band === "adult" ? notice.adult : null;
  return text === null ? null : { text, repairsLink: isOwnerOrAdminRole(person.role) ? notice.repairs_link : null };
}
