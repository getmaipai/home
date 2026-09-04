import { useCallback, useEffect, useRef, useState } from "react";
import { Section } from "@/kit/primitives/Section";
import { Progress } from "@/kit/primitives/Progress";
import { Button } from "@/kit/components/Button";
import { getIcon } from "@/kit/icons";
import { api, ApiError, type HardwareInfo, type ModelFit, type ModelJob, type EngineStatus } from "@/lib/api";
import { formatBytes } from "@/apps/settings/formatBytes";

// The model-selection wizard, real half (2026-09-04): docs/SETTINGS.md
// Rule 3 ("One card per role... with the chosen model... and 'change.'
// Advanced and expert details fold") replaces the earlier read-only
// version's flat pros/cons dump - Jesse's own read on that version was
// "ugly and too technical for a dad... take up a lot of space visually
// and require a lot of reading." One card per role, one clear model and
// one action at a time; every number (exact memory use, the rest of the
// catalog) lives behind a "Details"/"Other options" toggle nobody has to
// read to use the page. `chat` is the only role with a real backend
// (llm.ts's IMPLEMENTED_ROLES) - modelDownloadJobs.ts's "choose this"
// flow is wired for it; image/video stay a single honest line, no
// pros/cons dump, since there's nothing to choose yet.
export function ModelsSection() {
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [chatFits, setChatFits] = useState<ModelFit[] | null>(null);
  const [imageFits, setImageFits] = useState<ModelFit[] | null>(null);
  const [videoFits, setVideoFits] = useState<ModelFit[] | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [job, setJob] = useState<ModelJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([api.hardware(), api.models("chat"), api.models("image"), api.models("video"), api.modelSelection(), api.engineStatus()])
      .then(([hw, chat, image, video, selection, engine]) => {
        setHardware(hw);
        setChatFits(chat);
        setImageFits(image);
        setVideoFits(video);
        setSelectedModelId(selection.modelId);
        setEngineStatus(engine);
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load this computer's information."));
  }, []);

  useEffect(load, [load]);

  // A light background poll for "is it still running" (engine control's
  // other half: seeing it go down, not just starting/stopping it) - slow
  // enough (10s) not to be a real load, since this is dad-facing status,
  // not a live dashboard.
  useEffect(() => {
    const timer = setInterval(() => {
      api.engineStatus().then(setEngineStatus).catch(() => {});
    }, 10_000);
    return () => clearInterval(timer);
  }, []);

  async function handleStop() {
    setError(null);
    try {
      setEngineStatus(await api.stopEngine());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not stop the AI.");
    }
  }

  async function handleRestart() {
    setError(null);
    setEngineStatus({ kind: "starting", modelId: null, pid: null, startedAt: null });
    try {
      setEngineStatus(await api.restartEngine());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not restart the AI.");
      load();
    }
  }

  // Poll the active job while it's actually in flight; stop as soon as it
  // lands on ready/failed so an idle page never keeps a timer running.
  useEffect(() => {
    if (!job || job.status === "ready" || job.status === "failed" || job.status === "none") return;
    const timer = setInterval(() => {
      api
        .modelSelectStatus(job.modelId)
        .then(setJob)
        .catch(() => {
          /* a transient poll failure isn't worth surfacing; the next tick retries */
        });
    }, 1000);
    return () => clearInterval(timer);
  }, [job]);

  // selectedModelId tracks "ready" from wherever it's first observed - a
  // poll tick landing on ready, or (a code review, 2026-09-04, found this
  // exact gap) the very first select response already being ready, e.g.
  // re-selecting a model whose files are already fully cached on disk.
  // The poll effect above never even starts in that case (its own guard
  // bails out immediately on a job that's already terminal), so this had
  // to live in its own effect covering every path job can reach "ready"
  // through, not inlined into just one of them.
  useEffect(() => {
    if (job?.status === "ready") setSelectedModelId(job.modelId);
  }, [job]);

  async function handleChoose(modelId: string) {
    setError(null);
    try {
      setJob(await api.selectModel(modelId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start setting up this model.");
    }
  }

  return (
    <Section heading="AI models">
      {error ? <p className="text-sm text-[hsl(var(--destructive))]">{error}</p> : null}
      {hardware === null ? (
        <Progress mode="spinner" label="Checking this computer" />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{describeHardware(hardware)}</p>
          <ChatModelCard
            fits={chatFits}
            selectedModelId={selectedModelId}
            job={job}
            engineStatus={engineStatus}
            onChoose={handleChoose}
            onStop={handleStop}
            onRestart={handleRestart}
          />
          <PlannedRoleCard title="Image generation" fits={imageFits} />
          <PlannedRoleCard title="Video generation" fits={videoFits} />
        </div>
      )}
    </Section>
  );
}

function describeHardware(hw: HardwareInfo): string {
  if (hw.isAppleSilicon) return `This computer: Apple Silicon, ${hw.unifiedMemoryGb} GB memory.`;
  if (hw.cudaDevices.length > 0) {
    const cards = hw.cudaDevices.map((d) => `${d.name} (${formatBytes(d.vramBytes)})`).join(", ");
    return `This computer: ${cards}.`;
  }
  return `This computer: no graphics card detected, ${hw.totalRamGb} GB memory. AI models will run slowly.`;
}

// Pulled out of ChatModelCard as one named, unit-testable function rather
// than four booleans chained inline (a code review, 2026-09-04, flagged
// the inline version as easy to update incompletely - miss one spot when
// a new engine/job status is added later, and the card silently falls
// through to the wrong branch with no compiler error). Still four
// booleans, not a full discriminated union: a bigger rewrite of the JSX
// below to consume one wasn't worth the risk of a rushed, un-reviewed
// restructure at this hour for what the review itself called a
// maintainability nice-to-have, not a bug - this is the bounded half of
// that fix.
// "ready" excluded alongside "none"/"failed": a completed job must stop
// counting as "active" or the card gets stuck showing progress UI
// forever (the same review finding).
function activeJobOf(job: ModelJob | null): ModelJob | null {
  return job && job.status !== "none" && job.status !== "failed" && job.status !== "ready" ? job : null;
}

function deriveEngineState(
  isSelected: boolean,
  engineStatus: EngineStatus | null,
  modelId: string,
) {
  // "url"/"override" count as running too, not just "selection": a code
  // review (2026-09-04) found only "selection" counted, so a developer's
  // MAIPAI_LLAMA_SERVER_URL/_BIN override active at the same time as a
  // household selection left the card blank (isSelected true, every
  // derived flag false) instead of showing it as running - reachable only
  // via that env-override dev configuration, but a real gap. Those two
  // kinds have no real modelId to compare (llmSupervisor.ts never sets
  // one for them), so they're not required to match; "selection" still
  // must match modelId - a stale poll response naming a model this
  // household member just switched away from should never read as "this
  // card is running."
  const isRunning =
    isSelected &&
    (engineStatus?.kind === "url" ||
      engineStatus?.kind === "override" ||
      (engineStatus?.kind === "selection" && engineStatus.modelId === modelId));
  return {
    isRunning,
    isStarting: isSelected && engineStatus?.kind === "starting",
    isStopped: isSelected && engineStatus?.kind === "stopped",
  };
}

// Real time/amount-left tracking (Jesse, 2026-09-04: "we need to be able
// to see progress - time/amount left, time/amount downloaded"). The job
// row only ever carries a byte count, not a rate - speed is derived
// client-side from successive polls (job.completedBytes is polled every
// 1s), smoothed so one slow or fast tick doesn't make the ETA jump
// around. Resets whenever the phase changes (downloading_engine's small
// archive finishing and downloading_model's much larger one starting is
// a real, sharp rate change, not noise to smooth through).
function useDownloadRate(completedBytes: number, totalBytes: number, status: string): { bytesPerSecond: number | null; etaSeconds: number | null } {
  const lastRef = useRef<{ completedBytes: number; at: number; status: string } | null>(null);
  const [bytesPerSecond, setBytesPerSecond] = useState<number | null>(null);

  useEffect(() => {
    if (totalBytes <= 0) return;
    const now = Date.now();
    const last = lastRef.current;
    if (!last || last.status !== status) {
      setBytesPerSecond(null);
    } else if (completedBytes > last.completedBytes) {
      const seconds = (now - last.at) / 1000;
      if (seconds > 0) {
        const instant = (completedBytes - last.completedBytes) / seconds;
        setBytesPerSecond((prev) => (prev === null ? instant : prev * 0.6 + instant * 0.4));
      }
    }
    lastRef.current = { completedBytes, at: now, status };
  }, [completedBytes, totalBytes, status]);

  const etaSeconds = bytesPerSecond && bytesPerSecond > 0 ? (totalBytes - completedBytes) / bytesPerSecond : null;
  return { bytesPerSecond, etaSeconds };
}

export function formatEta(seconds: number): string {
  if (seconds < 90) return "less than a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"} left`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hour${hours === 1 ? "" : "s"} left`;
}

const JOB_PHASE_LABEL: Record<string, string> = {
  queued: "Getting ready…",
  downloading_engine: "Setting up the AI engine…",
  downloading_model: "Downloading the model…",
  verifying: "Double-checking the download…",
  loading: "Starting it up…",
  testing: "Making sure it works…",
};

function ChatModelCard({
  fits,
  selectedModelId,
  job,
  engineStatus,
  onChoose,
  onStop,
  onRestart,
}: {
  fits: ModelFit[] | null;
  selectedModelId: string | null;
  job: ModelJob | null;
  engineStatus: EngineStatus | null;
  onChoose: (modelId: string) => void;
  onStop: () => void;
  onRestart: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const CheckIcon = getIcon("check");
  const AlertIcon = getIcon("alert-triangle");
  const ChevronIcon = getIcon("chevron-down");

  if (fits === null) return <RoleCardShell title="Chat"><Progress mode="spinner" label="Checking options" /></RoleCardShell>;
  // Only entries with a real backend can ever be offered a "Use this" -
  // the old read-only version explicitly gated on `implemented`; a code
  // review (2026-09-04) found the rewrite had dropped that guard (no live
  // impact today, the catalog's one chat entry is implemented: true, but
  // a real regression in the code for the day a second one isn't).
  const implementedFits = fits.filter((f) => f.model.implemented);
  if (implementedFits.length === 0) return null;

  const activeJob = activeJobOf(job);
  // Called unconditionally (React's rules of hooks) even when nothing is
  // downloading; the hook itself no-ops whenever totalBytes is 0.
  const { bytesPerSecond, etaSeconds } = useDownloadRate(activeJob?.completedBytes ?? 0, activeJob?.totalBytes ?? 0, activeJob?.status ?? "");
  const failedJob = job && job.status === "failed" ? job : null;
  const primary = implementedFits.find((f) => f.model.id === (activeJob?.modelId ?? failedJob?.modelId ?? selectedModelId)) ?? implementedFits[0]!;
  const isSelected = selectedModelId === primary.model.id && !activeJob;
  const { isRunning, isStarting, isStopped } = deriveEngineState(isSelected, engineStatus, primary.model.id);
  const others = implementedFits.filter((f) => f.model.id !== primary.model.id);

  return (
    <RoleCardShell title="Chat">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-base font-medium">{primary.model.label}</span>
          {isRunning ? (
            <span className="flex items-center gap-1 text-sm text-[hsl(var(--primary))]">
              <CheckIcon className="h-4 w-4" aria-hidden /> Running
            </span>
          ) : isStopped ? (
            <span className="text-sm text-[hsl(var(--muted-foreground))]">Stopped</span>
          ) : isStarting ? (
            <span className="text-sm text-[hsl(var(--muted-foreground))]">Starting…</span>
          ) : null}
        </div>

        {isSelected && (isRunning || isStopped || isStarting) ? (
          <div className="flex gap-2">
            {isRunning ? (
              <>
                <Button variant="secondary" size="sm" onClick={onRestart}>Restart</Button>
                <Button variant="ghost" size="sm" onClick={onStop}>Stop</Button>
              </>
            ) : isStopped ? (
              <Button variant="secondary" size="sm" onClick={onRestart}>Start</Button>
            ) : (
              <Progress mode="spinner" label="Starting…" />
            )}
          </div>
        ) : null}

        {activeJob ? (
          <div className="flex flex-col gap-1">
            {/* Progress's determinate mode renders no label of its own
             * (spinner mode is the only one that does), so the phase text
             * is its own line here rather than passed as `label`. */}
            <p className="text-sm text-[hsl(var(--muted-foreground))]">{JOB_PHASE_LABEL[activeJob.status] ?? "Working…"}</p>
            <Progress
              mode={activeJob.totalBytes > 0 ? "determinate" : "spinner"}
              value={activeJob.totalBytes > 0 ? (activeJob.completedBytes / activeJob.totalBytes) * 100 : undefined}
            />
            {activeJob.totalBytes > 0 ? (
              <span className="text-sm text-[hsl(var(--muted-foreground))]">
                {formatBytes(activeJob.completedBytes)} of {formatBytes(activeJob.totalBytes)}
                {bytesPerSecond ? ` · ${formatBytes(bytesPerSecond)}/s` : ""}
                {etaSeconds !== null ? ` · ${formatEta(etaSeconds)}` : ""}
              </span>
            ) : null}
          </div>
        ) : failedJob ? (
          <div className="flex flex-col gap-2">
            <p className="flex items-start gap-1.5 text-sm text-[hsl(var(--destructive))]">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Something went wrong: {failedJob.error}
            </p>
            <Button variant="secondary" size="sm" className="w-fit" onClick={() => onChoose(primary.model.id)}>
              Try again
            </Button>
          </div>
        ) : isSelected ? null : (
          <div className="flex flex-col gap-2">
            {!primary.fits ? (
              <p className="flex items-start gap-1.5 text-sm text-[hsl(var(--muted-foreground))]">
                <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> This may run slowly on this computer.
              </p>
            ) : null}
            <Button size="sm" className="w-fit" onClick={() => onChoose(primary.model.id)}>
              Use this
            </Button>
          </div>
        )}

        <Disclosure open={showDetails} onToggle={() => setShowDetails((v) => !v)} label="Details" icon={ChevronIcon}>
          <div className="flex flex-col gap-1 pt-1">
            {(primary.model.pros ?? []).map((pro) => (
              <p key={pro} className="text-sm text-[hsl(var(--muted-foreground))]">+ {pro}</p>
            ))}
            {(primary.model.cons ?? []).map((con) => (
              <p key={con} className="text-sm text-[hsl(var(--muted-foreground))]">− {con}</p>
            ))}
            <p className="text-sm text-[hsl(var(--muted-foreground))]">Uses about {formatBytes(primary.requiredBytes)} of memory.</p>
          </div>
        </Disclosure>

        {others.length > 0 ? (
          <Disclosure open={showOthers} onToggle={() => setShowOthers((v) => !v)} label="Other options" icon={ChevronIcon}>
            <div className="flex flex-col gap-2 pt-1">
              {others.map((f) => (
                <div key={f.model.id} className="flex items-center justify-between gap-2 rounded-[var(--radius)] border border-[hsl(var(--border))] p-2 text-sm">
                  <span>{f.model.label}</span>
                  <Button variant="secondary" size="sm" onClick={() => onChoose(f.model.id)} disabled={activeJob !== null}>
                    Use this
                  </Button>
                </div>
              ))}
            </div>
          </Disclosure>
        ) : null}
      </div>
    </RoleCardShell>
  );
}

function PlannedRoleCard({ title, fits }: { title: string; fits: ModelFit[] | null }) {
  if (fits === null || fits.length === 0) return null;
  return (
    <RoleCardShell title={title}>
      <p className="text-sm text-[hsl(var(--muted-foreground))]">Not available on this computer yet.</p>
    </RoleCardShell>
  );
}

function RoleCardShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] p-4">
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      {children}
    </div>
  );
}

function Disclosure({
  open,
  onToggle,
  label,
  icon: Icon,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  icon: ReturnType<typeof getIcon>;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
        aria-expanded={open}
      >
        <Icon className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        {label}
      </button>
      {open ? children : null}
    </div>
  );
}
