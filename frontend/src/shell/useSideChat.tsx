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
import { INCOGNITO_DISCARDED_EVENT } from "@/shell/incognitoContext";

function rememberedKey(personId: string, companionId: string) { return `maipai.ambient.side.${personId}.${companionId}`; }
function readRemembered(key: string) {
  try { return window.localStorage.getItem(key) || undefined; } catch { return undefined; }
}

export function useSideChat(person: Roster, companionId: string, incognito: boolean, onReplyText?: (text: string) => void, onReplyState?: (state: "waiting" | "responding" | "ready" | "error" | "idle") => void) {
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
  const schedulerRef = useRef<SentenceSpeechScheduler | null>(null);
  const pendingSpokenRef = useRef(false);
  const sttStatus = useQuery({ queryKey: ["stt-status"], queryFn: api.sttStatus });
  const dictation = useMemo(() => createSttDictationAdapter({
    createSocket: createSttSocket,
    turnSchedulerRef: schedulerRef,
    sttInstalled: () => sttStatus.data?.installed ?? true,
    onNotInstalled: () => toast.error("Voice input needs a one-time download that hasn't finished on this hub yet.", { id: "stt-not-installed" }),
    onFinalReady: () => { pendingSpokenRef.current = true; },
  }), [sttStatus.data]);
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
    turnSchedulerRef: schedulerRef,
    consumeSupersedes: () => undefined,
    getAgeBand: () => person.age_band,
    consumeTemporary: () => incognito || undefined,
    consumeSpoken: () => {
      const spoken = pendingSpokenRef.current || undefined;
      pendingSpokenRef.current = false;
      return spoken;
    },
    consumeRetryWithCurrentCompanion: () => false,
    getConversationId: resolveConversationId,
    onReplyText,
    onReplyState,
    speakReplies: false,
  }), [incognito, onReplyState, onReplyText, person.age_band, resolveConversationId]);
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
  }, [invalidate, resetThread, storageKey]);

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
  return { runtime, conversationId, newSideChat, openConversation, handOff, registerThreadActions, ensureConversationId: resolveConversationId };
}
