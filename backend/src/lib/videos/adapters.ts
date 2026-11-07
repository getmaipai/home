// VIDEO-GEN-04, rebuilt by VIDEO-LORA-03 (docs/dev/loras.md): the household's video LoRAs as chat, Create and the job code see them. The ONE store is the `loras`
// table (lib/loras/store.ts, one spec `Lora` record each, kept in step with the Stack's files by lib/loras/sync.ts); the old `video_adapter_prefs` rows were
// folded into records there. Who may see or use a LoRA is `loraAccess` (lib/loras/access.ts), the single read path: `videoAdaptersFor` returns only what the
// person may use right now, so the model never gets an id it must not use, and `allVideoAdapters` (no filtering) is for internal lookups of a LoRA's own
// facts (never a route's answer).
import { loraAccess, loraUsable, type LoraSurface } from "@/lib/loras/access";
import { deleteLoraRecord, listLoraRecords, type Lora } from "@/lib/loras/store";
import { dropLoraSyncCache, syncLoras } from "@/lib/loras/sync";
import { videosAllowed, type VideoAudience } from "./policy";
import type { StackVideoLora } from "./stack";

export interface VideoAdapter extends StackVideoLora {
  /** An admin marked it usable beyond admins (`availability.who` is adults or people), and it is not in the trash. */
  enabled: boolean;
  /** Added but not yet confirmed by an admin: they have not read the fingerprint and licence yet. */
  needs_confirmation: boolean;
  /** The record this view was made from. */
  lora: Lora;
}

export function __resetVideoAdapterCacheForTests(): void { dropLoraSyncCache(); }
export function dropVideoAdapterCache(): void { dropLoraSyncCache(); }

export function adapterOfLora(lora: Lora): VideoAdapter {
  return {
    id: lora.id, name: lora.name, sha256: lora.file.sha256, bytes: lora.file.bytes, base_model: lora.base_model, licence: lora.licence.id ?? "unknown",
    source_url: lora.source.url, classification: lora.audience, strength_default: lora.strength.default, trigger_words: lora.trigger_words, added_at: lora.added_at,
    enabled: lora.removed_at === null && lora.availability.who !== "admins", needs_confirmation: lora.licence.acknowledged_by === null, lora,
  };
}

/** Every live video LoRA in the library, with no access filtering. Internal lookups only (a LoRA's own audience, hash, strength); a route never returns this. */
export async function allVideoAdapters(): Promise<VideoAdapter[]> {
  await syncLoras();
  return listLoraRecords().filter((l) => l.media === "video" && l.removed_at === null).sort((a, b) => a.added_at.localeCompare(b.added_at) || a.id.localeCompare(b.id)).map(adapterOfLora);
}

/** The surface an audience is on, for `loraAccess`: only a written chat screen of the person's own is "own_written". */
export function loraSurfaceOf(audience: VideoAudience): LoraSurface {
  if (audience.spoken) return "spoken";
  return audience.surfaceClass === "written" && audience.surface === "chat" ? "own_written" : "shared";
}

/**
 * The LoRAs this person may use now: allowed to make videos, `open` for them, live, base known. `includeLocked` also returns an adult-only one that is only
 * locked (the Adult lock is closed), for the chat tool and Another take: the person's own typed words can name it, and the caller answers with the lock tile
 * instead of starting anything. A hidden LoRA (a minor, not marked for this adult, a shared screen) is never returned either way.
 */
export async function videoAdaptersFor(audience: VideoAudience, opts: { includeLocked?: boolean } = {}): Promise<VideoAdapter[]> {
  if (!videosAllowed(audience)) return [];
  await syncLoras();
  const surface = loraSurfaceOf(audience);
  const wanted: Array<"open" | "locked"> = opts.includeLocked ? ["open", "locked"] : ["open"];
  return listLoraRecords()
    .filter((l) => l.media === "video" && l.removed_at === null && loraUsable(l) && (wanted as string[]).includes(loraAccess(audience.actor, l, surface)))
    .sort((a, b) => a.added_at.localeCompare(b.added_at) || a.id.localeCompare(b.id)).map(adapterOfLora);
}

/** A style leaves the household library with its file (the Models and storage uninstall): its record goes too. */
export function forgetVideoAdapter(id: string): void {
  deleteLoraRecord(id);
  dropLoraSyncCache();
}

function norm(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** The LoRA the person named (by id, name or trigger word), or null. Never guesses between two. */
export function matchVideoAdapter(adapters: readonly VideoAdapter[], named: string): VideoAdapter | null {
  const wanted = norm(named.replace(/\b(my|the|a|an|style|look|lora)\b/gi, " "));
  if (!wanted) return null;
  const exact = adapters.filter((a) => a.id === named.trim() || norm(a.name) === wanted);
  if (exact.length === 1) return exact[0]!;
  const loose = adapters.filter((a) => norm(a.name).includes(wanted) || wanted.includes(norm(a.name)) || a.trigger_words.some((t) => norm(t) === wanted));
  return loose.length === 1 ? loose[0]! : null;
}
