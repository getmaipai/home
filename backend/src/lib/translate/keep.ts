import nlp from "compromise";
import keepData from "./keep.json";
import type { Completer, Kind } from "./core";

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export function loadKeepTerms(kind: Kind, extra: string[] = []): string[] {
  const fixed = kind === "ui" || kind === "doc" ? [...keepData.terms, ...keepData.names] : [];
  return unique([...fixed, ...extra]);
}

function escapeRe(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function findKeepSpans(text: string, terms: string[], opts: { acronyms: boolean }): string[] {
  const spans: string[] = [];
  const addMatches = (re: RegExp): void => { for (const m of text.matchAll(re)) if (m[0]) spans.push(m[0]); };
  for (const term of terms) {
    if (!term) continue;
    const sensitive = /[A-Z]/.test(term) && /[a-z]/.test(term);
    addMatches(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, sensitive ? "gu" : "giu"));
  }
  const doc = nlp(text);
  for (const value of doc.urls().out("array") as string[]) if (value) spans.push(value);
  for (const value of doc.emails().out("array") as string[]) if (value) spans.push(value);
  addMatches(/https?:\/\/\S+/giu);
  addMatches(/\S+@\S+\.\S+/gu);
  addMatches(/(?<![\w/])(?:(?:\.{1,2}|~)\/(?:[\w.-]+\/)*[\w.-]+|(?:[\w.-]+\/)+[\w-]+\.\w{1,5})/gu);
  addMatches(/`+[^`\n]*`+/gu);
  addMatches(/\{[^{}]+\}/gu);
  if (opts.acronyms) {
    for (const value of doc.acronyms().out("array") as string[]) if (value && /^[A-Z]{2,6}$/.test(value)) spans.push(value);
    addMatches(/\b[A-Z]{2,6}\b/g);
  }
  return [...new Set(spans)];
}

export function maskKept(text: string, spans: string[]): { masked: string; restore: (out: string) => string | null } {
  const sorted = unique(spans).filter((span) => text.includes(span));
  const markers = new Map<string, string>();
  let masked = text;
  sorted.forEach((span, i) => {
    const marker = `⟦K${i + 1}⟧`;
    markers.set(marker, span);
    masked = masked.split(span).join(marker);
  });
  return { masked, restore: (out: string): string | null => {
    for (const marker of markers.keys()) {
      const escaped = escapeRe(marker);
      const matches = out.match(new RegExp(escaped, "g")) ?? [];
      const preserved = markers.get(marker)!;
      if (matches.length !== 0 && matches.length !== 1) return null;
      if (matches.length === 0 && out.split(preserved).length - 1 !== 1) return null;
    }
    let restored = out;
    for (const [marker, span] of markers) restored = restored.includes(marker) ? restored.split(marker).join(span) : restored;
    return restored;
  } };
}

export async function spotKeepTerms(items: string[], completer: Completer, from: string): Promise<string[]> {
  try {
    const response = await completer([
      { role: "system", content: "List names, brands, product words, technical terms and acronyms in these texts that must stay in their original form when translated. Return only a JSON array of strings. Do not translate anything." },
      { role: "user", content: JSON.stringify({ from, items }) },
    ]);
    if (!response.ok) return [];
    const value: unknown = JSON.parse(response.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    if (!Array.isArray(value)) return [];
    return unique(value.filter((term): term is string => typeof term === "string" && term.length >= 2 && term.length <= 60 && items.some((item) => item.includes(term))));
  } catch { return []; }
}
