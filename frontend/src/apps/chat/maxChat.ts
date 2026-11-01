// TIER-HOME-05: the composer's Max chat control. Max is a lease on the big chat model, not a household switch. The lease is the
// server's (GET, POST and DELETE /api/ai/chat-lease); this file holds the one-person flow around it: a confirm line, the starting
// state, a missing self-test with the action that runs it, and the end. Its words reach the person through the composer's existing
// notice line (ChatComposerNoticeContext), so there is no new status UI.
import { useCallback } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { chatLeaseApi, type ChatLeaseView } from "@/lib/chatLeaseApi";
import type { ChatComposerNoticeValue } from "@/apps/chat/chatThreadContexts";

export const MAX_CONFIRM_LINE = "Max uses the big model; big jobs wait.";
export const MAX_STARTING_LINE = "Loading the big model, about a minute.";
export const MAX_SELF_TEST_LINE = "Max needs a self-test first.";
const SELF_TEST_RUNNING_LINE = "Testing the big model, about a minute.";
const LEASE_KEY = ["max-chat", "lease"] as const;
const FLOW_KEY = ["max-chat", "flow"] as const;

type Flow =
  | { phase: "idle" }
  | { phase: "confirm" }
  | { phase: "starting" }
  | { phase: "self_test_needed"; line: string }
  | { phase: "self_test_running" }
  | { phase: "error"; line: string };
const IDLE: Flow = { phase: "idle" };

const setFlow = (qc: QueryClient, flow: Flow) => qc.setQueryData<Flow>(FLOW_KEY, flow);
const getFlow = (qc: QueryClient) => qc.getQueryData<Flow>(FLOW_KEY) ?? IDLE;
let selfTestPollMs = 3000;
/** Tests only: how often the self-test check looks again. */
export function __setSelfTestPollMsForTests(ms: number): void { selfTestPollMs = ms; }
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function take(qc: QueryClient): Promise<void> {
  setFlow(qc, { phase: "starting" });
  void qc.invalidateQueries({ queryKey: LEASE_KEY });
  try {
    qc.setQueryData(LEASE_KEY, await chatLeaseApi.take());
    setFlow(qc, IDLE);
  } catch (error) {
    if (error instanceof ApiError && error.code === "not_ready" && error.message === MAX_SELF_TEST_LINE) setFlow(qc, { phase: "self_test_needed", line: error.message });
    else setFlow(qc, { phase: "error", line: error instanceof Error ? error.message : "Home could not start Max chat. Try again in a minute." });
    void qc.invalidateQueries({ queryKey: LEASE_KEY });
  }
}

/** The admin-only self-test route, then a check every 3 seconds (up to 5 minutes) of the coding readiness record until the self-test item is done. */
async function runSelfTest(qc: QueryClient): Promise<void> {
  setFlow(qc, { phase: "self_test_running" });
  try {
    await api.runCodingModeSelfTest();
    for (let tries = 0; tries < 100; tries += 1) {
      await wait(selfTestPollMs);
      const mode = await api.codingMode();
      if (mode.readiness.items.find((item) => item.id === "self_test")?.state === "done") { setFlow(qc, { phase: "confirm" }); return; }
    }
    setFlow(qc, { phase: "error", line: "The self-test did not finish. Open Settings, then Coding, to see why." });
  } catch (error) {
    setFlow(qc, { phase: "error", line: error instanceof Error ? error.message : "Home could not run the self-test. Try again in a minute." });
  }
}

export interface MaxChat {
  /** Null until known, and for anyone who may not use Max chat (the control then draws nothing). */
  lease: ChatLeaseView | null;
  visible: boolean;
  label: "Max" | "Starting Max" | "Max in use" | "Returning to standard";
  pressed: boolean;
  disabled: boolean;
  /** The control was clicked: ask first, start after the confirm line, end when it is held. */
  press: () => void;
}

/** `enabled` is false for every band but adult, so a teen's or child's page never asks the route at all. */
export function useMaxChat(enabled: boolean): MaxChat {
  const qc = useQueryClient();
  const leaseQuery = useQuery({
    queryKey: LEASE_KEY, queryFn: chatLeaseApi.get, enabled, retry: false,
    // Watch a start or a return finish; a held lease is re-read each minute so an idle release shows up.
    refetchInterval: (query) => (query.state.data?.state === "starting" || query.state.data?.state === "releasing" ? 3000 : query.state.data?.state === "held" ? 60_000 : false),
  });
  const flow = useQuery<Flow>({ queryKey: FLOW_KEY, queryFn: () => IDLE, initialData: IDLE, staleTime: Infinity, enabled: false }).data;
  const lease = enabled && leaseQuery.data?.can_use ? leaseQuery.data : null;
  const busy = flow.phase === "starting" || flow.phase === "self_test_running";
  const press = useCallback(() => {
    const current = getFlow(qc);
    const held = qc.getQueryData<ChatLeaseView>(LEASE_KEY);
    if (current.phase === "starting" || current.phase === "self_test_running") return;
    if (held?.held_by_you) {
      setFlow(qc, IDLE);
      void chatLeaseApi.release().then((next) => qc.setQueryData(LEASE_KEY, next)).catch((error) => setFlow(qc, { phase: "error", line: error instanceof Error ? error.message : "Home could not give Max back. Try again." }));
      return;
    }
    setFlow(qc, current.phase === "confirm" ? IDLE : { phase: "confirm" });
  }, [qc]);
  const others = lease !== null && lease.state !== "off" && !lease.held_by_you;
  const label: MaxChat["label"] = busy || lease?.state === "starting" ? "Starting Max" : lease?.state === "releasing" ? "Returning to standard" : others ? "Max in use" : "Max";
  return { lease, visible: lease !== null, label, pressed: lease?.held_by_you === true, disabled: busy || others || lease?.state === "releasing", press };
}

/** The one notice line Max chat needs, in the composer's existing notice slot; null when there is nothing to say. */
export function useMaxChatNotice(isAdmin: boolean): ChatComposerNoticeValue | null {
  const qc = useQueryClient();
  const flow = useQuery<Flow>({ queryKey: FLOW_KEY, queryFn: () => IDLE, initialData: IDLE, staleTime: Infinity, enabled: false }).data;
  const dismiss = () => setFlow(qc, IDLE);
  switch (flow.phase) {
    case "confirm": return { text: MAX_CONFIRM_LINE, repairsLink: null, actionLabel: "Continue", onAction: () => { void take(qc); } };
    case "starting": return { text: MAX_STARTING_LINE, repairsLink: null };
    case "self_test_running": return { text: SELF_TEST_RUNNING_LINE, repairsLink: null };
    case "self_test_needed": return isAdmin
      ? { text: flow.line, repairsLink: null, actionLabel: "Run self-test", onAction: () => { void runSelfTest(qc); } }
      : { text: `${flow.line} Ask an admin.`, repairsLink: null, actionLabel: "Dismiss", onAction: dismiss };
    case "error": return { text: flow.line, repairsLink: null, actionLabel: "Dismiss", onAction: dismiss };
    default: return null;
  }
}
