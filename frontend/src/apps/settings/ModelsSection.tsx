import { useCallback, useEffect, useRef, useState } from "react";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { getIcon } from "@maipai/ui/src/icons";
import { IconTile } from "@maipai/ui/src/primitives/IconTile";
import { ComparisonCard } from "@maipai/ui/src/elements/comparison-card";
import { api, ApiError, type HardwareInfo, type ModelFit } from "@/lib/api";
import { formatBytes } from "@/apps/settings/formatBytes";
import { useFitPlan } from "@/lib/useFitPlan";
import { modelLinkName, parseModelLink } from "@/lib/modelLink";
import { SpecSheet } from "@maipai/ui/src/elements/spec-sheet";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/dashboard/components/ui/alert";
import { describeFitPlan, describeHomeOwnedRoles, fitBadgeWord, fitSourceSentence, type FitPanelRow } from "@/lib/fitPanel";
import type { ComputerMemoryResponse } from "@/lib/api";
import type { FitPlanResponse } from "@/lib/api";
import { summarizeFits } from "@/lib/fitSummary";

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
  const [computerMemory, setComputerMemory] = useState<ComputerMemoryResponse | null>(null);
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [chatFits, setChatFits] = useState<ModelFit[] | null>(null);
  const [imageFits, setImageFits] = useState<ModelFit[] | null>(null);
  const [videoFits, setVideoFits] = useState<ModelFit[] | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [stackChat, setStackChat] = useState<{ name: string | null; state: string }>({ name: null, state: "offline" });
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
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load this computer's information."));
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
    <div className="flex flex-col gap-4">
      {error ? <p className="text-base text-[var(--destructive)]">{error}</p> : null}
      {hardware === null ? (
        <Progress mode="spinner" label="Checking this computer" />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-base text-[var(--muted-foreground)]">{describeHardware(hardware)}</p>
          {computerMemory ? <ComputerMemoryCard response={computerMemory} /> : null}
          <ChatModelCard
            fits={chatFits}
            selectedModelId={selectedModelId}
            stackName={stackChat.name}
            stackState={stackChat.state}
            fitPlan={recommendedFit}
          />
          <CheckModelCard onChecked={(name, response) => setChecked((items) => [{ name, response }, ...items.filter((item) => item.name !== name)].slice(0, 3))} />
          {recommended ? <ModelComparison recommended={{ name: recommended.model.label, response: recommendedFit.response?.plan ? recommendedFit.response : null }} checked={checked} hardware={hardware} /> : null}
          <PlannedRoleCard title="Image generation" fits={imageFits} />
          <PlannedRoleCard title="Video generation" fits={videoFits} />
        </div>
      )}
    </div>
  );
}

// Exported for SetupWizard.tsx's hardware step: the same machine, the
// same sentence - a code review (2026-09-06) found the wizard had
// hand-built its own, differently-worded description of this computer
// rather than reusing this one, so Settings > AI models and the wizard
// described the same hardware inconsistently.
export function describeHardware(hw: HardwareInfo): string {
  if (hw.isAppleSilicon) return `This computer: Apple Silicon, ${hw.unifiedMemoryGb} GB memory.`;
  if (hw.cudaDevices.length > 0) {
    const cards = hw.cudaDevices.map((d) => `${d.name} (${formatBytes(d.vramBytes)})`).join(", ");
    return `This computer: ${cards}.`;
  }
  return `This computer: no graphics card detected, ${hw.totalRamGb} GB memory. AI models will run slowly.`;
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
  if (fits === null) return <RoleCardShell title="Chat"><Progress mode="spinner" label="Checking the MaiPai Stack" /></RoleCardShell>;
  const primary = fits.find((f) => f.model.id === selectedModelId) ?? fits.find((f) => f.model.implemented) ?? null;
  return (
    <RoleCardShell title="Chat">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-base font-medium">{stackName ?? "No chat model selected in the MaiPai Stack"}</span>
          {stackState === "ready" || stackState === "loaded" ? (
            <span className="flex items-center gap-1 text-base text-[var(--primary)]">
              <CheckIcon className="h-4 w-4" aria-hidden /> {stackState === "ready" ? "Ready" : "Loaded"}
            </span>
          ) : <span className="text-base text-[var(--muted-foreground)]">{stackState}</span>}
        </div>
        {primary ? <FitLine fitPlan={fitPlan} legacyWarning={!primary.fits} /> : null}
        <Disclosure open={showDetails} onToggle={() => setShowDetails((v) => !v)} label="Details" icon={ChevronIcon}>
          <div className="flex flex-col gap-1 pt-1"><p className="text-base text-[var(--muted-foreground)]">Chat runs through the MaiPai Stack.</p>{primary ? <DetailsFitPanel fitPlan={fitPlan} legacyBytes={primary.requiredBytes} /> : <p className="text-base text-[var(--muted-foreground)]">The Stack has not reported a chat model.</p>}</div>
        </Disclosure>
      </div>
    </RoleCardShell>
  );
}


function FitLine({ fitPlan, legacyWarning }: { fitPlan: ReturnType<typeof useFitPlan>; legacyWarning: boolean }) {
  const { state, response } = fitPlan;
  if (state === "loading") return <Progress mode="spinner" label="Checking this computer" />;
  if (state === "ready" && response && response.plan !== null) {
    return <FitResult headline={response.wording.headline} detail={response.wording.detail} verdict={response.wording.verdict} />;
  }
  if (!legacyWarning) return null;
  const AlertIcon = getIcon("alert-triangle");
  return <p className="flex items-start gap-1.5 text-base text-[var(--muted-foreground)]"><AlertIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> This may run slowly on this computer.</p>;
}

function FitResult({ headline, detail, verdict, sizedModel }: { headline: string; detail: string; verdict: "yes" | "slow" | "no" | "unknown"; sizedModel?: string | null }) {
  return <div className="flex flex-col items-start gap-1"><FitVerdictBadge verdict={verdict} /><p className="text-base text-[var(--muted-foreground)]">{headline}</p><p className="text-base text-[var(--muted-foreground)]">{detail}</p>{sizedModel ? <p className="text-base text-[var(--muted-foreground)]">Sized from {sizedModel}.</p> : null}</div>;
}

function FitVerdictBadge({ verdict }: { verdict: "yes" | "slow" | "no" | "unknown" }) {
  const appearance = {
    yes: { variant: "secondary" as const, className: "bg-[var(--hue-teal)] text-foreground" },
    slow: { variant: "secondary" as const, className: "bg-[var(--hue-orange)] text-foreground" },
    no: { variant: "destructive" as const, className: "" },
    unknown: { variant: "secondary" as const, className: "" },
  }[verdict];
  return <Badge data-verdict={verdict} variant={appearance.variant} className={appearance.className}>{fitBadgeWord(verdict)}</Badge>;
}

function CheckModelCard({ onChecked }: { onChecked: (name: string, response: FitPlanResponse) => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<Awaited<ReturnType<typeof api.fitPlan>> | null>(null);
  const [showPlan, setShowPlan] = useState(false);

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
      setError(e instanceof ApiError ? e.message : "Could not check that link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <RoleCardShell title="Check a model">
      <p className="mb-3 text-base text-[var(--muted-foreground)]">Paste a Hugging Face link to see if a model will run on this computer before you download it.</p>
      <form className="flex flex-col items-start gap-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void check(); }}>
        <Input value={value} onChange={(event) => setValue(event.target.value)} aria-label="Hugging Face model link" />
        <Button type="submit" disabled={busy}>{busy ? "Checking…" : "Check"}</Button>
      </form>
      {error ? <p className="mt-2 text-base text-[var(--muted-foreground)]">{error}</p> : null}
      {busy ? <div className="mt-2"><Progress mode="spinner" label="Checking this computer" /></div> : null}
      {response ? <div className="mt-2"><FitResult headline={response.wording.headline} detail={response.wording.detail} verdict={response.wording.verdict} sizedModel={response.plan && typeof response.plan.model === "string" && response.plan.model.length > 0 ? response.plan.model : null} />{response.plan ? <Disclosure open={showPlan} onToggle={() => setShowPlan((open) => !open)} label="How this was worked out" icon={getIcon("chevron-down")}><FitPanel response={response} /></Disclosure> : null}</div> : null}
    </RoleCardShell>
  );
}

function DetailsFitPanel({ fitPlan, legacyBytes }: { fitPlan: ReturnType<typeof useFitPlan>; legacyBytes: number }) {
  const { state, response } = fitPlan;
  if (state === "ready" && response?.plan) return <FitPanel response={response} />;
  return <p className="text-base text-[var(--muted-foreground)]">Uses about {formatBytes(legacyBytes)} of memory.</p>;
}

function FitPanel({ response }: { response: FitPlanResponse }) {
  if (!response.plan) return null;
  const { rows, remedy } = describeFitPlan(response.plan);
  return <div className="flex flex-col gap-3 pt-2"><SpecSheet title="Fit details" rows={rows.map(({ label, value }) => ({ label, value }))} visibleCount={rows.length} />{rows.filter((row) => row.source).map((row) => <FitSource key={row.label} row={row} />)}{remedy ? <Alert><AlertTitle>What would help?</AlertTitle><AlertDescription>{remedy}</AlertDescription></Alert> : null}</div>;
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
    const need = describeFitPlan(item.response.plan!).rows.find((row) => row.label === "Memory it needs")?.value ?? "Not known yet";
    const verdict = item.response.wording.verdict;
    const headline = verdict === "yes" ? item.response.wording.headline : `${item.response.wording.headline} · Memory it needs: ${need}`;
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
      <h2 className="text-base font-medium">Compare</h2>
      <ComparisonCard traitLabels={["Memory it needs"]} options={options} />
      <Button type="button" variant="secondary" onClick={() => void copySummary()}>{copied ? "Copied" : "Copy summary"}</Button>
      {copyFailed ? <div className="flex flex-col gap-2"><p className="text-base text-[var(--muted-foreground)]">Could not copy. Select the text below instead.</p><Textarea aria-label="Summary to copy" readOnly rows={Math.min(12, summary.split("\n").length)} value={summary} /></div> : null}
    </>
  );
}

function FitSource({ row }: { row: FitPanelRow }) {
  if (!row.source) return null;
  return <p className="text-sm text-[var(--muted-foreground)]">{row.label}: {fitSourceSentence(row.source, row.asOf)}</p>;
}

function ComputerMemoryCard({ response }: { response: ComputerMemoryResponse }) {
  if (!response.available) return null;
  const { memory } = response;
  const percent = memory.usableGb > 0 ? (memory.usedGb / memory.usableGb) * 100 : 0;
  return (
    <RoleCardShell title="Memory right now">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3"><IconTile icon="cpu" hue="--hue-blue" /><p className="text-lg font-medium tabular-nums">{memory.usedGb} GB in use of {memory.usableGb} GB</p></div>
        <p className="text-base text-[var(--muted-foreground)]">{memory.pressureText}</p>
        <Progress mode="determinate" value={percent} label="Memory used" />
        {memory.loaded.length ? <SpecSheet title="Models using memory" rows={memory.loaded.map((item) => ({ label: item.label, value: `${item.gb} GB` }))} visibleCount={memory.loaded.length} /> : <p className="text-base text-[var(--muted-foreground)]">{memory.homeOwnedRoles.length ? "The Stack has nothing loaded." : "Nothing is loaded right now."}</p>}
        {memory.homeOwnedRoles.length ? <p className="text-sm text-[var(--muted-foreground)]">This counts only what the Stack has loaded. Home&apos;s own engines still run: {describeHomeOwnedRoles(memory.homeOwnedRoles)}.</p> : null}
      </div>
    </RoleCardShell>
  );
}

function PlannedRoleCard({ title, fits }: { title: string; fits: ModelFit[] | null }) {
  if (fits === null || fits.length === 0) return null;
  return (
    <RoleCardShell title={title}>
      <p className="text-base text-[var(--muted-foreground)]">Not available on this computer yet.</p>
    </RoleCardShell>
  );
}

function RoleCardShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-4">
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
        className="justify-start gap-1 text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        <Icon className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        {label}
      </Button>
      {open ? children : null}
    </div>
  );
}
