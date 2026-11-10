// VIDEO-LORA-08: small shared parts of the Styles tab: the spec card's words, error sentences, the plain lines for a style's base and its age check,
// and the picture (an adult-only style's picture is fetched with the unlock proof; an ordinary one is a plain image).
import { i18n } from "@lingui/core";
import { useEffect, useState } from "react";
import { adultBlobUrl } from "@/lib/adultLock";
import { formatBytes } from "@maipai/ui/src/format";
import type { Card as SpecCard } from "@maipai/ui/src/settings/settingsAudience";
import type { AdultCheckState, BaseModelId, StyleRow } from "@/apps/settings/styles/stylesApi";
import { errorLine } from "@/lib/hubReachability";

/** The spec card's copy (rule S5). The fallbacks are the same sentences, so a view drawn without a card (a test, a preview) reads the same. */
export const STYLES_COPY_DEFAULTS = {
  get browse_button() { return i18n._({ id: "Browse styles", message: "Browse styles" }); },
  get add_file_button() { return i18n._({ id: "Add from a file", message: "Add from a file" }); },
  get empty() { return i18n._({ id: "No styles yet. Browse styles to find one, or add one from a file.", message: "No styles yet. Browse styles to find one, or add one from a file." }); },
  get locked_note() { return i18n._({ id: "Adult-only styles stay locked until you enter your own passcode.", message: "Adult-only styles stay locked until you enter your own passcode." }); },
  get unlocked_note() { return i18n._({ id: "Unlocked on this page only. It locks again when you leave or after 2 minutes without a touch.", message: "Unlocked on this page only. It locks again when you leave or after 2 minutes without a touch." }); },
  get sources_title() { return i18n._({ id: "Where styles come from", message: "Where styles come from" }); },
  get huggingface_note() { return i18n._({ id: "On. Search and download styles from Hugging Face. A token is only needed for styles that ask you to accept terms. Home sends it only for those files.", message: "On. Search and download styles from Hugging Face. A token is only needed for styles that ask you to accept terms. Home sends it only for those files." }); },
  get civitai_off_note() { return i18n._({ id: "On by default. This computer contacts civitai.com only when an admin searches or installs a style.", message: "On by default. This computer contacts civitai.com only when an admin searches or installs a style." }); },
  get civitai_notice_title() { return i18n._({ id: "Turn on Civitai?", message: "Turn on Civitai?" }); },
  get civitai_notice_body_1() { return i18n._({ id: "When you search or install, this computer contacts civitai.com. It sends what you typed and your key, nothing about your family.", message: "When you search or install, this computer contacts civitai.com. It sends what you typed and your key, nothing about your family." }); },
  get civitai_notice_body_2() { return i18n._({ id: "Civitai has its own rules. Some styles there are for adults only, and some may show real people. You choose what to install.", message: "Civitai has its own rules. Some styles there are for adults only, and some may show real people. You choose what to install." }); },
  get civitai_notice_cancel() { return i18n._({ id: "Not now", message: "Not now" }); },
  get civitai_notice_confirm() { return i18n._({ id: "Turn on", message: "Turn on" }); },
  get civitai_key_replace() { return i18n._({ id: "Replace", message: "Replace" }); },
  get civitai_key_remove() { return i18n._({ id: "Remove", message: "Remove" }); },
  get removed_title() { return i18n._({ id: "Recently removed", message: "Recently removed" }); },
  get removed_line() { return i18n._({ id: "Removed {days} days ago. Deleted for good in {left} days.", message: "Removed {days} days ago. Deleted for good in {left} days.", values: { days: "{days}", left: "{left}" } }); },
  get restore_button() { return i18n._({ id: "Restore", message: "Restore" }); },
  get delete_now_button() { return i18n._({ id: "Delete now", message: "Delete now" }); },
} as const;
export type StylesCopy = Record<keyof typeof STYLES_COPY_DEFAULTS, string>;
export function stylesCopy(card?: SpecCard): StylesCopy {
  const given = ((card as { copy?: Record<string, string> } | undefined)?.copy) ?? {};
  return { ...STYLES_COPY_DEFAULTS, ...given }; // the getters run here, so the sentences follow the language at call time
}

export const messageOf = (error: unknown, fallback: string): string => (errorLine(error, fallback));

export const sizeWords = (bytes: number): string => (bytes > 0 ? formatBytes(bytes) : i18n._({ id: "Size unknown", message: "Size unknown" }));

/** "Style, Videos, Works at Standard, Boost and Max" and its siblings (settings-media 4.4). */
export function whatItIs(row: Pick<StyleRow, "kind" | "base_model"> & { base_note?: string | null }): string {
  const kind = row.kind === "character" ? i18n._({ id: "Character", message: "Character" }) : row.kind === "motion" ? i18n._({ id: "Motion", message: "Motion" }) : i18n._({ id: "Style", message: "Style" });
  const base: Record<BaseModelId, string> = {
    "ltx-2.5": i18n._({ id: "Works at Standard, Boost and Max", message: "Works at Standard, Boost and Max" }),
    "ltx-2.3": row.base_note ?? i18n._({ id: "Made for an older video model, tested on the newer one", message: "Made for an older video model, tested on the newer one" }),
    "wan2.2-ti2v-5b": i18n._({ id: "Made for the engine behind children's videos, so Home cannot use it", message: "Made for the engine behind children's videos, so Home cannot use it" }),
    unknown: i18n._({ id: "Waiting for an admin to say what it is made for", message: "Waiting for an admin to say what it is made for" }),
  };
  return i18n._({ id: "{kind}, Videos, {base}", message: "{kind}, Videos, {base}", values: { kind, base: base[row.base_model] } });
}

/** The three-state adult check in plain words (design 15.1). Evidence, never the decision: the audience is what counts. */
export function adultCheckLine(state: AdultCheckState): string {
  if (state === "normal") return i18n._({ id: "The source says it is safe.", message: "The source says it is safe." });
  if (state === "adult") return i18n._({ id: "The source marks this adult.", message: "The source marks this adult." });
  return i18n._({ id: "The source says nothing about age, so it stays locked until you decide.", message: "The source says nothing about age, so it stays locked until you decide." });
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
