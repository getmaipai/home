// STACK-DDGS-01: Home learns where the Stack's DuckDuckGo search service listens by asking the Stack
// (GET /stack/v1/search), not by being told an address by hand. This file keeps ddgsConfig.ts's copy of
// the Stack's report fresh: quickly while the service is building or starting, slowly once it is ready.
// It never throws and never blocks boot. The address the Stack reports is that computer's loopback, so it is
// trusted only when the Stack runs on this computer; an engine on another computer reports nothing usable here.
import { DDGS_URL_ENV, ddgsStackReport, setDdgsStackReport } from "@/lib/retrieval/ddgsConfig";
import { getStackClient, isRemoteStackSelected, isStackConfigured } from "@/lib/stackEngine";

const FAST_MS = 5_000;
const READY_MS = 60_000;
const IDLE_MS = 60_000;
const MIN_GAP_MS = 2_000;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let lastAt = 0;

/** One look at the Stack's search service; resolves when the report is stored. Never rejects. */
export function refreshDdgsFromStack(): Promise<void> {
  if (process.env[DDGS_URL_ENV]?.trim()) return Promise.resolve(); // the household's own sidecar wins
  if (inFlight) return inFlight;
  if (Date.now() - lastAt < MIN_GAP_MS) return Promise.resolve();
  inFlight = (async () => {
    try {
      if (!isStackConfigured() || isRemoteStackSelected()) return setDdgsStackReport(null);
      const { ddgs } = await getStackClient().searchService({ signal: AbortSignal.timeout(3_000) });
      setDdgsStackReport({ state: ddgs.state, url: ddgs.url, reason: ddgs.reason });
    } catch {
      setDdgsStackReport(null); // an older Stack with no such route, or one that is down: DuckDuckGo is simply not ready
    } finally {
      lastAt = Date.now();
      inFlight = null;
    }
  })();
  return inFlight;
}

function delayFor(): number {
  const state = nextState;
  return state === "building" || state === "starting" ? FAST_MS : state === "ready" ? READY_MS : IDLE_MS;
}
let nextState: string | null = null;

/** Starts the background refresh, once. Safe to call at boot. */
export function startDdgsStackSync(): void {
  if (timer) return;
  const tick = async (): Promise<void> => {
    await refreshDdgsFromStack();
    nextState = ddgsStackReport()?.state ?? null;
    timer = setTimeout(() => void tick(), delayFor());
    (timer as unknown as { unref?: () => void }).unref?.();
  };
  timer = setTimeout(() => void tick(), 1_000);
  (timer as unknown as { unref?: () => void }).unref?.();
}
