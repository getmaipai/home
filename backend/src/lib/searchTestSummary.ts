import { z } from "zod";
import { engineLabel, SEARCH_CATALOG, type SearchCheck, type SearchInstanceStatus } from "@/lib/searchInstanceCheck";

/** The plain-words result of testing one SearXNG address. Shared by the setup Web search screen and the settings page. */
export type SearchTestLevel = "pass" | "warn" | "fail";
export type SearchTestSummary = {
  level: SearchTestLevel;
  /** host:port of the tested search service, so it is clear which one this is about. */
  address: string;
  headline: string;
  /** One line on what the test found. */
  verdict: string;
  /** What to do next, in plain words, starting with "Recommended:". */
  recommendation: string;
  /** True when the service can be saved and used as it is. */
  canUse: boolean;
  /** Engines answering badly right now, by friendly name; important ones carry web results. */
  trouble: { label: string; important: boolean }[];
  /** The check rows, for a Details disclosure. */
  details: Pick<SearchCheck, "id" | "title" | "state" | "detail" | "fix">[];
};

// An unknown result on these means the test could not tell whether the service is usable, so it never counts as usable.
const MUST_KNOW = new Set(["reachability", "json-format", "web-engines", "safe-search"]);

function hostOf(address: string): string {
  try { return new URL(address).host; } catch { return address; }
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function summarizeSearchStatus(status: SearchInstanceStatus, address: string): SearchTestSummary {
  const host = hostOf(address);
  const details = status.checks.map(({ id, title, state, detail, fix }) => ({ id, title, state, detail, fix }));
  const blocking = status.checks.find((check) => check.state === "fail" || (check.state === "unknown" && MUST_KNOW.has(check.id)));
  const important = new Set((SEARCH_CATALOG.groups.find((group) => group.id === "general")?.engines ?? []).map((engine) => engine.name));
  const trouble = status.engineErrors.filter((entry) => entry.percentage >= 50).map((entry) => ({ label: engineLabel(entry.name), important: important.has(entry.name) }));
  const base = { address: host, trouble, details };

  if (!status.checks.length || blocking) {
    const reach = status.checks.find((check) => check.id === "reachability");
    if (!status.checks.length || reach?.state === "fail") {
      return { ...base, level: "fail", canUse: false, headline: `Home could not reach ${host}.`, verdict: "Nothing answered at that address.", recommendation: "Recommended: check the address and that SearXNG is running, then press Test again." };
    }
    const unknown = blocking?.state === "unknown";
    return {
      ...base, level: "fail", canUse: false,
      headline: `${host} is not ready to use.`,
      verdict: blocking?.detail ?? "The test did not finish.",
      recommendation: unknown ? "Recommended: wait a few seconds and press Test again." : `Recommended: ${(blocking?.fix ?? "fix that in SearXNG").replace(/\.$/, "")}, then press Test again.`,
    };
  }

  const engineCount = new Set(status.groups.flatMap((group) => group.enabledEngines)).size;
  const warn = status.checks.filter((check) => check.state === "warn");
  const on = engineCount > 0 ? `${engineCount} search engine${engineCount === 1 ? " is" : "s are"} turned on.` : "";
  if (warn.length === 0) {
    return { ...base, level: "pass", canUse: true, headline: `${host} works. ${on}`.trim(), verdict: "Every check passed.", recommendation: "Recommended: use it." };
  }
  const first = warn.find((check) => check.id === "engine-errors") ?? warn[0]!;
  const names = trouble.map((entry) => entry.label);
  if (first.id === "engine-errors" && names.length) {
    const verb = names.length === 1 ? "is" : "are";
    return {
      ...base, level: "warn", canUse: true,
      headline: `${host} works, with a warning.`,
      verdict: `${joinNames(names)} ${verb} not answering right now.${trouble.some((entry) => entry.important) ? " Results may be thinner." : ""}`,
      recommendation: "Recommended: use it anyway, or turn those engines off in SearXNG's settings under Preferences, Engines, then Test again.",
    };
  }
  return {
    ...base, level: "warn", canUse: true,
    headline: `${host} works, with a warning.`,
    verdict: first.detail,
    recommendation: first.fix ? `Recommended: use it anyway, or ${first.fix.charAt(0).toLowerCase()}${first.fix.slice(1).replace(/\.$/, "")}, then Test again.` : "Recommended: use it anyway.",
  };
}

export const SearchTestSummarySchema = z.object({
  level: z.enum(["pass", "warn", "fail"]),
  address: z.string(),
  headline: z.string(),
  verdict: z.string(),
  recommendation: z.string(),
  canUse: z.boolean(),
  trouble: z.array(z.object({ label: z.string(), important: z.boolean() })),
  details: z.array(z.object({ id: z.string(), title: z.string(), state: z.enum(["pass", "warn", "fail", "unknown"]), detail: z.string(), fix: z.string().nullable() })),
});
