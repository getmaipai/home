import { totalmem } from "node:os";
import { createConnection } from "node:net";
import { checkInstallPreflight, isSupportedInstallPlatform } from "@/lib/installPreflight";
import { getStackClient, isRemoteStackSelected } from "@/lib/stackEngine";
import { getEngineLinkState } from "@/lib/stack/link";
import { classDir } from "@/lib/paths";
import { checkModelDisk, checkHubDisk } from "./placementDiskChecks";
import { checkNvidiaSysmemFallback, type NvidiaSysmemFallbackReader } from "./nvidiaSysmemFallback";
import { getSetupState } from "@/lib/setupState";
import { minimum, defaultModelBytes } from "@/lib/placement";
import { getTailscaleStatus } from "@/lib/tailscale";
import { REMOTE_ENGINE_HOST_KEY, REMOTE_ALLOW_TAILNET_KEY } from "@/lib/remoteStackSettings";
import { getEngineLink } from "@/lib/stack/link";
import { db } from "@/db";
import { people } from "@/db/schema";
import { checkSearchInstance } from "@/lib/searchInstanceCheck";
import { isStackConfigured } from "@/lib/stackEngine";
import { getHouseholdSettingValue } from "@/lib/settings";

export type CheckState = "green" | "amber" | "red" | "idle";
export type SetupCheck = { id: string; title: string; state: CheckState; text: string; action?: string; actionLabel?: string; actionRoute?: "settings" | "setup"; item?: { code: string; severity: "critical" | "error" | "warning"; title: string; text: string; since: string; cause: string; fix?: { label: string; action: "retry_download" | "reinstall_engine" } } };
export type CheckDeps = {
  hardware?: () => Promise<Record<string, unknown>>;
  catalog?: () => Promise<Record<string, unknown>>;
  startDownloads?: () => Promise<void>;
  health?: () => Promise<{ ok: boolean }>;
  localHardware?: () => { platform: string; arch: string; totalMemory: number };
  modelDisk?: () => Promise<{ status: "green" | "amber" | "red"; message?: string; fix?: string }>;
  hubDisk?: () => Promise<{ status: "green" | "amber" | "red"; message?: string; fix?: string }>;
  nvidia?: NvidiaSysmemFallbackReader;
  hostReach?: (host: string) => Promise<boolean>;
  clockOffsetMs?: () => Promise<number | null>;
  homeNetwork?: () => Promise<boolean>;
  now?: () => Date;
  tailscale?: () => Promise<Awaited<ReturnType<typeof getTailscaleStatus>>>;
  tailnetAllowed?: () => boolean;
  engineHost?: () => string;
  link?: () => { state: string; reason?: string | null; slow?: boolean } | null;
  searchCandidates?: () => Promise<Array<{ url: string; status: "pass" | "fail" }>>;
  candidatesOut?: Array<{ url: string; status: "pass" | "fail" }>;
  stackSearchState?: () => "installing" | "ready" | "absent";
  configuredSearchStatus?: () => Promise<"pass" | "fail">;
};

async function searchRows(deps: CheckDeps, now: Date): Promise<SetupCheck[]> {
  const configured = getHouseholdSettingValue("search.searxng_url");
  if (typeof configured === "string" && configured.trim()) {
    const status = deps.configuredSearchStatus ? null : await checkSearchInstance({ updateRepairs: false });
    const passing = deps.configuredSearchStatus ? await deps.configuredSearchStatus() === "pass" : Boolean(status?.checks.length && status.checks.every((check) => check.state === "pass"));
    return [makeRow("web-search", "Web search", passing ? "green" : "amber", passing ? "Web search is ready." : status?.checks.find((check) => check.state !== "pass")?.fix ?? "Web search isn't ready yet. Home can continue without it.", "The configured SearXNG check.", undefined, now)];
  }
  const stackState = deps.stackSearchState?.() ?? (isStackConfigured() ? "absent" : "ready");
  if (stackState === "installing") return [makeRow("web-search", "Web search", "amber", "Web search is still installing...", "The Stack reports its search service installing.", undefined, now)];
  if (stackState === "absent") return [makeRow("web-search", "Web search", "amber", "Web search isn't ready yet. Home can continue without it.", "The Stack has no ready search service.", undefined, now)];
  const candidates: Array<{ url: string; status: "pass" | "fail" }> = await (deps.searchCandidates ? deps.searchCandidates() : (async () => {
    const found: Array<{ url: string; status: "pass" | "fail" }> = [];
    for (const port of [8888, 8080]) {
      const url = `http://127.0.0.1:${port}`;
      try {
        const response = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1_000), redirect: "manual" });
        if (response.status !== 200 || (await response.text()).trim().toUpperCase() !== "OK") continue;
        const status = await checkSearchInstance({ candidateBaseUrl: url });
        const isSearxng = status.version !== null && status.checks.some((check) => check.id === "json-format") && status.checks.some((check) => check.id === "web-engines");
        if (isSearxng) found.push({ url, status: status.checks.length && status.checks.every((check) => check.state === "pass") ? "pass" : "fail" });
      } catch { /* closed port or non-SearXNG */ }
    }
    return found;
  })());
  if (deps.candidatesOut) deps.candidatesOut.push(...candidates);
  return [makeRow("web-search", "Web search", "amber", candidates.some((item) => item.status === "pass") ? "Found a SearXNG on this computer. You can choose it in the plan." : "Web search isn't ready yet. Home can continue without it.", "No configured search address; any loopback instance is only offered.", undefined, now)];
}

function tcp(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port: 443 });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
    socket.setTimeout(2_000, () => { socket.destroy(); resolve(false); });
  });
}

const localFacts = () => ({ platform: process.platform, arch: process.arch, totalMemory: totalmem() });
function makeRow(id: string, title: string, state: CheckState, text: string, cause = text, fix?: string, now = new Date()): SetupCheck {
  const severity = state === "red" ? "error" : state === "amber" ? "warning" : null;
  return { id, title, state, text, ...(severity ? { item: { code: `setup.${id}`, severity, title, text, since: now.toISOString(), cause, ...(fix ? { fix: { label: fix, action: id === "engine" ? "reinstall_engine" as const : "retry_download" as const } } : {}) } } : {}) };
}

export async function runSetupChecks(deps: CheckDeps = {}): Promise<SetupCheck[]> {
  const now = (deps.now ?? (() => new Date()))();
  const remote = isRemoteStackSelected();
  const rows: SetupCheck[] = [];
  let hardware: Record<string, unknown> | null = null;
  const local = (deps.localHardware ?? localFacts)();
  let engineOk = false;
  try {
    if (remote) {
      const client = getStackClient();
      const [health, response] = await Promise.all([client.healthz(), client.hardware()]);
      engineOk = health.ok;
      hardware = response;
    } else {
      const health = await (deps.health ?? (async () => { const result = await getStackClient().healthz(); return { ok: result.ok }; }))();
      engineOk = health.ok;
      const response = await (deps.hardware ?? (() => getStackClient().hardware()))();
      hardware = response;
    }
  } catch { /* engine rows describe an unavailable Stack */ }
  rows.push(makeRow("engine", "Engine service", engineOk ? "green" : "red", engineOk ? "The Stack is answering." : "Home's AI engine isn't running. Install or start it, then try again.", "The Stack health endpoint did not answer.", "Repair", now));

  const hw = hardware && typeof hardware.hardware === "object" && hardware.hardware ? hardware.hardware as Record<string, unknown> : null;
  const proposed = hardware && typeof hardware.proposed === "object" && hardware.proposed ? hardware.proposed as Record<string, unknown> : null;
  const level = typeof proposed?.level === "string" ? proposed.level : null;
  const supported = isSupportedInstallPlatform(String(hw?.platform ?? local.platform), String(hw?.arch ?? local.arch));
  rows.push(makeRow("memory", "Memory and graphics", !engineOk || !supported || !level ? "red" : "green", !engineOk ? "The engine computer could not be checked." : !supported || !level ? "This computer is below the Minimal level MaiPai Home needs." : `This computer meets the ${level} level.`, !supported ? "The Stack platform is not supported." : level ? `The Stack proposed ${level}.` : "The Stack did not propose a supported level.", "Use a supported computer", now));
  rows.push(makeRow("system", "System", !engineOk || !supported ? "red" : "green", !supported ? "This system is not supported for MaiPai Home's AI." : `${String(hw?.platform ?? local.platform)} ${String(hw?.arch ?? local.arch)} is supported.`, "The Stack hardware platform and architecture are checked against installer support.", "Use a supported computer", now));

  let modelDisk: Awaited<ReturnType<NonNullable<CheckDeps["modelDisk"]>>> = { status: "red", message: "Choose a disk for AI models before continuing." };
  if (deps.modelDisk) modelDisk = await deps.modelDisk();
  else if (typeof hw?.freeDiskBytes === "number") {
    const enough = hw.freeDiskBytes >= minimum("models", { models: await selectedModelIds(deps) });
    modelDisk = { status: enough ? "green" : "red", message: enough ? "There is enough free space for the Minimal plan." : "There isn't room for the AI models on that disk.", fix: enough ? undefined : "Choose a disk with more free space." };
  }
  else if (!remote) modelDisk = await checkModelDisk(classDir("models"));
  rows.push(makeRow("model-disk", "Free disk for models", modelDisk.status, modelDisk.message ?? "There is enough free space for the AI models.", modelDisk.message ?? "The model disk meets placement requirements.", modelDisk.fix, now));

  const nvidiaResult = remote && !deps.nvidia ? { status: "idle" as const, message: "Checked by the engine computer when downloads start" } : await checkNvidiaSysmemFallback(deps.nvidia ?? { hasNvidiaGpu: async () => false, isSysmemFallbackEnabled: async () => false });
  rows.push(makeRow("graphics-driver", "Graphics driver", nvidiaResult.status === "idle" ? "idle" : nvidiaResult.status, nvidiaResult.message ?? (nvidiaResult.status === "idle" ? "Not checked on this computer." : "The NVIDIA driver is ready."), nvidiaResult.message ?? "NVIDIA fallback policy check.", undefined, now));

  let modelHost: string | null = null;
  try {
    const catalog = await (deps.catalog ?? (() => getStackClient().modelCatalog()))();
    const models = Array.isArray(catalog.models) ? catalog.models as Array<Record<string, unknown>> : [];
    const pin = models.find((model) => model.role === "chat" && model.component !== "projector" && typeof model.download === "object" && model.download !== null) ?? models.find((model) => typeof model.download === "object" && model.download !== null);
    const url = (pin?.download as Record<string, unknown> | undefined)?.url;
    if (typeof url === "string") modelHost = new URL(url).hostname;
  } catch { /* unavailable pins leave the optional reach row idle */ }
  if (!modelHost) rows.push(makeRow("download-host", "Download host", "idle", "Checked by the engine computer when downloads start", "The Stack's pinned download host could not be read.", undefined, now));
  else {
    const reachable = await (deps.hostReach ?? tcp)(modelHost);
    const preflight = await checkInstallPreflight({ releaseHost: modelHost, reachReleaseHost: async () => reachable });
    const release = preflight.find((row) => row.code.startsWith("install.release."));
    rows.push(makeRow("download-host", "Download host", release?.severity ? "red" : "green", release?.severity ? "Home can't reach the internet to download its AI models." : `The pinned model host ${modelHost} can be reached.`, release?.cause ?? `A plain TCP connection to ${modelHost}:443 succeeded.`, "Check the internet connection", now));
  }

  const setupState = getSetupState();
  const storageChoice = setupState.steps.find((step) => step.id === "storage");
  const recordedDestination = (setupState as unknown as { storage?: { destination?: string }; engine?: { hardware?: { modelDestination?: string } } }).storage?.destination ?? setupState.engine.hardware.modelDestination ?? (storageChoice as unknown as { destination?: string } | undefined)?.destination;
  const nonDefaultDestination = Boolean(recordedDestination);
  rows.push(makeRow("download-destination", "Model download destination", nonDefaultDestination ? "red" : "green", nonDefaultDestination ? "Home can't put the AI models there yet. Press Back and choose the default location." : "The AI models will use the default location.", nonDefaultDestination ? "The Stack does not install models at the selected non-default location." : "The Stack's default model location is selected.", nonDefaultDestination ? "Press Back and choose the default location." : undefined, now));

  let hubDisk = deps.hubDisk ? await deps.hubDisk() : await checkHubDisk();
  rows.push(makeRow("hub-disk", "Hub disk", hubDisk.status, hubDisk.message ?? "There is enough space for Home's data.", hubDisk.message ?? "The hub disk meets placement requirements.", hubDisk.fix, now));
  const offset = await (deps.clockOffsetMs ?? (async () => null))();
  rows.push(makeRow("clock", "Clock", offset === null ? "idle" : Math.abs(offset) > 120_000 ? "amber" : "green", offset === null ? "Checked by the engine computer when downloads start" : Math.abs(offset) > 120_000 ? `The engine computer's clock differs by ${Math.round(Math.abs(offset) / 60_000)} minutes.` : "The hub and engine clocks agree.", offset === null ? "No engine clock reading was available." : `Clock difference ${offset} ms.`, "Turn on automatic time", now));
  const reachableOnNetwork = await (deps.homeNetwork ?? (async () => true))();
  rows.push(makeRow("home-network", "Home network", reachableOnNetwork ? "green" : "amber", reachableOnNetwork ? "Home is available on your home network." : "Home answers only on this computer.", reachableOnNetwork ? "A local network address is available." : "No reachable LAN address was found.", "Allow Home through the firewall", now));

  const linkState = remote ? getEngineLinkState() : null;
  rows.push(makeRow("engine-link", "Engine link", !remote ? "idle" : linkState?.state === "ready" ? "green" : linkState?.state === "degraded" ? "amber" : "red", !remote ? "This computer runs Home's AI." : linkState?.state === "ready" ? "The engine link is ready." : linkState?.state === "degraded" ? "The engine link is slow." : "Home can't reach the computer that runs its AI.", linkState?.reason ?? "The selected engine link is not ready.", "Try again", now));
  if (remote) {
    const host = (deps.engineHost ?? (() => String(getHouseholdSettingValue(REMOTE_ENGINE_HOST_KEY) ?? "")))().trim().replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
    const tailscale = await (deps.tailscale ?? getTailscaleStatus)();
    const peer = tailscale.peers?.find((candidate) => candidate.ips.some((ip) => ip.toLowerCase() === host) || candidate.dnsName?.toLowerCase() === host || candidate.hostName?.toLowerCase() === host);
    const allowed = (deps.tailnetAllowed ?? (() => getHouseholdSettingValue(REMOTE_ALLOW_TAILNET_KEY) === true))();
    const tailnetHost = peer !== undefined || /\.ts\.net$/.test(host) || /^100\.(?:[6-9]\d|1[01]\d|12[0-7])\./.test(host) || host.startsWith("fd7a:115c:a1e0:");
    if (tailnetHost && !allowed) {
      const ownerExists = Boolean(db.select({ id: people.id }).from(people).limit(1).get());
      rows.push({ ...makeRow("tailnet-allow", "Tailscale access", "amber", "This computer reaches Home's AI through your Tailscale network. Allow that?", "This computer reaches Home's AI through your Tailscale network. Allow that?", undefined, now), action: "allow_tailnet", actionLabel: "Allow", actionRoute: ownerExists ? "settings" : "setup" });
    }
    if (tailnetHost) {
      const online = Boolean(peer?.online);
      rows.push(makeRow("tailnet-peer", "Engine computer on Tailscale", online ? "green" : "amber", online ? "The computer running Home's AI is on your Tailscale network." : "The computer that runs Home's AI isn't on your Tailscale network right now. Open Tailscale on it and sign in with the same account, then press Try again.", online ? "Tailscale lists the engine computer as an online peer." : "No matching online peer was found in Tailscale status.", undefined, now));
      if (online) rows.push(makeRow("tailnet-route", "Tailscale connection", peer?.path === "relay" ? "amber" : "green", peer?.path === "relay" ? "Home reaches its AI through a Tailscale relay, so answers may be slower. This usually fixes itself; if it doesn't, see Tailscale's help on direct connections." : "Home reaches its AI directly over Tailscale.", peer?.path === "relay" ? "Tailscale status reports a DERP relay." : "Tailscale status reports a direct endpoint.", undefined, now));
      const link = (deps.link ?? (() => getEngineLink()?.snapshot() ?? null))();
      if (link) rows.push(makeRow("tailnet-latency", "Engine connection speed", link.state === "ready" || (link.state === "degraded" && !link.slow) ? "green" : link.state === "degraded" && link.slow ? "amber" : "idle", link.state === "degraded" && link.slow ? "Answers may be slow because the connection to the computer running Home's AI is slow." : "The engine link's connection speed is ready.", link.state === "degraded" && !link.slow ? "The engine link is degraded for another reason; its latency is not slow." : "The engine link's own six-probe median is at or below 500 ms.", undefined, now));
    }
  }
  rows.push(makeRow("camera", "Camera and microphone", "idle", "Checked when you set up your face.", "Camera and microphone permissions are requested only during face setup.", undefined, now));
  rows.push(...await searchRows(deps, now));
  return rows;
}

async function selectedModelIds(deps: CheckDeps): Promise<string[]> {
  try {
    const catalog = await (deps.catalog ?? (() => getStackClient().modelCatalog()))();
    const models = Array.isArray(catalog.models) ? catalog.models as Array<Record<string, unknown>> : [];
    return models.filter((model) => typeof model.id === "string").map((model) => String(model.id));
  } catch { return []; }
}

export function healthItems(rows: readonly SetupCheck[]) {
  return rows.flatMap((row) => row.item ? [row.item] : []);
}
