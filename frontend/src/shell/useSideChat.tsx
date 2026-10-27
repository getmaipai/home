import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalRuntime } from "@assistant-ui/react";
import { useQuery } from "@tanstack/react-query";
import { createChatModelAdapter } from "@/apps/chat/chatModelAdapter";
import { createChatHistoryAdapter } from "@/apps/chat/chatHistoryAdapter";
import { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";
import { createChatSpeechAdapter } from "@/apps/chat/chatSpeechAdapter";
import { createSttDictationAdapter } from "@/lib/voice/sttDictationAdapter";
import { createSttSocket } from "@/lib/voice/sttSocket";
import { toast } from "sonner";
import { api, type Roster } from "@/lib/api";

function rememberedKey(personId: string, companionId: string) { return `maipai.ambient.side.${personId}.${companionId}`; }

export function useSideChat(person: Roster, companionId: string, incognito: boolean, onReplyText?: (text: string) => void, onReplyState?: (state: "waiting" | "responding" | "ready" | "error" | "idle") => void) {
  const storageKey = rememberedKey(person.id, companionId);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const createPromiseRef = useRef<Promise<string> | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>(() => {
    try { return window.localStorage.getItem(storageKey) || undefined; } catch { return undefined; }
  });
  conversationIdRef.current = conversationId;
  const schedulerRef = useRef<SentenceSpeechScheduler | null>(null);
  const speakingRef = useRef(false);
  const sttStatus = useQuery({ queryKey: ["stt-status"], queryFn: api.sttStatus });
  const dictation = useMemo(() => createSttDictationAdapter({
    createSocket: createSttSocket,
    turnSchedulerRef: schedulerRef,
    sttInstalled: () => sttStatus.data?.installed ?? true,
    onNotInstalled: () => toast.error("Voice input needs a one-time download that hasn't finished on this hub yet.", { id: "stt-not-installed" }),
    onFinalReady: () => {},
  }), [sttStatus.data]);
  const speech = useMemo(() => createChatSpeechAdapter(), []);
  const model = useMemo(() => createChatModelAdapter({
    turnSchedulerRef: schedulerRef,
    consumeSupersedes: () => undefined,
    getAgeBand: () => person.age_band,
    consumeTemporary: () => incognito || undefined,
    consumeRetryWithCurrentCompanion: () => false,
    getConversationId: async () => {
      if (conversationIdRef.current) return conversationIdRef.current;
      if (!createPromiseRef.current) {
        createPromiseRef.current = api.createConversation(incognito ? "temporary" : undefined, undefined, undefined, companionId, "side").then((created) => {
          conversationIdRef.current = created.id;
          setConversationId(created.id);
          try { window.localStorage.setItem(storageKey, created.id); } catch { /* storage may be unavailable */ }
          return created.id;
        }).finally(() => { createPromiseRef.current = null; });
      }
      return createPromiseRef.current;
    },
    onSpeakingChange: (speaking) => { speakingRef.current = speaking; },
    onReplyText,
    onReplyState,
    speakReplies: false,
  }), [companionId, incognito, onReplyState, onReplyText, person.age_band, storageKey]);
  const history = useMemo(() => createChatHistoryAdapter(person.display_name, () => conversationIdRef.current), [person.display_name]);
  const runtime = useLocalRuntime(model, { adapters: { history, speech, dictation } });
  const previousStorageKey = useRef(storageKey);
  useEffect(() => {
    if (previousStorageKey.current === storageKey) return;
    previousStorageKey.current = storageKey;
    let remembered: string | undefined;
    try { remembered = window.localStorage.getItem(storageKey) || undefined; } catch { remembered = undefined; }
    conversationIdRef.current = remembered;
    setConversationId(remembered);
  }, [storageKey]);
  const newSideChat = useCallback(() => {
    conversationIdRef.current = undefined;
    createPromiseRef.current = null;
    setConversationId(undefined);
    try { window.localStorage.removeItem(storageKey); } catch { /* storage may be unavailable */ }
    runtime.thread.reset();
  }, [runtime, storageKey]);
  const openConversation = useCallback(async (id: string) => {
    conversationIdRef.current = id;
    createPromiseRef.current = null;
    setConversationId(id);
    try { window.localStorage.setItem(storageKey, id); } catch { /* storage may be unavailable */ }
    const repository = await createChatHistoryAdapter(person.display_name, () => id).load();
    runtime.thread.import(repository);
  }, [person.display_name, runtime, storageKey]);
  const handOff = useCallback(async (id?: string) => {
    const target = id ?? conversationIdRef.current;
    return target;
  }, []);
  return { runtime, conversationId, newSideChat, openConversation, handOff };
}
