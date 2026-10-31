import type { List as ListT } from "@maipai/spec/gen/ts/list.js";
import type { PersonRow } from "@/types";
import { db } from "@/db";
import { lists } from "@/db/schema";
import { isNull } from "drizzle-orm";
import { tokenize } from "@/lib/text";

type Resolution<T> = { ok: true; value: T } | { ok: false; reason: "none" | "ambiguous"; candidates: number };
const pronouns = new Set(["that", "those", "it", "this list", "them"]);
export function similarity(a: string, b: string): number {
  const left = tokenize(a), right = tokenize(b);
  if (!left.size || !right.size) return 0;
  let shared = 0; for (const word of left) if (right.has(word)) shared++;
  return shared / Math.max(left.size, right.size);
}
export function fuzzy<T>(rows: T[], words: string, label: (row: T) => string): Resolution<T> {
  const scored = rows.map((row) => ({ row, score: similarity(words, label(row)) })).filter((entry) => entry.score >= 0.5).sort((a,b) => b.score-a.score);
  if (!scored.length) return { ok: false, reason: "none", candidates: 0 };
  const best = scored[0]!.score;
  const winners = scored.filter((entry) => entry.score === best);
  return winners.length === 1 ? { ok: true, value: winners[0]!.row } : { ok: false, reason: "ambiguous", candidates: winners.length };
}
export type ListResolution = { ok: true; list: ListT } | { ok: false; reason: "none" | "ambiguous"; candidates: number };
export function resolveList(actor: Pick<PersonRow, "id" | "role">, words: string, options: { lastListId?: string } = {}): ListResolution {
  const available = db.select().from(lists).where(isNull(lists.deletedAt)).all().filter((row) => row.scope === "household" || row.person === actor.id).map((row) => ({
    id: row.id, scope: row.scope, person: row.person, kind: row.kind, title: row.title, icon: row.icon ?? undefined,
    items: JSON.parse(row.items), source: row.source, created_at: row.createdAt, updated_at: row.updatedAt, deleted_at: row.deletedAt, hlc: row.hlc,
  })) as ListT[];
  const exact = available.filter((list) => list.title.trim().toLowerCase() === words.trim().toLowerCase());
  if (exact.length === 1) return { ok: true, list: exact[0]! };
  if (exact.length > 1) return { ok: false, reason: "ambiguous", candidates: exact.length };
  if (pronouns.has(words.trim().toLowerCase()) && options.lastListId) {
    const last = available.find((list) => list.id === options.lastListId);
    if (last) return { ok: true, list: last };
  }
  const result = fuzzy(available, words, (list) => list.title);
  return result.ok ? { ok: true, list: result.value } : result;
}
export type ItemsResolution = { ok: true; items: ListT["items"] } | { ok: false; reason: "none" | "ambiguous"; candidates: number };
export function resolveItems(list: ListT, words: string, options: { lastItemIds?: string[] } = {}): ItemsResolution {
  const refreshed = db.select().from(lists).where(isNull(lists.deletedAt)).all().find((row) => row.id === list.id);
  const currentItems = refreshed ? JSON.parse(refreshed.items) as ListT["items"] : list.items;
  if (["those", "them"].includes(words.trim().toLowerCase()) && options.lastItemIds?.length) {
    const selected = currentItems.filter((item) => options.lastItemIds!.includes(item.id));
    if (selected.length) return { ok: true, items: selected };
  }
  const exact = currentItems.filter((item) => item.text.trim().toLowerCase() === words.trim().toLowerCase());
  if (exact.length === 1) return { ok: true, items: exact };
  if (exact.length > 1) return { ok: false, reason: "ambiguous", candidates: exact.length };
  const result = fuzzy(currentItems, words, (item) => item.text);
  return result.ok ? { ok: true, items: [result.value] } : result;
}
export function isListPronoun(words: string): boolean { return pronouns.has(words.trim().toLowerCase()); }
