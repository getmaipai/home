// VIDEO-LORA-08: small shared parts of the Styles tab: the spec card's words, error sentences, the plain lines for a style's base and its age check,
// and the picture (an adult-only style's picture is fetched with the unlock proof; an ordinary one is a plain image).
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { adultBlobUrl } from "@/lib/adultLock";
import { formatBytes } from "@maipai/ui/src/format";
import type { Card as SpecCard } from "@maipai/ui/src/settings/settingsAudience";
import type { AdultCheckState, BaseModelId, StyleRow } from "@/apps/settings/styles/stylesApi";

/** The spec card's copy (rule S5). The fallbacks are the same sentences, so a view drawn without a card (a test, a preview) reads the same. */
export const STYLES_COPY_DEFAULTS = {
  browse_button: "Browse styles",
  add_file_button: "Add from a file",
  empty: "No styles yet. Browse styles to find one, or add one from a file.",
  locked_note: "Adult-only styles stay locked until you enter your own passcode.",
  unlocked_note: "Unlocked on this page only. It locks again when you leave or after 2 minutes without a touch.",
  sources_title: "Where styles come from",
  huggingface_note: "On. Search and download styles from Hugging Face. A token is only needed for styles that ask you to accept terms. Home sends it only for those files.",
  civitai_off_note: "Off until you turn it on. This computer only contacts civitai.com when you search or install.",
  civitai_notice_title: "Turn on Civitai?",
  civitai_notice_body_1: "When you search or install, this computer contacts civitai.com. It sends what you typed and your key, nothing about your family.",
  civitai_notice_body_2: "Civitai has its own rules. Some styles there are for adults only, and some may show real people. You choose what to install.",
  civitai_notice_cancel: "Not now",
  civitai_notice_confirm: "Turn on",
  civitai_key_replace: "Replace",
  civitai_key_remove: "Remove",
  removed_title: "Recently removed",
  removed_line: "Removed {days} days ago. Deleted for good in {left} days.",
  restore_button: "Restore",
  delete_now_button: "Delete now",
} as const;
export type StylesCopy = Record<keyof typeof STYLES_COPY_DEFAULTS, string>;
export function stylesCopy(card?: SpecCard): StylesCopy {
  const given = ((card as { copy?: Record<string, string> } | undefined)?.copy) ?? {};
  return { ...STYLES_COPY_DEFAULTS, ...given };
}

export const messageOf = (error: unknown, fallback: string): string => (error instanceof ApiError ? error.message : fallback);

export const sizeWords = (bytes: number): string => (bytes > 0 ? formatBytes(bytes) : "Size unknown");

/** "Style, Videos, Works at Standard, Boost and Max" and its siblings (settings-media 4.4). */
export function whatItIs(row: Pick<StyleRow, "kind" | "base_model">): string {
  const kind = row.kind === "character" ? "Character" : row.kind === "motion" ? "Motion" : "Style";
  const base: Record<BaseModelId, string> = {
    "ltx-2.5": "Works at Standard, Boost and Max",
    "ltx-2.3": "Retired video model, no longer available",
    "wan2.2-ti2v-5b": "Made for the engine behind children's videos, so Home cannot use it",
    unknown: "Waiting for an admin to say what it is made for",
  };
  return `${kind}, Videos, ${base[row.base_model]}`;
}

/** The three-state adult check in plain words (design 15.1). Evidence, never the decision: the audience is what counts. */
export function adultCheckLine(state: AdultCheckState): string {
  if (state === "normal") return "The source says it is safe.";
  if (state === "adult") return "The source marks this adult.";
  return "The source says nothing about age, so it stays locked until you decide.";
}

export function availabilityWords(who: StyleRow["availability"]["who"]): string {
  return who === "adults" ? "All adults" : who === "people" ? "Chosen people" : "Only admins";
}

/** A picture drawn from a path. `proof` fetches it with the unlock proof (an adult-only style or a revealed adult hit); otherwise it is an ordinary image. */
export function StylePicture({ path, proof, className }: { path: string | null; proof: boolean; className?: string }) {
  const [url, setUrl] = useState<string | null>(proof || !path ? null : path);
  useEffect(() => {
    let alive = true;
    if (!path) { setUrl(null); return; }
    if (!proof) { setUrl(path); return; }
    setUrl(null);
    void adultBlobUrl(path).then((made) => { if (alive) setUrl(made); });
    return () => { alive = false; };
  }, [path, proof]);
  return url ? <img src={url} alt="" loading="lazy" draggable={false} className={className ?? "size-full object-cover"} /> : null;
}

export const filePath = (fileId: string | null): string | null => (fileId ? `/api/files/${encodeURIComponent(fileId)}/content` : null);
