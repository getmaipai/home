import type { MixSignal } from "./rankStories";
export interface MixActivity { topics: string[]; source: string; at: string; finished: boolean; saved: boolean; feedback: "more" | "less" | null }
/** Add the person's own signals, decay by 30-day half-life, then normalize across channel kinds. */
export function computeAffinity(activity: MixActivity[], now: Date): MixSignal {
  const signal: MixSignal = { topics: new Map(), sources: new Map(), lessTopics: new Set(), lessSources: new Set() };
  for (const row of activity) {
    const days = Math.max(0, (now.getTime() - Date.parse(row.at)) / 86400000);
    if (!Number.isFinite(days)) continue;
    const weight = (1 + (row.finished ? 2 : 0) + (row.saved ? 3 : 0) + (row.feedback === "more" ? 3 : row.feedback === "less" ? -3 : 0)) * 2 ** (-days / 30);
    for (const topic of new Set(row.topics)) {
      signal.topics.set(topic, (signal.topics.get(topic) ?? 0) + weight);
      if (row.feedback === "less" && days < 30) signal.lessTopics.add(topic);
    }
    signal.sources.set(row.source, (signal.sources.get(row.source) ?? 0) + weight);
    if (row.feedback === "less" && days < 30) signal.lessSources.add(row.source);
  }
  const maximum = Math.max(1, ...signal.topics.values(), ...signal.sources.values());
  for (const scores of [signal.topics, signal.sources]) for (const [key, score] of scores) scores.set(key, Math.max(0, score) / maximum);
  return signal;
}
