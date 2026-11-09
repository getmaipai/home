import { i18n } from "@lingui/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { JobProgress } from "@maipai/ui/src/elements/job-progress";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { getIcon } from "@maipai/ui/src/icons";
import { IconTile } from "@maipai/ui/src/primitives/IconTile";
import { ComparisonCard } from "@maipai/ui/src/elements/comparison-card";
import { api, type ChatModelChoice, type HardwareInfo, type ModelFit } from "@/lib/api";
import { formatBytes } from "@maipai/ui/src/format";
import { useFitPlan } from "@/lib/useFitPlan";
import { modelLinkName, parseModelLink } from "@/lib/modelLink";
import { SpecSheet } from "@maipai/ui/src/elements/spec-sheet";
import { RecommendationCard } from "@maipai/ui/src/elements/recommendation-card";
import { describeFitPlan, describeHomeOwnedRoles, fitBadgeWord, fitSourceSentence, type FitPanelRow } from "@/lib/fitPanel";
import type { ComputerMemoryResponse } from "@/lib/api";
import type { FitPlanResponse } from "@/lib/api";
import { summarizeFits } from "@/lib/fitSummary";
import { isVisibleModelDownload, modelDownloadProgress, useModelDownloadJobs } from "@/lib/modelDownloadProgress";
import { errorLine } from "@/lib/hubReachability";
import { StatusCard } from "@maipai/ui/src/elements/status-card";

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
  const downloads = useModelDownloadJobs();
  const [computerMemory, setComputerMemory] = useState<ComputerMemoryResponse | null>(null);
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [chatFits, setChatFits] = useState<ModelFit[] | null>(null);
  const [imageFits, setImageFits] = useState<ModelFit[] | null>(null);
  const [videoFits, setVideoFits] = useState<ModelFit[] | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [stackChat, setStackChat] = useState<{ name: string | null; state: string }>({ name: null, state: "offline" });
  const [installedIds, setInstalledIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Array<{ name: string; response: FitPlanResponse }>>([]);

  const load = useCallback(() => {
    setError(null);
    Promise.all([api.hardware(), api.models("chat"), api.models("image"), api.models("video"), api.modelSelection()])
      .then(([hw, chat, image, video, selection]) => {
        setHardware(hw);
        setChatFits(chat);
        setImageFits(image);
        setVideoFits(video);
        setSelectedModelId(selection.modelId);
        setStackChat({ name: selection.name, state: selection.state });
        setInstalledIds(selection.installed ?? []);
      })
      .catch((e: unknown) => setError(errorLine(e, i18n._({ id: "Could not load this computer's information.", message: "Could not load this computer's information." }))));
  }, []);

  useEffect(load, [load]);

  const loadComputerMemory = useCallback(() => {
    api.computerMemory().then(setComputerMemory).catch(() => setComputerMemory({ available: false }));
  }, []);
  useEffect(loadComputerMemory, [loadComputerMemory]);

  const implementedChatFits = chatFits?.filter((fit) => fit.model.implemented) ?? [];
  const recommended = implementedChatFits.find((fit) => fit.model.id === selectedModelId) ?? implementedChatFits[0] ?? null;
  const recommendedUrl = recommended?.model.download?.url?.startsWith("https://huggingface.co/") ? recommended.model.download.url : null;
  const recommendedFit = useFitPlan(recommendedUrl, recommended?.contextUsed);

  return (
    <>
      {downloads.filter((job) => isVisibleModelDownload(job)).map((job) => <JobProgress presentation="card" key={job.id} {...modelDownloadProgress(job)} variant="full" cancelable={job.actions?.includes("stop")} onCancel={job.actions?.includes("stop") ? () => { void api.stopJob(job.id); } : undefined} />)}
      <div className="flex flex-col gap-4">
        {error ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={error} /> : null}
        {hardware === null ? (
          <Progress mode="spinner" label={i18n._({ id: "Checking this computer", message: "Checking this computer" })} />
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-base text-muted-foreground">{describeHardware(hardware)}</p>
            {computerMemory ? <ComputerMemory response={computerMemory} /> : null}
            <ChatModelCard
              fits={chatFits}
              selectedModelId={selectedModelId}
              stackName={stackChat.name}
              stackState={stackChat.state}
              fitPlan={recommendedFit}
            />
            <ChatModelChoices fits={chatFits} selectedModelId={selectedModelId} installedIds={installedIds} downloading={downloads.some((job) => isVisibleModelDownload(job) && (job.state === "queued" || job.state === "running" || job.state === "paused" || job.state === "stalled"))} onChanged={load} />
            <CheckModelCard onChecked={(name, response) => setChecked((items) => [{ name, response }, ...items.filter((item) => item.name !== name)].slice(0, 3))} />
            {recommended ? <ModelComparison recommended={{ name: recommended.model.label, response: recommendedFit.response?.plan ? recommendedFit.response : null }} checked={checked} hardware={hardware} /> : null}
            <PlannedRoleCard title={i18n._({ id: "Image generation", message: "Image generation" })} fits={imageFits} />
            <PlannedRoleCard title={i18n._({ id: "Video generation", message: "Video generation" })} fits={videoFits} />
          </div>
        )}
      </div>
    </>
  );
}

// Exported for SetupWizard.tsx's hardware step: the same machine, the
// same sentence - a code review (2026-09-06) found the wizard had
// hand-built its own, differently-worded description of this computer
// rather than reusing this one, so Settings > AI models and the wizard
// described the same hardware inconsistently.
export function describeHardware(hw: HardwareInfo): string {
  if (hw.isAppleSilicon) return i18n._({ id: "This computer: Apple Silicon, {memory} GB memory.", message: "This computer: Apple Silicon, {memory} GB memory.", values: { memory: hw.unifiedMemoryGb } });
  if (hw.cudaDevices.length > 0) {
    const cards = hw.cudaDevices.map((d) => `${d.name} (${formatBytes(d.vramBytes)})`).join(", ");
    return i18n._({ id: "This computer: {cards}.", message: "This computer: {cards}.", values: { cards } });
  }
  return i18n._({ id: "This computer: no graphics card detected, {memory} GB memory. AI models will run slowly.", message: "This computer: no graphics card detected, {memory} GB memory. AI models will run slowly.", values: { memory: hw.totalRamGb } });
}

function ChatModelCard({
  fits,
  selectedModelId,
  stackName,
  stackState,
  fitPlan,
}: {
  fits: ModelFit[] | null;
  selectedModelId: string | null;
  stackName: string | null;
  stackState: string;
  fitPlan: ReturnType<typeof useFitPlan>;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const CheckIcon = getIcon("check");
  const ChevronIcon = getIcon("chevron-down");
  if (fits === null) return <RoleCardShell title={i18n._({ id: "Chat", message: "Chat" })}><Progress mode="spinner" label={i18n._({ id: "Checking the MaiPai Stack", message: "Checking the MaiPai Stack" })} /></RoleCardShell>;
  const primary = fits.find((f) => f.model.id === selectedModelId) ?? fits.find((f) => f.model.implemented) ?? null;
  const readyPlan = fitPlan.state === "ready" ? fitPlan.response?.plan : null;
  const fitDetails = readyPlan ? describeFitPlan(readyPlan) : null;
  return (
    <RoleCardShell title={i18n._({ id: "Chat", message: "Chat" })}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-base font-medium">{stackName ?? i18n._({ id: "No chat model selected in the MaiPai Stack", message: "No chat model selected in the MaiPai Stack" })}</span>
          {stackState === "ready" || stackState === "loaded" ? (
            <span className="flex items-center gap-1 text-base text-primary">
              <CheckIcon className="h-4 w-4" aria-hidden /> {stackState === "ready" ? i18n._({ id: "Ready", message: "Ready" }) : i18n._({ id: "Loaded", message: "Loaded" })}
            </span>
          ) : <span className="text-base text-muted-foreground">{stackState}</span>}
        </div>
        {primary ? <FitLine fitPlan={fitPlan} legacyWarning={!primary.fits} /> : null}
        <Disclosure open={showDetails} onToggle={() => setShowDetails((v) => !v)} label={i18n._({ id: "Details", message: "Details" })} icon={ChevronIcon}>
          <div className="flex flex-col gap-1 pt-1">
            <p className="text-base text-muted-foreground">{i18n._({ id: "Chat runs through the MaiPai Stack.", message: "Chat runs through the MaiPai Stack." })}</p>
            {primary ? fitDetails ? <>
              <SpecSheet title={i18n._({ id: "Fit details", message: "Fit details" })} rows={fitDetails.rows.map(({ label, value }) => ({ label, value }))} visibleCount={fitDetails.rows.length} />
              {fitDetails.rows.filter((row) => row.source).map((row) => <FitSource key={row.label} row={row} />)}
              {fitDetails.remedy ? <RecommendationCard state="idle" question={i18n._({ id: "What would help?", message: "What would help?" })}>{fitDetails.remedy}</RecommendationCard> : null}
            </> : <p className="text-base text-muted-foreground">{i18n._({ id: "Uses about {formatBytes} of memory.", message: "Uses about {formatBytes} of memory.", values: { formatBytes: formatBytes(primary.requiredBytes) } })}</p> : <p className="text-base text-muted-foreground">{i18n._({ id: "The Stack has not reported a chat model.", message: "The Stack has not reported a chat model." })}</p>}
          </div>
        </Disclosure>
      </div>
    </RoleCardShell>
  );
}


function FitLine({ fitPlan, legacyWarning }: { fitPlan: ReturnType<typeof useFitPlan>; legacyWarning: boolean }) {
  const { state, response } = fitPlan;
  if (state === "loading") return <Progress mode="spinner" label={i18n._({ id: "Checking this computer", message: "Checking this computer" })} />;
  if (state === "ready" && response && response.plan !== null) {
    return <FitResult headline={response.wording.headline} detail={response.wording.detail} verdict={response.wording.verdict} />;
  }
  if (!legacyWarning) return null;
  const AlertIcon = getIcon("alert-triangle");
  return <p className="flex items-start gap-1.5 text-base text-muted-foreground"><AlertIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {i18n._({ id: "This may run slowly on this computer.", message: "This may run slowly on this computer." })}</p>;
}

function FitResult({ headline, detail, verdict, sizedModel }: { headline: string; detail: string; verdict: "yes" | "slow" | "no" | "unknown"; sizedModel?: string | null }) {
  return <div className="flex flex-col items-start gap-1"><FitVerdictBadge verdict={verdict} /><p className="text-base text-muted-foreground">{headline}</p><p className="text-base text-muted-foreground">{detail}</p>{sizedModel ? <p className="text-base text-muted-foreground">{i18n._({ id: "Sized from {sizedModel}.", message: "Sized from {sizedModel}.", values: { sizedModel } })}</p> : null}</div>;
}

function FitVerdictBadge({ verdict }: { verdict: "yes" | "slow" | "no" | "unknown" }) {
  const appearance = {
    yes: { variant: "secondary" as const, tone: "success" as const },
    slow: { variant: "secondary" as const, tone: "warning" as const },
    no: { variant: "destructive" as const, tone: "default" as const },
    unknown: { variant: "secondary" as const, tone: "default" as const },
  }[verdict];
  return <Badge data-verdict={verdict} variant={appearance.variant} tone={appearance.tone}>{fitBadgeWord(verdict)}</Badge>;
}

function CheckModelCard({ onChecked }: { onChecked: (name: string, response: FitPlanResponse) => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<Awaited<ReturnType<typeof api.fitPlan>> | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const fitDetails = response?.plan ? describeFitPlan(response.plan) : null;

  async function check() {
    const parsed = parseModelLink(value);
    setResponse(null);
    setError(null);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    try {
      const fitResponse = await api.fitPlan({ source: parsed.source });
      setResponse(fitResponse);
      if (fitResponse.plan !== null) onChecked(modelLinkName(parsed), fitResponse);
    } catch (e) {
      setError(errorLine(e, i18n._({ id: "Could not check that link.", message: "Could not check that link." })));
    } finally {
      setBusy(false);
    }
  }

  return (
    <RoleCardShell title={i18n._({ id: "Check a model", message: "Check a model" })}>
      <p className="mb-3 text-base text-muted-foreground">{i18n._({ id: "Paste a Hugging Face link to see if a model will run on this computer before you download it.", message: "Paste a Hugging Face link to see if a model will run on this computer before you download it." })}</p>
      <form className="flex flex-col items-start gap-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void check(); }}>
        <Input value={value} onChange={(event) => setValue(event.target.value)} aria-label={i18n._({ id: "Hugging Face model link", message: "Hugging Face model link" })} />
        <Button type="submit" disabled={busy}>{busy ? i18n._({ id: "Checking…", message: "Checking…" }) : i18n._({ id: "Check", message: "Check" })}</Button>
      </form>
      {error ? <p className="mt-2 text-base text-muted-foreground">{error}</p> : null}
      {busy ? <div className="mt-2"><Progress mode="spinner" label={i18n._({ id: "Checking this computer", message: "Checking this computer" })} /></div> : null}
      {response ? <div className="mt-2"><FitResult headline={response.wording.headline} detail={response.wording.detail} verdict={response.wording.verdict} sizedModel={response.plan && typeof response.plan.model === "string" && response.plan.model.length > 0 ? response.plan.model : null} />{response.plan && fitDetails ? <Disclosure open={showPlan} onToggle={() => setShowPlan((open) => !open)} label={i18n._({ id: "How this was worked out", message: "How this was worked out" })} icon={getIcon("chevron-down")}>
        <SpecSheet title={i18n._({ id: "Fit details", message: "Fit details" })} rows={fitDetails.rows.map(({ label, value }) => ({ label, value }))} visibleCount={fitDetails.rows.length} />
        {fitDetails.rows.filter((row) => row.source).map((row) => <FitSource key={row.label} row={row} />)}
        {fitDetails.remedy ? <RecommendationCard state="idle" question={i18n._({ id: "What would help?", message: "What would help?" })}>{fitDetails.remedy}</RecommendationCard> : null}
      </Disclosure> : null}</div> : null}
    </RoleCardShell>
  );
}

function ModelComparison({ recommended, checked, hardware }: { recommended: { name: string; response: FitPlanResponse | null }; checked: Array<{ name: string; response: FitPlanResponse }>; hardware: HardwareInfo | null }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const comparable = [
    ...(recommended.response?.plan ? [{ name: recommended.name, response: recommended.response }] : []),
    ...checked.filter((item) => item.response.plan !== null),
  ];
  if (comparable.length < 2) return null;
  const options = comparable.map((item, index) => {
    const need = describeFitPlan(item.response.plan!).rows.find((row) => row.label === "Memory it needs")?.value ?? i18n._({ id: "Not known yet", message: "Not known yet" });
    const verdict = item.response.wording.verdict;
    const headline = verdict === "yes" ? item.response.wording.headline : i18n._({ id: "{headline} · Memory it needs: {need}", message: "{headline} · Memory it needs: {need}", values: { headline: item.response.wording.headline, need } });
    return { id: `${index}-${item.name}`, name: item.name, headline, traits: [verdict === "yes" ? need : false as const] };
  });
  const usableGb = recommended.response?.plan?.cap.high === null || recommended.response?.plan?.cap.high === undefined
    ? null
    : Math.ceil(recommended.response.plan.cap.high / (1024 ** 3));
  const summary = summarizeFits(comparable.map((item) => ({ name: item.name, wording: item.response.wording, plan: item.response.plan })), {
    memoryGb: hardware ? (hardware.isAppleSilicon ? hardware.unifiedMemoryGb : hardware.totalRamGb) : null,
    usableGb,
  });
  async function copySummary() {
    setCopied(false);
    setCopyFailed(false);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  }
  return (
    <>
      <h2 className="text-base font-medium">{i18n._({ id: "Compare", message: "Compare" })}</h2>
      <ComparisonCard traitLabels={[i18n._({ id: "Memory it needs", message: "Memory it needs" })]} options={options} />
      <Button type="button" variant="secondary" onClick={() => void copySummary()}>{copied ? i18n._({ id: "Copied", message: "Copied" }) : i18n._({ id: "Copy summary", message: "Copy summary" })}</Button>
      {copyFailed ? <div className="flex flex-col gap-2"><p className="text-base text-muted-foreground">{i18n._({ id: "Could not copy. Select the text below instead.", message: "Could not copy. Select the text below instead." })}</p><Textarea aria-label={i18n._({ id: "Summary to copy", message: "Summary to copy" })} readOnly rows={Math.min(12, summary.split("\n").length)} value={summary} /></div> : null}
    </>
  );
}

function FitSource({ row }: { row: FitPanelRow }) {
  if (!row.source) return null;
  return <p className="text-sm text-muted-foreground">{row.label}: {fitSourceSentence(row.source, row.asOf)}</p>;
}

function ComputerMemory({ response }: { response: ComputerMemoryResponse }) {
  if (!response.available) return null;
  const { memory } = response;
  const percent = memory.usableGb > 0 ? (memory.usedGb / memory.usableGb) * 100 : 0;
  return (
    <RoleCardShell title={i18n._({ id: "Memory right now", message: "Memory right now" })}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3"><IconTile icon="cpu" hue="--hue-blue" /><p className="text-lg font-medium tabular-nums">{i18n._({ id: "{usedGb} GB in use of {usableGb} GB", message: "{usedGb} GB in use of {usableGb} GB", values: { usedGb: memory.usedGb, usableGb: memory.usableGb } })}</p></div>
        <p className="text-base text-muted-foreground">{memory.pressureText}</p>
        <Progress mode="determinate" value={percent} label={i18n._({ id: "Memory used", message: "Memory used" })} />
        {memory.loaded.length ? <SpecSheet title={i18n._({ id: "Models using memory", message: "Models using memory" })} rows={memory.loaded.map((item) => ({ label: item.label, value: `${item.gb} GB` }))} visibleCount={memory.loaded.length} /> : <p className="text-base text-muted-foreground">{memory.homeOwnedRoles.length ? i18n._({ id: "The Stack has nothing loaded.", message: "The Stack has nothing loaded." }) : i18n._({ id: "Nothing is loaded right now.", message: "Nothing is loaded right now." })}</p>}
        {memory.homeOwnedRoles.length ? <p className="text-sm text-muted-foreground">{i18n._({ id: "This counts only what the Stack has loaded. Home's own engines still run: {describeHomeOwnedRoles}.", message: "This counts only what the Stack has loaded. Home's own engines still run: {describeHomeOwnedRoles}.", values: { describeHomeOwnedRoles: describeHomeOwnedRoles(memory.homeOwnedRoles) } })}</p> : null}
      </div>
    </RoleCardShell>
  );
}

/** MODEL-SWITCH-01: the chat models this computer can run, so an admin can download one and choose which one answers. */
function ChatModelChoices({ fits, selectedModelId, installedIds, downloading, onChanged }: { fits: ModelFit[] | null; selectedModelId: string | null; installedIds: string[]; downloading: boolean; onChanged: () => void }) {
  const [working, setWorking] = useState<{ id: string; text: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const choices = fits?.filter((fit) => fit.model.implemented && fit.model.download && fit.fits) ?? [];
  // Downloads finish on their own; look again once they stop so the button changes from Download to Use.
  const wasDownloading = useRef(false);
  useEffect(() => { if (wasDownloading.current && !downloading) onChanged(); wasDownloading.current = downloading; }, [downloading, onChanged]);
  if (choices.length < 2) return null;

  function watch(id: string) {
    api.chatModelChoice(id).then((choice: ChatModelChoice) => {
      if (choice.status === "ready") { setWorking(null); onChanged(); return; }
      if (choice.status === "failed") { setWorking(null); setMessage(choice.reason ?? i18n._({ id: "The model did not start. Your previous model is still the one answering.", message: "The model did not start. Your previous model is still the one answering." })); onChanged(); return; }
      timer.current = setTimeout(() => watch(id), 2000);
    }).catch(() => { timer.current = setTimeout(() => watch(id), 4000); });
  }

  async function choose(fit: ModelFit) {
    setMessage(null);
    const id = fit.model.id;
    setWorking({ id, text: i18n._({ id: "Starting {label}. This takes about a minute.", message: "Starting {label}. This takes about a minute.", values: { label: fit.model.label } }) });
    try {
      const choice = await api.chooseChatModel(id);
      if (choice.status === "downloading") { setWorking(null); onChanged(); return; }
      if (choice.status === "ready") { setWorking(null); onChanged(); return; }
      watch(id);
    } catch (e) {
      setWorking(null);
      setMessage(errorLine(e, i18n._({ id: "Could not change the chat model. Try again.", message: "Could not change the chat model. Try again." })));
    }
  }

  return (
    <RoleCardShell title={i18n._({ id: "Chat models", message: "Chat models" })}>
      <p className="mb-3 text-base text-muted-foreground">{i18n._({ id: "Pick which model answers chat. The household keeps working while a new one downloads, and your choice stays after a restart.", message: "Pick which model answers chat. The household keeps working while a new one downloads, and your choice stays after a restart." })}</p>
      <ul className="flex flex-col gap-3">
        {choices.map((fit) => {
          const model = fit.model;
          const inUse = model.id === selectedModelId;
          const installed = installedIds.includes(model.id);
          const busy = working !== null;
          return (
            <li key={model.id} className="flex flex-col gap-1 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-medium">{model.label}</span>
                  {model.tags?.includes("uncensored") ? <Badge variant="outline" tone="warning">{i18n._({ id: "Uncensored", message: "Uncensored" })}</Badge> : null}
                </span>
                {inUse ? <Badge variant="secondary" tone="success">{i18n._({ id: "In use", message: "In use" })}</Badge> : installed ? (
                  <Button type="button" disabled={busy || downloading} onClick={() => void choose(fit)}>{i18n._({ id: "Use this model", message: "Use this model" })}</Button>
                ) : (
                  <Button type="button" variant="outline" disabled={busy || downloading} onClick={() => void choose(fit)}>{i18n._({ id: "Download ({formatBytes})", message: "Download ({formatBytes})", values: { formatBytes: formatBytes(model.download!.approx_bytes) } })}</Button>
                )}
              </div>
              <ul className="list-disc pl-5 text-base text-muted-foreground">
                {(model.pros ?? []).map((line) => <li key={line}>{line}</li>)}
                {(model.cons ?? []).map((line) => <li key={line}>{line}</li>)}
              </ul>
              {working?.id === model.id ? <Progress mode="spinner" label={working.text} /> : null}
            </li>
          );
        })}
      </ul>
      {message ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={message} /> : null}
    </RoleCardShell>
  );
}

function PlannedRoleCard({ title, fits }: { title: string; fits: ModelFit[] | null }) {
  if (fits === null || fits.length === 0) return null;
  return (
    <RoleCardShell title={title}>
      <p className="text-base text-muted-foreground">{i18n._({ id: "Not available on this computer yet.", message: "Not available on this computer yet." })}</p>
    </RoleCardShell>
  );
}

function RoleCardShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <h2 className="mb-2 text-base font-medium">{title}</h2>
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
      <Button
        type="button"
        variant="ghost"
        onClick={onToggle}
        className="text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        <Icon className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        {label}
      </Button>
      {open ? children : null}
    </div>
  );
}
