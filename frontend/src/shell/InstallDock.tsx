import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { Button } from "@maipai/ui/src/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/ui/collapsible";
import { getIcon } from "@maipai/ui/src/icons";
import { api, ApiError, type HomeJobView, type InstallStatusView } from "@/lib/api";
import { InstallDockRow } from "@/shell/InstallDockRow";
import { installLabel, installWords, speedLine, timeLeft, type InstallWords } from "@/shell/installWords";

const ChevronDown = getIcon("chevron-down");

export type DockState = "running" | "queued" | "paused" | "stalled" | "failed";
export interface DockItem {
  key: string;
  words: InstallWords;
  label: string;
  state: DockState;
  completedBytes: number;
  totalBytes: number;
  bytesPerSecond: number | null;
  /** The Home job row behind this item (admins only), for file details and Cancel. */
  job?: HomeJobView;
  reason?: string | null;
}
export interface DockModel {
  active: DockItem[];
  failed: DockItem[];
  primary: DockItem | null;
  /** Weighted over every running install; null when no size is known yet. */
  percent: number | null;
  line: string | null;
  problem: string | null;
}

const ACTIVE = new Set(["queued", "running", "paused", "stalled", "verifying", "waiting_for_you"]);

function dockState(state: string): DockState {
  return state === "failed" ? "failed" : state === "queued" ? "queued" : state === "stalled" ? "stalled" : state === "paused" || state === "waiting_for_you" ? "paused" : "running";
}

/** One list of what is installing, from the install status (what and how much) and, for admins, the
 * job rows (speed, files, Cancel). The same download is one entry, never two. */
export function buildDock(status: InstallStatusView | null, jobs: readonly HomeJobView[] = []): DockModel {
  const empty: DockModel = { active: [], failed: [], primary: null, percent: null, line: null, problem: null };
  if (!status || status.state === "none" || status.state === "ready") return empty;
  const active: DockItem[] = [];
  const failed: DockItem[] = [];
  if (status.state === "installing_engine") {
    const label = status.stageLabel ?? "Setting up your AI";
    active.push({ key: "engine", words: { verb: "Setting up", what: "your AI", benefit: "Home needs its AI engine before it can chat." }, label, state: "running", completedBytes: 0, totalBytes: 0, bytesPerSecond: null });
  } else if (status.state === "engine_failed") {
    failed.push({ key: "engine", words: { verb: "Setting up", what: "your AI", benefit: "Home needs its AI engine before it can chat." }, label: "Setting up your AI", state: "failed", completedBytes: 0, totalBytes: 0, bytesPerSecond: null, reason: status.problem });
  }
  for (const item of Array.isArray(status.items) ? status.items : []) {
    if (item.state === "done" || item.state === "cancelled") continue;
    const words = installWords({ id: item.model, role: item.role });
    const job = jobs.find((row) => row.id === `stack:${item.id}`);
    const progress = job?.progress ?? {};
    const bps = typeof progress.bytesPerSecond === "number" ? progress.bytesPerSecond : null;
    const entry: DockItem = {
      key: item.id, words, label: installLabel(words, item.totalBytes), state: dockState(item.state),
      completedBytes: item.completedBytes, totalBytes: item.totalBytes, bytesPerSecond: bps, ...(job ? { job } : {}), reason: item.reason,
    };
    if (ACTIVE.has(item.state) || entry.state !== "failed") active.push(entry);
    else failed.push(entry);
  }
  const sized = active.filter((entry) => entry.totalBytes > 0);
  const total = sized.reduce((sum, entry) => sum + entry.totalBytes, 0);
  const done = sized.reduce((sum, entry) => sum + Math.min(entry.completedBytes, entry.totalBytes), 0);
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
  const rank = (entry: DockItem) => (entry.state === "running" ? 0 : entry.state === "stalled" ? 1 : entry.state === "paused" ? 2 : 3);
  const ordered = [...active].sort((a, b) => rank(a) - rank(b) || (b.totalBytes - b.completedBytes) - (a.totalBytes - a.completedBytes));
  const primary = ordered[0] ?? failed[0] ?? null;
  const stalled = active.some((entry) => entry.state === "stalled") || status.state === "stalled";
  const parts = stalled ? ["Waiting for the internet. It picks up by itself."] : [timeLeft(status.etaSeconds), speedLine(status.bytesPerSecond)].filter((part): part is string => Boolean(part));
  const line = parts.length > 0 ? parts.join(" · ") : primary && active.length > 0 ? primary.words.benefit : null;
  return { active: ordered, failed, primary, percent, line, problem: status.problem };
}

/** "Couldn't finish: a faster chat engine for Muse Glimmer". */
function failureLine(item: DockItem): string {
  const what = item.words.tail ? `${item.words.what}` : item.words.what;
  return `${what.charAt(0).toUpperCase()}${what.slice(1)} did not finish installing`;
}

/** Where the dock centres: the page content beside the rail, not the whole window. */
function useAnchorBox(active: boolean): { left: number; right: number } | null {
  const [box, setBox] = useState<{ left: number; right: number } | null>(null);
  useLayoutEffect(() => {
    if (!active) return;
    const find = () => document.querySelector<HTMLElement>("[data-install-dock-anchor]") ?? document.querySelector<HTMLElement>("[data-slot=\"chat-pane\"]") ?? document.querySelector<HTMLElement>("[data-slot=\"rail-workspace\"]");
    const measure = () => {
      const node = find();
      // On a phone the page is the whole screen: centre on the screen.
      if (!node || document.documentElement.clientWidth < 768) { setBox(null); return; }
      const rect = node.getBoundingClientRect();
      const next = { left: Math.max(0, Math.round(rect.left)), right: Math.max(0, Math.round(document.documentElement.clientWidth - rect.right)) };
      setBox((prev) => (prev && prev.left === next.left && prev.right === next.right ? prev : next));
    };
    measure();
    // The page under the dock changes on navigation and when the history column opens; look again twice a second.
    const timer = setInterval(measure, 500);
    window.addEventListener("resize", measure);
    return () => { clearInterval(timer); window.removeEventListener("resize", measure); };
  }, [active]);
  return box;
}

/** The one install line, pinned to the bottom of the page: what is installing, why it matters and how far
 * along. People who can act on it (owner, admin) open it like an accordion for each install's size, speed,
 * files, Cancel and Try again; everyone else sees the same line, not expandable. */
export function InstallDock({ admin, read = api.installStatus, readJobs = api.jobs, retry = api.installRetry, stop = api.stopJob, repairsHref = "/repairs" }: {
  admin: boolean;
  read?: () => Promise<InstallStatusView>;
  readJobs?: () => Promise<HomeJobView[]>;
  retry?: () => Promise<unknown>;
  stop?: (id: string) => Promise<unknown>;
  repairsHref?: string;
}) {
  const [status, setStatus] = useState<InstallStatusView | null>(null);
  const [jobs, setJobs] = useState<HomeJobView[]>([]);
  const [open, setOpen] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let delay = 15_000;
      try {
        const [next, rows] = await Promise.all([read(), admin ? readJobs().catch(() => [] as HomeJobView[]) : Promise.resolve([] as HomeJobView[])]);
        if (disposed) return;
        setStatus(next && typeof next === "object" ? next : null);
        setJobs(Array.isArray(rows) ? rows.filter((row) => row.kind === "model_download") : []);
        if (next?.state === "downloading" || next.state === "starter_ready" || next.state === "installing_engine") delay = 2_000;
      } catch { /* The dock is a courtesy; a missed poll is retried. */ }
      if (!disposed) timer = setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => { disposed = true; if (timer) clearTimeout(timer); };
  }, [read, readJobs, admin]);

  const model = buildDock(status, jobs);
  const showing = model.primary !== null;
  const box = useAnchorBox(showing);

  // Announce the start and the finish once, never each percent.
  const before = useRef<{ active: boolean; failed: boolean }>({ active: false, failed: false });
  const activeNow = model.active.length > 0;
  const failedNow = model.failed.length > 0;
  const startLabel = model.primary?.label ?? "";
  useEffect(() => {
    if (status === null) return;
    const was = before.current;
    if (activeNow && !was.active) setAnnouncement(`${startLabel} has started.`);
    else if (!activeNow && was.active && !failedNow) setAnnouncement("The install finished.");
    if (failedNow && !was.failed) setAnnouncement("An install did not finish. Open it to try again.");
    before.current = { active: activeNow, failed: failedNow };
  }, [status, activeNow, failedNow, startLabel]);
  useEffect(() => { if (!showing) setOpen(false); }, [showing]);

  const onRetry = () => {
    setRetryError(null);
    retry().catch((reason: unknown) => {
      const words = reason instanceof ApiError ? [reason.message, reason.next].filter(Boolean).join(" ") : "";
      setRetryError(words || "Home couldn't restart the install. Check that this computer is online, then press Try again.");
    });
  };

  const announcer = <p role="status" aria-live="polite" aria-atomic="true" data-testid="install-announcer" className="sr-only">{announcement}</p>;
  const primary = model.primary;
  if (!primary) return announcer;

  const extra = model.active.length + model.failed.length - 1;
  const onlyFailed = model.active.length === 0;
  const title = onlyFailed ? (admin ? failureLine(primary) : "Part of your AI did not finish installing") : primary.label;
  const second = onlyFailed ? (admin ? "Open to try again." : "Ask an owner or admin to open Repairs.") : model.line;
  const bar = model.percent;
  const side = box ? { left: box.left, right: box.right } : { left: 0, right: 0 };

  const summary = (
    <>
      <span className="flex items-start gap-2 text-sm text-foreground">
        <span className="min-w-0 flex-1 line-clamp-2 break-words">{title}</span>
        {extra > 0 ? <span className="shrink-0 text-muted-foreground">+{extra} more</span> : null}
        {!onlyFailed && bar !== null ? <span className="shrink-0 tabular-nums text-muted-foreground">{bar}%</span> : null}
        {admin ? <ChevronDown aria-hidden className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? "" : "rotate-180"}`} /> : null}
      </span>
      {second ? <span className="block truncate text-sm text-muted-foreground">{second}</span> : null}
    </>
  );

  return (
    <>
      {announcer}
      <section
        aria-label="Installs in progress"
        data-testid="install-dock"
        style={side}
        className="pointer-events-none fixed bottom-0 z-40 flex justify-center px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <div data-testid="install-dock-card" className="pointer-events-auto w-full max-w-md rounded-md border bg-background shadow-sm">
          {admin ? (
            <Collapsible open={open} onOpenChange={setOpen}>
              <CollapsibleContent>
                <div data-testid="install-dock-details" className="flex max-h-[60svh] flex-col gap-3 overflow-y-auto border-b p-3">
                  {model.active.map((item) => (
                    <div key={item.key} className="flex flex-col gap-1"><InstallDockRow item={item} stop={stop} /></div>
                  ))}
                  {model.failed.map((item) => (
                    <div key={item.key} role="group" aria-label={failureLine(item)} className="flex flex-col gap-1">
                      <p className="text-sm">{failureLine(item)}</p>
                      <p className="text-sm text-muted-foreground">{item.reason ?? model.problem ?? "Try again; the part already downloaded is kept."}</p>
                      <div className="flex items-center gap-3">
                        <Button type="button" variant="outline" size="sm" onClick={onRetry}>Try again</Button>
                        <Link to={repairsHref} className="text-sm underline">Repairs</Link>
                      </div>
                    </div>
                  ))}
                  {retryError ? <p role="alert" className="text-sm text-destructive">{retryError}</p> : null}
                </div>
              </CollapsibleContent>
              <CollapsibleTrigger asChild>
                <button type="button" data-testid="install-dock-toggle" aria-label={`${title}. ${open ? "Hide details" : "Show details"}`} className="block w-full rounded-md px-3 pt-2 pb-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">{summary}</button>
              </CollapsibleTrigger>
              {bar !== null && !onlyFailed ? <div className="px-3 pb-2"><Progress mode="determinate" value={bar} label={`${title} progress`} /></div> : <div className="pb-1" />}
            </Collapsible>
          ) : (
            <div className="px-3 pt-2 pb-2">
              {summary}
              {bar !== null && !onlyFailed ? <div className="pt-1"><Progress mode="determinate" value={bar} label={`${title} progress`} /></div> : null}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
