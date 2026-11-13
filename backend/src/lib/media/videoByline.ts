// VIDEOS-PARITY: the muted line under a video card, "Channel, 3 days ago" (PRO-LOOK-01 section 17). It is a `byline` field added to the Video app's
// rows after the shared host builds them, so no other app's rows change. Dates come from the household's own library only.
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems } from "@/db/schema";

/** "Today", "Yesterday", "3 days ago", "2 weeks ago", "5 months ago", "2 years ago". A bad date is "". */
export function ageLabel(iso: string | null | undefined, now = new Date()): string {
  const then = iso ? new Date(iso) : null;
  if (!then || Number.isNaN(then.getTime())) return "";
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) { const weeks = Math.floor(days / 7); return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`; }
  if (days < 365) { const months = Math.floor(days / 30); return months === 1 ? "1 month ago" : `${months} months ago`; }
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

function published(external: string | null, addedAt: string): string {
  try { const value = (JSON.parse(external ?? "null") as { published_at?: unknown } | null)?.published_at; if (typeof value === "string") return value; } catch { /* a bad row falls back to the added date */ }
  return addedAt;
}

/** Adds `byline` to every row of a list answer; any other answer is returned unchanged. */
export function withVideoByline<T>(answer: T, now = new Date()): T {
  if (!Array.isArray(answer) || answer.length === 0) return answer;
  const rows = answer as Array<Record<string, unknown>>;
  if (!rows.every((row) => row && typeof row === "object" && typeof row.id === "string" && "title" in row)) return answer;
  const ids = rows.map((row) => row.id as string);
  const dates = new Map<string, string>();
  for (const row of db.select({ id: mediaItems.id, external: mediaItems.external, addedAt: mediaItems.addedAt }).from(mediaItems).where(inArray(mediaItems.id, ids)).all()) dates.set(row.id, published(row.external, row.addedAt));
  return rows.map((row) => {
    const channel = typeof row.channel === "string" ? row.channel : "";
    const age = ageLabel(dates.get(row.id as string), now);
    return { ...row, byline: [channel, age].filter(Boolean).join(", ") };
  }) as T;
}
