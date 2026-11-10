import { i18n } from "@lingui/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { Button } from "@maipai/ui/src/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/ui/collapsible";
import { getIcon } from "@maipai/ui/src/icons";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { api, ApiError, type ActivityListView, type HomeJobView, type InstallStatusView } from "@/lib/api";
import { ACTIVITY_PATH, useActivity } from "@/shell/activity";
import { InstallDockRow } from "@/shell/InstallDockRow";
import { installActive, useInstallStatus, useJobs } from "@/lib/useInstallStatus";
import { installLabel, installWords, speedLine, timeLeft, type InstallWords } from "@/shell/installWords";
import { localizedApiMessage, localizedApiNext } from "@/lib/apiErrorLines";

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
  /** A making job (a picture, video or song) reports a percent instead of bytes. */
  percent?: number | null;
  /** Where tapping a making job goes: the chat that asked for it, else its app. */
  href?: string | null;
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

const MAKING_STATES = new Set(["queued", "running"]);
const MAKING_WORDS: Record<string, string> = { "image.generate": "a picture", picture: "a picture", image: "a picture", video: "a video", "video.generate": "a video", music: "a song", song: "a song", "music.generate": "a song" };

/** The viewer's own running makes (picture, video, song): a job row about them that is not a model download. Rows about other people carry no state, so they never match. */
export function makingJobs(rows: readonly HomeJobView[]): HomeJobView[] {
  return rows.filter((row) => row.kind !== "model_download" && row.forPersonName === undefined && typeof row.state === "string" && MAKING_STATES.has(row.state) && row.progress != null && ["image.generate", "picture", "image", "video", "video.generate", "music", "song", "music.generate"].includes(row.kind));
}

function makingHref(row: HomeJobView): string | null {
  if (row.conversationId) return `/chat?conversation=${encodeURIComponent(row.conversationId)}`;
  return row.kind.startsWith("video") ? "/apps/videos" : row.kind.startsWith("music") || row.kind === "song" ? "/apps/music" : null;
}

function makingItem(row: HomeJobView): DockItem {
  const what = MAKING_WORDS[row.kind] ?? "something";
  const raw = row.progress && typeof row.progress.percent === "number" ? row.progress.percent : null;
  const percent = raw === null ? null : Math.max(0, Math.min(100, Math.round(raw <= 1 && raw > 0 ? raw * 100 : raw)));
  const label = row.state === "queued" ? i18n._({ id: "Waiting to make {what}", message: "Waiting to make {what}", values: { what } }) : i18n._({ id: "Making {what}", message: "Making {what}", values: { what } });
  return { key: `make:${row.id}`, words: { verb: "Making", what, benefit: row.title && row.title !== what ? row.title : "It shows up in its app when it is done." }, label, state: row.state === "queued" ? "queued" : "running", completedBytes: 0, totalBytes: 0, bytesPerSecond: null, percent, href: makingHref(row) };
}

const ACTIVE = new Set(["queued", "running", "paused", "stalled", "verifying", "waiting_for_you"]);

function dockState(state: string): DockState {
  return state === "failed" ? "failed" : state === "queued" ? "queued" : state === "stalled" ? "stalled" : state === "paused" || state === "waiting_for_you" ? "paused" : "running";
}

/** One list of what is installing, from the install status (what and how much) and, for admins, the
 * job rows (speed, files, Cancel). The same download is one entry, never two. */
export function buildDock(status: InstallStatusView | null, jobs: readonly HomeJobView[] = []): DockModel {
  const making = makingJobs(jobs).map(makingItem);
  const empty: DockModel = { active: [], failed: [], primary: null, percent: null, line: null, problem: null };
  if (!status || status.state === "none" || status.state === "ready") {
    if (making.length === 0) return empty;
    return { ...empty, active: making, primary: making[0]!, percent: making.length === 1 ? making[0]!.percent ?? null : null };
  }
  const active: DockItem[] = [];
  const failed: DockItem[] = [];
  if (status.state === "installing_engine") {
    const label = status.stageLabel ?? "Setting up your AI";
    active.push({ key: "engine", words: { verb: "Setting up", what: "your AI", benefit: "Home needs its AI engine before it can chat." }, label, state: "running", completedBytes: 0, totalBytes: 0, bytesPerSecond: null });
  } else if (status.state === "engine_failed") {
    failed.push({ key: "engine", words: { verb: "Setting up", what: "your AI", benefit: "Home needs its AI engine before it can chat." }, label: i18n._({ id: "Setting up your AI", message: "Setting up your AI" }), state: "failed", completedBytes: 0, totalBytes: 0, bytesPerSecond: null, reason: status.problem });
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
  return { active: [...ordered, ...making], failed, primary, percent, line, problem: status.problem };
}

/** What to say when the last active item finishes: a made thing by name, else the plain install sentence. */
export function finishedLine(made: string | null): string {
  if (made === "a picture") return i18n._({ id: "Your picture is ready.", message: "Your picture is ready." });
  if (made === "a video") return i18n._({ id: "Your video is ready.", message: "Your video is ready." });
  if (made === "a song") return i18n._({ id: "Your song is ready.", message: "Your song is ready." });
  return i18n._({ id: "The install finished.", message: "The install finished." });
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

const NO_ROWS: HomeJobView[] = [];
// Everyone reads the job list: model downloads for the admin's file details, and each person's own makes. A non-admin never sees a download row.
const dockRows = (rows: HomeJobView[]) => rows.filter((row) => row.kind === "model_download" || makingJobs([row]).length > 0);

/** The one install line, pinned to the bottom of the page: what is installing, why it matters and how far
 * along. People who can act on it (owner, admin) open it like an accordion for each install's size, speed,
 * files, Cancel and Try again; everyone else sees the same line, not expandable. */
export function InstallDock({ admin, read: readProp, readJobs: readJobsProp, readActivity, retry = api.installRetry, stop = api.stopJob, repairsHref = "/repairs" }: {
  admin: boolean;
  read?: () => Promise<InstallStatusView>;
  readJobs?: () => Promise<HomeJobView[]>;
  /** The Activity list, read through the shared cache the shell already keeps fresh; a test passes its own. */
  readActivity?: () => Promise<ActivityListView>;
  retry?: () => Promise<unknown>;
  stop?: (id: string) => Promise<unknown>;
  repairsHref?: string;
}) {
  const status = useInstallStatus(readProp).data ?? null;
  const jobs = useJobs({ read: readJobsProp, fast: (rows) => installActive(status) || (rows ? makingJobs(rows).length > 0 : false), select: dockRows }).data ?? NO_ROWS;
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const onActivityPage = useLocation().pathname === ACTIVITY_PATH;
  // ACTIVITY-PAGE-01 (PRO-LOOK-01 section 23): a making job that ends while the person is here turns into its DONE or COULD NOT FINISH card
  // for a short time, with Open and Activity, then leaves. It reads the Activity list the shell already keeps (no extra poll).
  const activity = useActivity(true, readActivity).data;
  const seenMaking = useRef(new Set<string>());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [retryError, setRetryError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // The strip sits above the phone bar, never over it: measure the bar (docked, floating or PRO) rather than restyle it from CSS.
  const [navTop, setNavTop] = useState(0);
  useEffect(() => {
    const measure = () => {
      // The strip clears the phone bar and, when it shows, the mini player above that bar.
      const clearance = (selector: string) => {
        const node = document.querySelector(selector);
        return node instanceof HTMLElement && node.offsetParent !== null ? Math.max(0, window.innerHeight - node.getBoundingClientRect().top) : 0;
      };
      const top = Math.max(clearance('[data-slot="phone-nav"]'), clearance('[data-slot="global-mini-player"]'));
      setNavTop((previous) => (previous === top ? previous : top));
    };
    measure();
    window.addEventListener("resize", measure);
    const timer = window.setInterval(measure, 1000);
    return () => { window.removeEventListener("resize", measure); window.clearInterval(timer); };
  }, []);


  const model = buildDock(status, jobs);
  const showing = model.primary !== null;
  useEffect(() => { for (const entry of model.active) if (entry.key.startsWith("make:")) seenMaking.current.add(entry.key.slice(5)); });
  const ended = activity?.items.find((entry) => seenMaking.current.has(entry.id) && (entry.state === "done" || entry.state === "failed") && !dismissed.has(entry.id) && !model.active.some((live) => live.key === `make:${entry.id}`)) ?? null;
  const endedId = ended?.id ?? null;
  useEffect(() => {
    if (endedId === null) return;
    const timer = window.setTimeout(() => setDismissed((previous) => new Set(previous).add(endedId)), 12_000);
    return () => window.clearTimeout(timer);
  }, [endedId]);
  const box = useAnchorBox(showing || ended !== null);

  // Announce the start and the finish once, never each percent.
  const before = useRef<{ active: boolean; failed: boolean }>({ active: false, failed: false });
  const activeNow = model.active.length > 0;
  const failedNow = model.failed.length > 0;
  const startLabel = model.primary?.label ?? "";
  // What the last finished thing was, so the finish line can name it (a picture, a video, a song) instead of "install".
  const lastMaking = useRef<string | null>(null);
  const makingNow = activeNow && model.active.every((entry) => entry.key.startsWith("make:")) ? model.active[0]!.words.what : null;
  useEffect(() => {
    if (status === null) return;
    const was = before.current;
    const made = activeNow ? makingNow : lastMaking.current;
    lastMaking.current = makingNow;
    if (activeNow && !was.active) setAnnouncement(`${startLabel} has started.`);
    else if (!activeNow && was.active && !failedNow) setAnnouncement(finishedLine(made));
    if (failedNow && !was.failed) setAnnouncement("An install did not finish. Open it to try again.");
    before.current = { active: activeNow, failed: failedNow };
  }, [status, activeNow, failedNow, startLabel, makingNow]);
  useEffect(() => { if (!showing) setOpen(false); }, [showing]);

  const onRetry = () => {
    setRetryError(null);
    retry().catch((reason: unknown) => {
      const words = reason instanceof ApiError ? [localizedApiMessage(reason), localizedApiNext(reason)].filter(Boolean).join(" ") : "";
      setRetryError(words || "Home couldn't restart the install. Check that this computer is online, then press Try again.");
    });
  };

  const announcer = <p role="status" aria-live="polite" aria-atomic="true" data-testid="install-announcer" className="sr-only">{announcement}</p>;
  const primary = model.primary;
  if (!primary && ended) {
    const sideEnded = { ...(box ? { left: box.left, right: box.right } : { left: 0, right: 0 }), ...(navTop > 0 ? { bottom: navTop } : {}) };
    const failed = ended.state === "failed";
    return (
      <>
        {announcer}
        <section aria-label={i18n._({ id: "A job just ended", message: "A job just ended" })} data-testid="install-dock-ended" style={sideEnded} className="pointer-events-none fixed bottom-0 z-40 flex justify-center px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="pointer-events-auto w-full max-w-md">
            <StatusCard
              kind={failed ? "problem" : "done"}
              stateWord={failed ? i18n._({ id: "Could not finish", message: "Could not finish" }) : i18n._({ id: "Done", message: "Done" })}
              title={ended.title}
              line={failed ? ended.line ?? undefined : undefined}
              action={ended.href ? { label: failed ? i18n._({ id: "Try again", message: "Try again" }) : i18n._({ id: "Open", message: "Open" }), onSelect: () => navigate(ended.href!) } : undefined}
              secondary={{ label: i18n._({ id: "Activity", message: "Activity" }), onSelect: () => navigate(ACTIVITY_PATH) }}
            />
          </div>
        </section>
      </>
    );
  }
  if (!primary) return announcer;

  const extra = model.active.length + model.failed.length - 1;
  const onlyFailed = model.active.length === 0;
  const title = onlyFailed ? (admin ? failureLine(primary) : "Part of your AI did not finish installing") : primary.label;
  const second = onlyFailed ? (admin ? "Open to try again." : "Ask an owner or admin to open Repairs.") : model.line;
  const bar = model.percent;
  const side = { ...(box ? { left: box.left, right: box.right } : { left: 0, right: 0 }), ...(navTop > 0 ? { bottom: navTop } : {}) };

  const activityLink = <div className="px-3 pb-2"><Link to={ACTIVITY_PATH} data-testid="install-dock-activity" className="text-supporting text-muted-foreground underline underline-offset-4">{i18n._({ id: "See all activity", message: "See all activity" })}</Link></div>;
  const summary = (
    <>
      <span className="flex items-start gap-2 text-sm text-foreground">
        <span className="min-w-0 flex-1 line-clamp-2 break-words">{title}</span>
        {extra > 0 ? <span className="shrink-0 text-muted-foreground">{i18n._({ id: "+{count} more", message: "+{count} more", values: { count: extra } })}</span> : null}
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
        aria-label={i18n._({ id: "Installs in progress", message: "Installs in progress" })}
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
                        <Button type="button" variant="outline" size="sm" onClick={onRetry}>{i18n._({ id: "Try again", message: "Try again" })}</Button>
                        <Link to={repairsHref} className="text-sm underline">{i18n._({ id: "Repairs", message: "Repairs" })}</Link>
                      </div>
                    </div>
                  ))}
                  {retryError ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={retryError} /> : null}
                </div>
              </CollapsibleContent>
              <CollapsibleTrigger asChild>
                <button type="button" data-testid="install-dock-toggle" aria-label={`${title}. ${open ? "Hide details" : "Show details"}`} className="block w-full rounded-md px-3 pt-2 pb-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">{summary}</button>
              </CollapsibleTrigger>
              {bar !== null && !onlyFailed ? <div className="px-3 pb-2"><Progress mode="determinate" value={bar} label={`${title} progress`} /></div> : <div className="pb-1" />}
              {makingNow !== null && !onActivityPage ? activityLink : null}
            </Collapsible>
          ) : (
            <div className="px-3 pt-2 pb-2">
              {primary.href && !onlyFailed ? <Link to={primary.href} data-testid="install-dock-link" className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">{summary}</Link> : summary}
              {bar !== null && !onlyFailed ? <div className="pt-1"><Progress mode="determinate" value={bar} label={`${title} progress`} /></div> : null}
              {makingNow !== null && !onActivityPage ? activityLink : null}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
