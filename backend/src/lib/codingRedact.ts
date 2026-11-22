// CODE-AGENT-01: credential redaction for what a Code session stores (transcript parts and audit lines). It reuses the household's one credential
// detector (lib/memoryContentPolicy.ts) and adds Home's own key shape (`maipai_<id>_<secret>`), so an agent that echoes a token never writes it to disk.
import { detectCredential } from "@/lib/memoryContentPolicy";

export const REDACTED = "[credential removed]";
const OWN_KEY = /\bmaipai_[A-Za-z0-9_]{16,}\b/g;

/** The text with every detected credential replaced, and how many were found (a count, never a value). */
export function redactCredentials(text: string): { text: string; found: number } {
  const spans = detectCredential(text).spans.map((s) => ({ ...s }));
  for (const m of text.matchAll(OWN_KEY)) spans.push({ start: m.index!, end: m.index! + m[0].length });
  if (spans.length === 0) return { text, found: 0 };
  spans.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end); else merged.push({ ...span });
  }
  let out = ""; let at = 0;
  for (const span of merged) { out += text.slice(at, span.start) + REDACTED; at = span.end; }
  return { text: out + text.slice(at), found: merged.length };
}

/** Redacts every string inside a value (parts and event details are plain JSON). Returns the clean copy and the count. */
export function redactDeep<T>(value: T): { value: T; found: number } {
  let found = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") { const r = redactCredentials(v); found += r.found; return r.text; }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value) as T, found };
}
