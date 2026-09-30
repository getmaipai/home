import type { BudgetResponse } from "@/lib/stack/types";

const gib = 1024 ** 3;
const roleNames: Record<string, string> = {
  chat: "Chat", router: "Routing", embed: "Search", rerank: "Ranking", vision: "Vision", image: "Pictures", video: "Video", music: "Music", coding: "Coding", judge: "Safety checks", tts: "Speaking", stt: "Listening", wakeword: "Wake word", "turn-signal": "Turn signal",
};

/** The backend counterpart of frontend/src/lib/fitPanel.ts's roleNames. */
export function describeComputerMemory(budget: BudgetResponse): {
  usableGb: number;
  usedGb: number;
  freeGb: number;
  pressure: "normal" | "warn" | "critical";
  pressureText: string;
  loaded: Array<{ id: string; label: string; gb: number }>;
} {
  const round = (bytes: number) => Math.round(bytes / gib * 10) / 10;
  const used = budget.loaded.reduce((sum, item) => sum + item.peakBytes, 0);
  return {
    usableGb: round(budget.capBytes),
    usedGb: round(used),
    freeGb: round(Math.max(0, budget.capBytes - used)),
    pressure: budget.pressure,
    pressureText: { normal: "Plenty of room right now.", warn: "Memory is getting tight.", critical: "Memory is very tight." }[budget.pressure],
    loaded: budget.loaded.map(({ id, peakBytes }) => ({ id, label: roleNames[id] ?? id, gb: round(peakBytes) })),
  };
}
