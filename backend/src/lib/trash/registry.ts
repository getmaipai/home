import type { PersonRow } from "@/types";

export interface TrashRow {
  kind: string;
  id: string;
  title: string;
  deleted_at: string;
  trash_until: string | null;
  can_restore: boolean;
  can_purge: boolean;
}
export interface TrashProvider {
  kind: string;
  label: string;
  list(person: PersonRow): TrashRow[];
  restore(person: PersonRow, id: string): boolean;
  purge(person: PersonRow, id: string): boolean;
  purgeExpired(now: Date): void;
}
const providers = new Map<string, TrashProvider>();
export function registerTrashProvider(provider: TrashProvider): void {
  providers.set(provider.kind, provider);
}
export function trashProvider(kind: string): TrashProvider | undefined {
  return providers.get(kind);
}
export function listTrash(person: PersonRow): TrashRow[] {
  if (person.role === "guest") return [];
  return [...providers.values()].flatMap((provider) => provider.list(person)).sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
}
/** A failed provider never prevents another kind from expiring. No record data is logged. */
export function purgeExpired(now = new Date()): void {
  for (const provider of providers.values()) {
    try { provider.purgeExpired(now); } catch { /* retry at the next sweep */ }
  }
}
