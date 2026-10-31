import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalRuntime } from "@assistant-ui/react";
import { useQuery } from "@tanstack/react-query";
import { createChatModelAdapter } from "@/apps/chat/chatModelAdapter";
import { createChatHistoryAdapter } from "@/apps/chat/chatHistoryAdapter";
import { useChatVoiceTurnState } from "@/apps/chat/useChatVoiceTurnState";
import { createChatSpeechAdapter } from "@/apps/chat/chatSpeechAdapter";
import { createSttDictationAdapter } from "@/lib/voice/sttDictationAdapter";
import { createSttSocket } from "@/lib/voice/sttSocket";
import { useVoiceAvailable } from "@/apps/chat/useChatAvailability";
import { toast } from "sonner";
import { api, type Roster } from "@/lib/api";
import { INCOGNITO_DISCARDED_EVENT } from "@/shell/incognitoContext";
import { useAmbientPageContext } from "@/shell/pageContext";

/** Keep ambient voice calls aligned with backend SPOKEN_IDLE_NEW_CONVERSATION_MS. */
export const SPOKEN_IDLE_NEW_CONVERSATION_MS = 30 * 60 * 1000;

function rememberedKey(personId: string, companionId: string) { return `maipai.ambient.side.${personId}.${companionId}`; }
function readRemembered(key: string) {
  try { return window.localStorage.getItem(key) || undefined; } catch { return undefined; }
}

export function useSideChat(person: Roster, companionId: string, incognito: boolean, onReplyText?: (text: string) => void, onReplyState?: (state: "waiting" | "responding" | "ready" | "error" | "idle") => void) {
  const pageContext = useAmbientPageContext();
  const storageKey = rememberedKey(person.id, companionId);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const createPromiseRef = useRef<Promise<string> | null>(null);
  const restorePromiseRef = useRef<Promise<void> | null>(null);
  const generationRef = useRef(0);
  const keyRef = useRef("");
  const previousKeyRef = useRef("");
  const hasTemporarySessionRef = useRef(incognito);
  if (incognito) hasTemporarySessionRef.current = true;
  const currentKey = `${person.id}:${companionId}:${incognito}`;
  keyRef.current = currentKey;
  const threadActionsRef = useRef<{ reset(): void; import(repository: Awaited<ReturnType<ReturnType<typeof createChatHistoryAdapter>["load"]>>): void } | null>(null);
  const pendingThreadWorkRef = useRef<{ kind: "reset" } | { kind: "import"; repository: Awaited<ReturnType<ReturnType<typeof createChatHistoryAdapter>["load"]>> } | undefined>(undefined);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const voiceTurn = useChatVoiceTurnState();
  const { turnSchedulerRef, liveVoiceActiveRef, pendingSpeechRef, activeTurnRef, askAnswerRef, isSpeaking, speakingEndedAt, speechFailed } = voiceTurn;
  const pendingSpokenRef = pendingSpeechRef;
  const [callActive, setCallActive] = useState(false);
  const [readAloud, setReadAloud] = useState(() => {
    try { return window.localStorage.getItem(`maipai.ambient.readaloud.${person.id}`) === "true"; } catch { return false; }
  });
  const readAloudRef = useRef(false);
  readAloudRef.current = readAloud;
  const ttsAvailable = useVoiceAvailable();
  const sttStatus = useQuery({ queryKey: ["stt-status"], queryFn: api.sttStatus });
  const sttInstalled = sttStatus.data?.installed ?? true;
  const dictation = useMemo(() => createSttDictationAdapter({
    createSocket: createSttSocket,
    turnSchedulerRef,
    sttInstalled: () => sttInstalled,
    onNotInstalled: () => toast.error("Voice input needs a one-time download that hasn't finished on this hub yet.", { id: "stt-not-installed" }),
    onFinalReady: () => { pendingSpokenRef.current = true; },
  }), [pendingSpokenRef, sttInstalled, turnSchedulerRef]);
  const speech = useMemo(() => createChatSpeechAdapter(), []);
  const resolveConversationId = useCallback(async () => {
    if (restorePromiseRef.current) await restorePromiseRef.current;
    if (conversationIdRef.current) return conversationIdRef.current;
    if (!createPromiseRef.current) {
      const generation = generationRef.current;
      const requestKey = keyRef.current;
      const pending = api.createConversation(incognito ? "temporary" : undefined, undefined, undefined, companionId, "side").then((created) => {
        if (generationRef.current === generation && keyRef.current === requestKey) {
          conversationIdRef.current = created.id;
          setConversationId(created.id);
          if (!incognito) { try { window.localStorage.setItem(storageKey, created.id); } catch { /* storage may be unavailable */ } }
        }
        return created.id;
      }).finally(() => { if (createPromiseRef.current === pending) createPromiseRef.current = null; });
      createPromiseRef.current = pending;
    }
    return createPromiseRef.current;
  }, [companionId, incognito, storageKey]);
  const model = useMemo(() => createChatModelAdapter({
    turnSchedulerRef,
    consumeSupersedes: () => undefined,
    getAgeBand: () => person.age_band,
    consumeTemporary: () => incognito || undefined,
    consumeSpoken: () => {
      const spoken = pendingSpokenRef.current || undefined;
      pendingSpokenRef.current = false;
      return spoken;
    },
    consumeAskAnswer: () => { const value = askAnswerRef.current; askAnswerRef.current = undefined; return value; },
    consumeRetryWithCurrentCompanion: () => false,
    getConversationId: resolveConversationId,
    getPageContext: pageContext ? () => pageContext : undefined,
    onReplyText,
    onReplyState,
    onSpeakingChange: voiceTurn.onSpeakingChange,
    onSpeechError: voiceTurn.onSpeechError,
    activeTurnRef,
    speakReplies: () => liveVoiceActiveRef.current || (ttsAvailable && readAloudRef.current),
  }), [activeTurnRef, askAnswerRef, incognito, liveVoiceActiveRef, onReplyState, onReplyText, pageContext, pendingSpokenRef, person.age_band, resolveConversationId, ttsAvailable, turnSchedulerRef, voiceTurn.onSpeakingChange, voiceTurn.onSpeechError]);
  const history = useMemo(() => createChatHistoryAdapter(person.display_name, () => conversationIdRef.current), [person.display_name]);
  const runtime = useLocalRuntime(model, { adapters: { history, speech, dictation } });

  const registerThreadActions = useCallback((actions: typeof threadActionsRef.current) => {
    threadActionsRef.current = actions;
    if (!actions || !pendingThreadWorkRef.current) return;
    const pending = pendingThreadWorkRef.current;
    pendingThreadWorkRef.current = undefined;
    actions.reset();
    if (pending.kind === "import") actions.import(pending.repository);
  }, []);
  const resetThread = useCallback(() => {
    if (threadActionsRef.current) threadActionsRef.current.reset();
    else pendingThreadWorkRef.current = { kind: "reset" };
  }, []);
  const importThread = useCallback((repository: Awaited<ReturnType<ReturnType<typeof createChatHistoryAdapter>["load"]>>) => {
    if (threadActionsRef.current) {
      threadActionsRef.current.reset();
      threadActionsRef.current.import(repository);
    } else pendingThreadWorkRef.current = { kind: "import", repository };
  }, []);

  const invalidate = useCallback(() => {
    generationRef.current++;
    createPromiseRef.current = null;
    restorePromiseRef.current = null;
  }, []);
  const clear = useCallback((removeStored: boolean) => {
    invalidate();
    pendingSpokenRef.current = false;
    conversationIdRef.current = undefined;
    setConversationId(undefined);
    if (removeStored) { try { window.localStorage.removeItem(storageKey); } catch { /* storage may be unavailable */ } }
    resetThread();
  }, [invalidate, pendingSpokenRef, resetThread, storageKey]);

  useEffect(() => {
    const nextKey = currentKey;
    if (previousKeyRef.current === nextKey) return;
    previousKeyRef.current = nextKey;
    clear(false);
    if (incognito || !companionId) return;
    const remembered = readRemembered(storageKey);
    if (!remembered) return;
    const generation = generationRef.current;
    const restoring = createChatHistoryAdapter(person.display_name, () => remembered).load().then((repository) => {
      if (generation !== generationRef.current || keyRef.current !== nextKey) return;
      conversationIdRef.current = remembered;
      setConversationId(remembered);
      importThread(repository);
    }).catch(() => {
      if (generation === generationRef.current) clear(true);
    }).finally(() => { if (restorePromiseRef.current === restoring) restorePromiseRef.current = null; });
    restorePromiseRef.current = restoring;
  }, [clear, companionId, currentKey, incognito, importThread, person.display_name, person.id, storageKey]);

  useEffect(() => {
    if (!incognito) return;
    clear(false);
  }, [clear, incognito]);
  useEffect(() => {
    const discard = () => {
      if (!hasTemporarySessionRef.current) return;
      hasTemporarySessionRef.current = false;
      clear(false);
    };
    window.addEventListener(INCOGNITO_DISCARDED_EVENT, discard);
    return () => window.removeEventListener(INCOGNITO_DISCARDED_EVENT, discard);
  }, [clear]);

  const newSideChat = useCallback(() => clear(true), [clear]);
  const prepareCall = useCallback(async () => {
    if (restorePromiseRef.current) await restorePromiseRef.current;
    const id = conversationIdRef.current;
    if (!id) return;
    const generation = generationRef.current;
    const rows = await api.conversationList(undefined, undefined, "include", "all");
    if (generationRef.current !== generation || conversationIdRef.current !== id) return;
    const row = rows.find((entry) => entry.id === id);
    const lastActivity = row?.last_turn_at ?? row?.created_at;
    if (lastActivity && Date.now() - Date.parse(lastActivity) >= SPOKEN_IDLE_NEW_CONVERSATION_MS) newSideChat();
  }, [newSideChat]);
  const openConversation = useCallback(async (id: string) => {
    if (incognito) return false;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const requestKey = keyRef.current;
    createPromiseRef.current = null;
    try {
      const repository = await createChatHistoryAdapter(person.display_name, () => id).load();
      if (generation !== generationRef.current || requestKey !== keyRef.current) return false;
      conversationIdRef.current = id;
      setConversationId(id);
      if (!incognito) { try { window.localStorage.setItem(storageKey, id); } catch { /* storage may be unavailable */ } }
      importThread(repository);
      return true;
    } catch {
      return false;
    }
  }, [incognito, importThread, person.display_name, storageKey]);
  const handOff = useCallback(async (id?: string) => {
    if (!id && restorePromiseRef.current) await restorePromiseRef.current;
    const target = id ?? conversationIdRef.current;
    if (!target) return undefined;
    await api.setConversationPlacement(target, "chat");
    newSideChat();
    return target;
  }, [newSideChat]);
  useEffect(() => { try { window.localStorage.setItem(`maipai.ambient.readaloud.${person.id}`, String(readAloud)); } catch { /* local storage may be unavailable */ } }, [person.id, readAloud]);
  return { runtime, conversationId, newSideChat, prepareCall, openConversation, handOff, registerThreadActions, ensureConversationId: resolveConversationId, turnSchedulerRef, liveVoiceActiveRef, pendingSpeechRef, activeTurnRef, askAnswerRef, isSpeaking, speakingEndedAt, speechFailed, readAloud, setReadAloud, ttsAvailable, sttInstalled, callActive, setCallActive };
}
