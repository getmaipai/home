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
  const markers = new Map<string, { span: string; count: number }>();
  let masked = text;
  // Longest first; a span already swallowed by a longer one (Library inside [Library](library.md)) gets no marker of its own.
  for (const span of unique(spans)) {
    const count = masked.split(span).length - 1;
    if (count === 0) continue;
    const marker = `\u27E6K${markers.size + 1}\u27E7`;
    markers.set(marker, { span, count });
    masked = masked.split(span).join(marker);
  }
  return { masked, restore: (out: string): string | null => {
    let restored = out;
    for (const [marker, { span, count }] of markers) {
      const found = out.split(marker).length - 1;
      // A marker must come back exactly as often as it went in; a model that wrote the term itself must have written it as often too.
      if (found === 0) { if (out.split(span).length - 1 !== count) return null; continue; }
      if (found !== count) return null;
      restored = restored.split(marker).join(span);
    }
    return restored;
  } };
}

export async function spotKeepTerms(items: string[], completer: Completer, from: string): Promise<string[]> {
  try {
    const response = await completer([
      { role: "system", content: "List only proper names, brand and product names (for example MaiPai or Wi-Fi), acronyms, and technical terms people keep in English in every language. Do NOT list button, menu, tab or page labels, headings, bold text or ordinary words, even when they are capitalized. Return only a JSON array of strings. Do not translate anything." },
      { role: "user", content: JSON.stringify({ from, items }) },
    ]);
    if (!response.ok) return [];
    const value: unknown = JSON.parse(response.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    if (!Array.isArray(value)) return [];
    return unique(value.filter((term): term is string => typeof term === "string" && term.length >= 2 && term.length <= 60 && items.some((item) => item.includes(term))));
  } catch { return []; }
}
