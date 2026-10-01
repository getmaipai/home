import type { BudgetResponse } from "@/lib/stack/types";
import type { StackRole } from "@/lib/stackEngine";

const gib = 1024 ** 3;
const roleNames: Record<string, string> = {
  chat: "Chat", router: "Routing", embed: "Search", rerank: "Ranking", vision: "Vision", image: "Pictures", video: "Video", music: "Music", coding: "Coding", judge: "Safety checks", tts: "Speaking", stt: "Listening", wakeword: "Wake word", "turn-signal": "Turn signal",
};

/** The backend counterpart of frontend/src/lib/fitPanel.ts's roleNames. */
export function describeComputerMemory(budget: BudgetResponse, homeOwnedRoles: StackRole[] = []): {
  usableGb: number;
  usedGb: number;
  freeGb: number;
  pressure: "normal" | "warn" | "critical";
  pressureText: string;
  loaded: Array<{ id: string; label: string; gb: number }>;
  homeOwnedRoles: StackRole[];
} {
  const round = (bytes: number) => Math.round(bytes / gib * 10) / 10;
  const used = budget.loaded.reduce((sum, item) => sum + item.peakBytes, 0);
  return {
    usableGb: round(budget.capBytes),
    usedGb: round(used),
    freeGb: round(Math.max(0, budget.capBytes - used)),
    pressure: budget.pressure,
    pressureText: { normal: "This computer has plenty of free memory right now.", warn: "This computer's memory is getting tight right now.", critical: "This computer's memory is very tight right now." }[budget.pressure],
    loaded: budget.loaded.map(({ id, peakBytes }) => ({ id, label: roleNames[id] ?? id, gb: round(peakBytes) })),
    homeOwnedRoles,
  };
}
