import type { StackFitPlan } from "@maipai/spec/gen/ts/stack-fit-plan.js";

export type FitPanelRow = { label: string; value: string; source?: "measured" | "dry-run" | "estimated" | "unknown"; asOf?: string };

const roleNames: Record<StackFitPlan["roles"][number]["role"], string> = {
  chat: "Chat", router: "Routing", embed: "Search", rerank: "Ranking", vision: "Vision", image: "Pictures", video: "Video", music: "Music", coding: "Coding", judge: "Safety checks", tts: "Speaking", stt: "Listening", wakeword: "Wake word", "turn-signal": "Turn signal",
};
const pathNames: Record<StackFitPlan["paths"][number]["path"], string> = {
  unified: "In the computer's shared memory", gpu: "On the graphics card", "multi-gpu": "Across the graphics cards", "cpu-offload": "Partly on the processor (slower)", cpu: "On the processor only (slow)",
};
const bottleneckNames: Record<StackFitPlan["bottleneck"], string> = { memory: "Memory", disk: "Storage", context: "Conversation length", unknown: "Not known yet" };
const gib = 1024 ** 3;
const roundUpTenth = (bytes: number) => Math.ceil(bytes / gib * 10) / 10;
const wholeGb = (bytes: number) => Math.ceil(bytes / gib);

function range(low: number | null, high: number | null): string {
  if (low === null || high === null) return "Not known yet";
  const a = roundUpTenth(low);
  const b = roundUpTenth(high);
  return a === b ? `about ${a} GB` : `about ${a} to ${b} GB`;
}

export function describeFitPlan(plan: StackFitPlan): { rows: FitPanelRow[]; remedy: string | null } {
  const rows: FitPanelRow[] = [
    { label: "Memory it needs", value: range(plan.total.low, plan.total.high), source: plan.total.source, asOf: plan.total.as_of },
    { label: "Memory it can use", value: plan.cap.high === null ? "Not known yet" : `about ${wholeGb(plan.cap.high)} GB`, source: plan.cap.source, asOf: plan.cap.as_of },
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
