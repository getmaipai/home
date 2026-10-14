import { totalmem } from "node:os";
import { createConnection } from "node:net";
import { checkInstallPreflight, isSupportedInstallPlatform } from "@/lib/installPreflight";
import { getStackClient, isRemoteStackSelected } from "@/lib/stackEngine";
import { getEngineLinkState } from "@/lib/stack/link";
import { classDir } from "@/lib/paths";
import { checkModelDisk, checkHubDisk } from "./placementDiskChecks";
import { checkNvidiaSysmemFallback, type NvidiaSysmemFallbackReader } from "./nvidiaSysmemFallback";

export type CheckState = "green" | "amber" | "red" | "idle";
export type SetupCheck = { id: string; title: string; state: CheckState; text: string; item?: { code: string; severity: "critical" | "error" | "warning"; title: string; text: string; since: string; cause: string; fix?: { label: string; action: "retry_download" | "reinstall_engine" } } };
export type CheckDeps = {
  hardware?: () => Promise<Record<string, unknown>>;
  health?: () => Promise<{ ok: boolean }>;
  localHardware?: () => { platform: string; arch: string; totalMemory: number };
  modelDisk?: () => Promise<{ status: "green" | "amber" | "red"; message?: string; fix?: string }>;
  hubDisk?: () => Promise<{ status: "green" | "amber" | "red"; message?: string; fix?: string }>;
  nvidia?: NvidiaSysmemFallbackReader;
  hostReach?: (host: string) => Promise<boolean>;
  clockOffsetMs?: () => Promise<number | null>;
  homeNetwork?: () => Promise<boolean>;
  now?: () => Date;
};

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
  else if (!remote) modelDisk = await checkModelDisk(classDir("models"));
  else if (typeof hw?.freeDiskBytes === "number") {
    // The Stack's free disk reading is compared against placement's own model threshold by running the same check only for local storage.
    modelDisk = { status: hw.freeDiskBytes >= 20_000_000_000 ? "green" : "red", message: hw.freeDiskBytes >= 20_000_000_000 ? "There is enough free space for the Minimal plan." : "There isn't room for the AI models on that disk." };
  }
  rows.push(makeRow("model-disk", "Free disk for models", modelDisk.status, modelDisk.message ?? "There is enough free space for the AI models.", modelDisk.message ?? "The model disk meets placement requirements.", modelDisk.fix, now));

  const nvidiaResult = await checkNvidiaSysmemFallback(deps.nvidia ?? { hasNvidiaGpu: async () => false, isSysmemFallbackEnabled: async () => false });
  rows.push(makeRow("graphics-driver", "Graphics driver", nvidiaResult.status === "idle" ? "idle" : nvidiaResult.status, nvidiaResult.message ?? (nvidiaResult.status === "idle" ? "Not checked on this computer." : "The NVIDIA driver is ready."), nvidiaResult.message ?? "NVIDIA fallback policy check.", undefined, now));

  const modelHost = remote ? null : "huggingface.co";
  if (!modelHost) rows.push(makeRow("download-host", "Download host", "idle", "Checked by the engine computer when downloads start", "The engine is remote; Stack reach probing is not available yet.", undefined, now));
  else {
    const reachable = await (deps.hostReach ?? tcp)(modelHost);
    const preflight = await checkInstallPreflight({ releaseHost: modelHost, reachReleaseHost: async () => reachable });
    const release = preflight.find((row) => row.code.startsWith("install.release."));
    rows.push(makeRow("download-host", "Download host", release?.severity ? "red" : "green", release?.severity ? "Home can't reach the internet to download its AI models." : `The pinned model host ${modelHost} can be reached.`, release?.cause ?? `A plain TCP connection to ${modelHost}:443 succeeded.`, "Check the internet connection", now));
  }

  // A passing hardware list is not enough to authorize downloads until
  // screen 3 has persisted the selected model destination into the Stack.
  // That storage adapter is not present on this setup API yet.
  rows.push(makeRow("download-destination", "Model download destination", "red", "Home couldn't confirm where the AI models should be stored. Go back and choose a disk.", "The setup storage selection is not available through the persisted Stack settings yet.", "Choose a disk", now));

  let hubDisk = deps.hubDisk ? await deps.hubDisk() : await checkHubDisk();
  rows.push(makeRow("hub-disk", "Hub disk", hubDisk.status, hubDisk.message ?? "There is enough space for Home's data.", hubDisk.message ?? "The hub disk meets placement requirements.", hubDisk.fix, now));
  const offset = await (deps.clockOffsetMs ?? (async () => null))();
  rows.push(makeRow("clock", "Clock", offset === null ? "amber" : Math.abs(offset) > 120_000 ? "amber" : "green", offset === null ? "Home could not compare the engine computer's clock." : Math.abs(offset) > 120_000 ? `The engine computer's clock differs by ${Math.round(Math.abs(offset) / 60_000)} minutes.` : "The hub and engine clocks agree.", offset === null ? "No engine clock reading was available." : `Clock difference ${offset} ms.`, "Turn on automatic time", now));
  const reachableOnNetwork = await (deps.homeNetwork ?? (async () => true))();
  rows.push(makeRow("home-network", "Home network", reachableOnNetwork ? "green" : "amber", reachableOnNetwork ? "Home is available on your home network." : "Home answers only on this computer.", reachableOnNetwork ? "A local network address is available." : "No reachable LAN address was found.", "Allow Home through the firewall", now));

  const linkState = remote ? getEngineLinkState() : null;
  rows.push(makeRow("engine-link", "Engine link", !remote ? "idle" : linkState?.state === "ready" ? "green" : linkState?.state === "degraded" ? "amber" : "red", !remote ? "This computer runs Home's AI." : linkState?.state === "ready" ? "The engine link is ready." : linkState?.state === "degraded" ? "The engine link is slow." : "Home can't reach the computer that runs its AI.", linkState?.reason ?? "The selected engine link is not ready.", "Try again", now));
  rows.push(makeRow("camera", "Camera and microphone", "idle", "Checked when you set up your face.", "Camera and microphone permissions are requested only during face setup.", undefined, now));
  return rows;
}

export function healthItems(rows: readonly SetupCheck[]) {
  return rows.flatMap((row) => row.item ? [row.item] : []);
}
