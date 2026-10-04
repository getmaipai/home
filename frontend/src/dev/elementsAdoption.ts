import raw from "@/dev/elements-adoption.json";

// UI-SHOWCASE: loader for the Elements adoption panel. The file is the
// cloud/elements-audit scanner's output once that lane lands (items[].file,
// name, group, verdict, implemented, optionally status); until then it is a
// stub of the kit's element file names, all unassessed. Tolerant on purpose:
// a missing field falls back instead of throwing, so the final shape can grow.
export type Verdict = "wire now" | "wire after" | "later" | "no fit" | "unassessed";
export type Status = "implemented" | "in progress" | "not yet" | "not for us";
export interface ElementItem { file: string; name: string; group: string; verdict: Verdict; status: Status }

const VERDICTS: Verdict[] = ["wire now", "wire after", "later", "no fit"];
const norm = (value: unknown) => String(value ?? "").toLowerCase().replace(/[-_]+/g, " ").trim();

export function normalizeAdoption(input: unknown): ElementItem[] {
  const list = Array.isArray(input) ? input : (input as { items?: unknown } | null)?.items;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry): ElementItem[] => {
    const e = entry as Record<string, unknown>;
    const file = String(e?.file ?? e?.name ?? "");
    if (!file) return [];
    const verdictText = norm(e.verdict);
    const verdict = VERDICTS.find((v) => v === verdictText) ?? "unassessed";
    const statusText = norm(e.status);
    const status: Status = e.implemented === true || statusText === "implemented" ? "implemented"
      : statusText === "in progress" ? "in progress"
      : verdict === "no fit" || statusText === "not for us" ? "not for us"
      : "not yet";
    const name = String(e.name ?? file.replace(/\..*$/, ""));
    return [{ file, name, group: String(e.group ?? name.split("-")[0] ?? "other"), verdict, status }];
  });
}

export const ELEMENTS: ElementItem[] = normalizeAdoption(raw);

// Elements whose behaviour a scenario already shows through the real chat.
// Only existing scenarios; an Element with none has no Play button.
export const SCENARIO_FOR_ELEMENT: Record<string, string> = {
  "reasoning": "reasoning", "reasoning.aui": "reasoning", "reasoning-panel": "reasoning",
  "sources": "search", "sources.aui": "search", "web-search": "search",
  "math-block": "math", "shiki-highlighter": "code", "data-table": "table",
  "tool-call": "failed-tool", "tool-error": "failed-tool", "error-state": "failure-engine-down",
  "guardrail-notice": "failure-safety", "image": "links", "thinking-indicator": "essay",
};
