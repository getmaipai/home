// TIER-HOME-05: the composer's Max chat control. Max is a lease on the big chat model, not a household switch. The lease is the
// server's (GET, POST and DELETE /api/ai/chat-lease); this file holds the one-person flow around it: a confirm line, the starting
// state, a missing self-test with the action that runs it, and the end. Its words reach the person through the composer's existing
// notice line (ChatComposerNoticeContext), so there is no new status UI.
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { chatLeaseApi, type ChatLeaseView } from "@/lib/chatLeaseApi";
import type { ChatComposerNoticeValue } from "@/apps/chat/chatThreadContexts";
import { maxStartLine } from "@/apps/chat/composerModeLines";

// CHAT-NOTICE-SHORT-01: every line is one short sentence pair (about 40 characters).
export const MAX_SELF_TEST_LINE = "Max needs a quick test first.";
export const MAX_RUNNING_LONG_LINE = "Taking longer than usual. Still working.";
const DEFAULT_MAX_LOAD_S = 60;
const DEFAULT_SELF_TEST_S = 35;
/** The same rule as the Home side (chatTransitions.ts waitPhrase): rounded to 5 seconds, "a minute" past 50. */
export function waitPhrase(seconds: number): string {
  return seconds > 50 ? "a minute" : `${Math.max(5, Math.round(seconds / 5) * 5)} seconds`;
}
/** The loading line for a step that has run `elapsedMs` of its measured `seconds`; "taking longer" past 1.5 times that. */
export function maxProgressLine(verb: "Loading" | "Testing", seconds: number, elapsedMs: number): string {
  return elapsedMs > 1.5 * seconds * 1000 ? MAX_RUNNING_LONG_LINE : `${verb} Max. About ${waitPhrase(seconds)}.`;
}
const LEASE_KEY = ["max-chat", "lease"] as const;
const FLOW_KEY = ["max-chat", "flow"] as const;

type Flow =
  | { phase: "idle" }
  | { phase: "confirm" }
  | { phase: "starting"; startedAt: number }
  | { phase: "self_test_needed"; line: string }
  | { phase: "self_test_running"; startedAt: number }
  | { phase: "error"; line: string };
const IDLE: Flow = { phase: "idle" };

const PICK_KEY = ["max-chat", "picked"] as const;
const setPicked = (qc: QueryClient, value: boolean) => qc.setQueryData<boolean>(PICK_KEY, value);
const getPicked = (qc: QueryClient) => qc.getQueryData<boolean>(PICK_KEY) ?? false;
/** Max is one message only: the send path calls this once the message left; the lease itself is handed back by the server after its grace. */
export function consumeMaxPick(qc: QueryClient): void { if (getPicked(qc)) setPicked(qc, false); }
/** Hand the lease back at once and drop the pick (a new chat, or Max left unused). */
export function dropMaxPick(qc: QueryClient): void {
  const wasPicked = getPicked(qc);
  setPicked(qc, false);
  if (getFlow(qc).phase === "confirm") setFlow(qc, IDLE);
  if (wasPicked && qc.getQueryData<ChatLeaseView>(LEASE_KEY)?.held_by_you) void chatLeaseApi.release().then((next) => qc.setQueryData(LEASE_KEY, next)).catch(() => undefined);
}
/** Send waits while Max is picked and the lease is not yet ready (the composer notice says why). */
export function useMaxSendHold(): boolean {
  const picked = useQuery<boolean>({ queryKey: PICK_KEY, queryFn: () => false, initialData: false, staleTime: Infinity, enabled: false }).data;
  const lease = useQuery<ChatLeaseView | undefined>({ queryKey: LEASE_KEY, queryFn: () => undefined, enabled: false }).data;
  return picked && !(lease?.state === "held" && lease.held_by_you);
}

const setFlow = (qc: QueryClient, flow: Flow) => qc.setQueryData<Flow>(FLOW_KEY, flow);
const getFlow = (qc: QueryClient) => qc.getQueryData<Flow>(FLOW_KEY) ?? IDLE;
let selfTestPollMs = 3000;
/** Tests only: how often the self-test check looks again. */
export function __setSelfTestPollMsForTests(ms: number): void { selfTestPollMs = ms; }
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function take(qc: QueryClient): Promise<void> {
  setFlow(qc, { phase: "starting", startedAt: Date.now() });
  void qc.invalidateQueries({ queryKey: LEASE_KEY });
  try {
    qc.setQueryData(LEASE_KEY, await chatLeaseApi.take());
    setFlow(qc, IDLE);
  } catch (error) {
    if (error instanceof ApiError && error.code === "not_ready" && error.message === MAX_SELF_TEST_LINE) setFlow(qc, { phase: "self_test_needed", line: error.message });
    else { setPicked(qc, false); setFlow(qc, { phase: "error", line: error instanceof Error ? error.message : "Max did not start. Try again in a minute." }); }
    void qc.invalidateQueries({ queryKey: LEASE_KEY });
  }
}

/** The admin-only self-test route, then a check every 3 seconds (up to 5 minutes) of the coding readiness record until the self-test item is done. */
async function runSelfTest(qc: QueryClient): Promise<void> {
  setFlow(qc, { phase: "self_test_running", startedAt: Date.now() });
  try {
    await api.runCodingModeSelfTest();
    for (let tries = 0; tries < 100; tries += 1) {
      await wait(selfTestPollMs);
      const mode = await api.codingMode();
      if (mode.readiness.items.find((item) => item.id === "self_test")?.state === "done") { setFlow(qc, { phase: "confirm" }); return; }
    }
    setFlow(qc, { phase: "error", line: "Max test did not finish. See Settings, Coding." });
  } catch (error) {
    setFlow(qc, { phase: "error", line: error instanceof Error ? error.message : "Max test did not run. Try again in a minute." });
  }
}

export interface MaxChat {
  /** Null until known, and for anyone who may not use Max chat (the control then offers no Max). */
  lease: ChatLeaseView | null;
  visible: boolean;
  /** Max is picked for the next message. */
  picked: boolean;
  /** The Max confirm dialog is open. */
  confirming: boolean;
  /** Max cannot be picked now (a step is running, someone else holds it, or it is returning). */
  disabled: boolean;
  /** The estimate line for the confirm ("It takes about a minute to start."), null when Max is already ready. */
  startLine: string | null;
  /** Max was chosen in the menu: ask first. */
  ask: () => void;
  /** "Use Max": arm it for the next message and request the lease. */
  confirm: () => void;
  /** "Cancel" or the dialog closed: the control stays on what it was. */
  cancel: () => void;
  /** Another choice was picked while Max was armed: drop it and hand the lease back, unused. */
  leave: () => void;
}

/** `enabled` is false for every band but adult, so a teen's or child's page never asks the route at all. */
export function useMaxChat(enabled: boolean): MaxChat {
  const qc = useQueryClient();
  const picked = useQuery<boolean>({ queryKey: PICK_KEY, queryFn: () => false, initialData: false, staleTime: Infinity, enabled: false }).data;
  const leaseQuery = useQuery({
    queryKey: LEASE_KEY, queryFn: chatLeaseApi.get, enabled, retry: false,
    // Watch a start or a return finish; a held lease is re-read often while armed so a lapse shows up.
    refetchInterval: (query) => (query.state.data?.state === "starting" || query.state.data?.state === "releasing" ? 3000 : query.state.data?.state === "held" ? (getPicked(qc) ? 15_000 : 60_000) : false),
  });
  const flow = useQuery<Flow>({ queryKey: FLOW_KEY, queryFn: () => IDLE, initialData: IDLE, staleTime: Infinity, enabled: false }).data;
  const lease = enabled && leaseQuery.data?.can_use ? leaseQuery.data : null;
  const busy = flow.phase === "starting" || flow.phase === "self_test_running";
  // The lease lapsed (or never came) while Max stayed armed: Max is off and the control says so by going back to Instant.
  useEffect(() => {
    if (picked && flow.phase === "idle" && leaseQuery.data && leaseQuery.data.state === "off") setPicked(qc, false);
  }, [picked, flow.phase, leaseQuery.data, qc]);
  const ask = useCallback(() => { if (!busy) setFlow(qc, { phase: "confirm" }); }, [qc, busy]);
  const confirm = useCallback(() => {
    const held = qc.getQueryData<ChatLeaseView>(LEASE_KEY);
    setPicked(qc, true);
    if (held?.held_by_you && held.state === "held") { setFlow(qc, IDLE); return; }
    void take(qc);
  }, [qc]);
  const cancel = useCallback(() => {
    if (getFlow(qc).phase !== "confirm") return;
    setFlow(qc, IDLE);
  }, [qc]);
  const leave = useCallback(() => dropMaxPick(qc), [qc]);
  const others = lease !== null && lease.state !== "off" && !lease.held_by_you;
  const loadSeconds = lease?.estimates?.max_load_s ?? DEFAULT_MAX_LOAD_S;
  const ready = lease?.state === "held" && lease.held_by_you;
  return {
    lease, visible: lease !== null, picked, confirming: flow.phase === "confirm" && lease !== null,
    disabled: busy || others || lease?.state === "releasing",
    startLine: ready ? null : maxStartLine(waitPhrase(loadSeconds)),
    ask, confirm, cancel, leave,
  };
}

/** The one notice line Max chat needs, in the composer's existing notice slot; null when there is nothing to say. */
export function useMaxChatNotice(isAdmin: boolean): ChatComposerNoticeValue | null {
  const qc = useQueryClient();
  const flow = useQuery<Flow>({ queryKey: FLOW_KEY, queryFn: () => IDLE, initialData: IDLE, staleTime: Infinity, enabled: false }).data;
  const dismiss = () => setFlow(qc, IDLE);
  // Re-draw every few seconds while a step runs so "taking longer than usual" appears on time.
  const [, setTick] = useState(0);
  const timed = flow.phase === "starting" || flow.phase === "self_test_running";
  useEffect(() => {
    if (!timed) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, [timed]);
  const estimates = qc.getQueryData<ChatLeaseView>(LEASE_KEY)?.estimates;
  switch (flow.phase) {
    case "starting": return { text: maxProgressLine("Loading", estimates?.max_load_s ?? DEFAULT_MAX_LOAD_S, Date.now() - flow.startedAt), repairsLink: null };
    case "self_test_running": return { text: maxProgressLine("Testing", estimates?.self_test_s ?? DEFAULT_SELF_TEST_S, Date.now() - flow.startedAt), repairsLink: null };
    case "self_test_needed": return isAdmin
      ? { text: flow.line, repairsLink: null, actionLabel: "Run self-test", onAction: () => { void runSelfTest(qc); } }
      : { text: `${flow.line} Ask an admin.`, repairsLink: null, actionLabel: "Dismiss", onAction: dismiss };
    case "error": return { text: flow.line, repairsLink: null, actionLabel: "Dismiss", onAction: dismiss };
    default: return null;
  }
}
