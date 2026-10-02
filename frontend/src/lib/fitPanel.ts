import type { StackFitPlan } from "@maipai/spec/gen/ts/stack-fit-plan.js";
import { formatFileGiB } from "../../../shared/fitGiB";

export type FitPanelRow = { label: string; value: string; source?: "measured" | "dry-run" | "estimated" | "unknown"; asOf?: string };

export function fitBadgeWord(verdict: StackFitPlan["verdict"]): string {
  return { yes: "Good fit", slow: "Slow here", no: "Too big", unknown: "Not tested yet" }[verdict];
}

function formatSourceDate(asOf: string | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOf ?? "");
  if (!match) return null;
  const [, year, month, day] = match;
  const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month) - 1];
  if (!monthName || Number(day) < 1 || Number(day) > 31) return null;
  return `${Number(day)} ${monthName} ${year}`;
}

export function fitSourceSentence(source: NonNullable<FitPanelRow["source"]>, asOf?: string): string {
  switch (source) {
    case "measured": {
      const date = formatSourceDate(asOf);
      return date ? `Tested on this computer on ${date}.` : "Tested on this computer.";
    }
    case "dry-run": {
      const date = formatSourceDate(asOf);
      return date ? `Checked on this computer without a full run, ${date}.` : "Checked on this computer without a full run.";
    }
    case "estimated": return "An estimate. Not yet tested on a computer like this one.";
    case "unknown": return "Not known yet.";
  }
}

export const roleNames: Record<StackFitPlan["roles"][number]["role"], string> = {
  chat: "Chat", router: "Routing", embed: "Search", rerank: "Ranking", vision: "Vision", image: "Pictures", video: "Video", music: "Music", coding: "Coding", judge: "Safety checks", tts: "Speaking", stt: "Listening", wakeword: "Wake word", "turn-signal": "Turn signal",
};
export const homeOwnedRoleNames: Record<"chat" | "embeddings" | "stt" | "tts", string> = {
  chat: "chat", embeddings: "search", stt: "listening", tts: "speaking",
};

export function describeHomeOwnedRoles(roles: Array<keyof typeof homeOwnedRoleNames>): string {
  const names = roles.map((role) => homeOwnedRoleNames[role]);
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
const pathNames: Record<StackFitPlan["paths"][number]["path"], string> = {
  unified: "In the computer's shared memory", gpu: "On the graphics card", "multi-gpu": "Across the graphics cards", "cpu-offload": "Partly on the processor (slower)", cpu: "On the processor only (slow)",
};
const bottleneckNames: Record<StackFitPlan["bottleneck"], string> = { memory: "Memory", disk: "Storage", context: "Conversation length", unknown: "Not known yet" };
const gib = 1024 ** 3;
const roundUpTenth = (bytes: number) => Math.ceil(bytes / gib * 10) / 10;
const wholeGb = (bytes: number) => Math.ceil(bytes / gib);

function range(low: number | null, high: number | null): string {
  if (low === null || high === null) return "Not measured yet";
  const a = roundUpTenth(low);
  const b = roundUpTenth(high);
  return a === b ? `about ${a} GB` : `about ${a} to ${b} GB`;
}

export function describeFitPlan(plan: StackFitPlan): { rows: FitPanelRow[]; remedy: string | null } {
  const rows: FitPanelRow[] = [
    ...(typeof plan.model_file_bytes === "number" ? [{ label: "Model file", value: `about ${formatFileGiB(plan.model_file_bytes)} GB` }] : []),
    { label: "Memory it needs", value: range(plan.total.low, plan.total.high), source: plan.total.source, asOf: plan.total.as_of },
    { label: "Memory it can use", value: plan.cap.high === null ? "Not measured yet" : `about ${wholeGb(plan.cap.high)} GB`, source: plan.cap.source, asOf: plan.cap.as_of },
    { label: "What limits it", value: bottleneckNames[plan.bottleneck] },
    { label: "How it would run", value: plan.verdict === "no" ? "It does not fit here" : plan.verdict === "unknown" ? "Not known yet" : pathNames[plan.paths.find((p) => p.verdict === "yes" || p.verdict === "slow")?.path ?? "cpu"] },
    ...plan.roles.map((role) => ({ label: roleNames[role.role], value: range(role.peak.low, role.peak.high), source: role.peak.source, asOf: role.peak.as_of })),
  ];
  let remedy: string | null = null;
  if (plan.verdict === "slow") remedy = "A smaller version of this model would run faster.";
  if (plan.verdict === "no") {
    const shortfall = Math.max(0, ...plan.paths.flatMap((path) => path.shortfall?.high === null || path.shortfall === undefined ? [] : [path.shortfall.high]));
    remedy = shortfall > 0 ? `It needs about ${wholeGb(shortfall)} GB more memory. A smaller version of this model, or a shorter conversation memory, would help.` : "A smaller version of this model, or a shorter conversation memory, would help.";
  }
  return { rows, remedy };
}
