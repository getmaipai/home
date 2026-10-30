// MEM-SPACE-04/09: the Performance page's data. The keys, words and defaults live in the settings spec (@maipai/spec); this file holds only what the making-space note says a preset implies and the starter app lists.
import keys from "@maipai/spec/settings/keys.json";

export type PresetId = "chat_first" | "balanced" | "big_jobs_first";
export const PRESET_IDS: PresetId[] = ["chat_first", "balanced", "big_jobs_first"];
export const CATEGORIES = ["chat", "image", "video", "music"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_WORDS: Record<Category | "tools", string> = { chat: "Chat", image: "Pictures", video: "Video", music: "Music", tools: "Stems and tools" };

interface SpecKey { key: string; label: string; help: string; default: unknown; range?: { options?: string[] }; copy?: { does?: string; options?: Record<string, string> } }
const byKey = new Map((keys as unknown as SpecKey[]).map((entry) => [entry.key, entry]));
export const specKey = (key: string): SpecKey => byKey.get(key) ?? { key, label: key, help: "", default: null };
export const specDefault = (key: string) => specKey(key).default;

/** The values each preset writes (making-space note section 5). Anything else the page reads stays as the person set it. */
export const PRESET_VALUES: Record<PresetId, Record<string, number | boolean | string>> = {
  chat_first: { "resources.quiet_seconds": 60, "resources.quiet_max_wait": 600, "resources.quiet_timeout": "proceed", "resources.lower_without_asking.chat": false, "resources.lower_without_asking.image": false, "resources.lower_without_asking.video": false, "resources.lower_without_asking.music": false },
  balanced: { "resources.quiet_seconds": 20, "resources.quiet_max_wait": 600, "resources.quiet_timeout": "proceed", "resources.lower_without_asking.chat": false, "resources.lower_without_asking.image": true, "resources.lower_without_asking.video": false, "resources.lower_without_asking.music": false },
  big_jobs_first: { "resources.quiet_seconds": 20, "resources.quiet_max_wait": 600, "resources.quiet_timeout": "proceed", "resources.lower_without_asking.chat": true, "resources.lower_without_asking.image": true, "resources.lower_without_asking.video": true, "resources.lower_without_asking.music": true },
};

/** The preset whose every value matches, else "custom": a field changed in Customize overrides that one value and the page reads Custom. */
export function currentPreset(value: (key: string) => unknown): PresetId | "custom" {
  for (const id of PRESET_IDS) if (Object.entries(PRESET_VALUES[id]).every(([key, expected]) => value(key) === expected)) return id;
  return "custom";
}

export interface StarterApp { bundleId: string; name: string }
export const STARTER_ALWAYS: StarterApp[] = [
  ["com.apple.Safari", "Safari"], ["com.google.Chrome", "Chrome"], ["org.mozilla.firefox", "Firefox"], ["com.microsoft.edgemac", "Edge"], ["com.brave.Browser", "Brave"], ["company.thebrowser.Browser", "Arc"],
  ["com.apple.Maps", "Maps"], ["com.apple.MobileSMS", "Messages"], ["com.apple.Music", "Music"], ["com.apple.TV", "TV"], ["com.apple.podcasts", "Podcasts"], ["com.apple.news", "News"],
  ["com.apple.iBooksX", "Books"], ["com.apple.Photos", "Photos"], ["com.apple.stocks", "Stocks"], ["com.apple.Home", "Home"], ["com.apple.FaceTime", "FaceTime"], ["com.apple.mail", "Mail"],
  ["com.apple.iCal", "Calendar"], ["com.apple.Notes", "Notes"], ["com.apple.reminders", "Reminders"], ["com.apple.Preview", "Preview"], ["com.apple.iWork.Keynote", "Keynote"], ["com.apple.iWork.Pages", "Pages"], ["com.apple.iWork.Numbers", "Numbers"],
].map(([bundleId, name]) => ({ bundleId: bundleId!, name: name! }));
export const STARTER_NEVER: StarterApp[] = [
  ["com.apple.Terminal", "Terminal"], ["com.googlecode.iterm2", "iTerm"], ["com.anthropic.claudefordesktop", "Claude"], ["com.apple.dt.Xcode", "Xcode"], ["com.microsoft.VSCode", "Visual Studio Code"],
  ["com.todesktop.230313mzl4w4u92", "Cursor"], ["com.1password.1password", "1Password"], ["com.bitwarden.desktop", "Bitwarden"],
].map(([bundleId, name]) => ({ bundleId: bundleId!, name: name! }));

export function parseList(raw: unknown): string[] {
  try { const parsed = typeof raw === "string" ? JSON.parse(raw) : raw; return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; }
}

export type Cell = "reduced" | "standard" | "boost" | "max" | "queued" | "off";
export type ProfileTable = Record<string, Partial<Record<Category | "tools", Cell>>>;
export function parseProfiles(raw: unknown): ProfileTable {
  try { const parsed = typeof raw === "string" ? JSON.parse(raw) : raw; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as ProfileTable : {}; } catch { return {}; }
}
export const ROW_WORDS = (row: string) => { const [kind, tier] = row.split("."); return `${CATEGORY_WORDS[(kind === "image" || kind === "video" || kind === "chat" || kind === "music" ? kind : "tools") as Category]} at ${tier ? tier[0]!.toUpperCase() + tier.slice(1) : ""}`; };
/** Chat is never queued or off; it is lowered to Reduced at the lowest (profiles note section 3). */
export const cellOptions = (category: Category | "tools"): Cell[] => category === "chat" ? ["reduced", "standard", "boost", "max"] : ["standard", "boost", "max", "queued", "off"];
