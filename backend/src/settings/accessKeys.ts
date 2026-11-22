// OVERRIDES-01 (RULES.md C3, C4, C10): role defaults and admin overrides as settings. Home declares them ahead of the pinned spec tag
// (scripts/settings-ahead-of-spec.json lists them); `scripts/gen-settings-registry.ts` writes them to the spec registry. Nothing here
// carries a `control` field: only an owner or admin writes an override key (`assertCanSetAccessKey` in lib/settings.ts), and the
// `content.own_*` keys are the person's own lowering, which never touches an admin's row.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const CONTENT_KINDS = ["chat", "web", "news", "library", "made"] as const;
export type ContentKindId = (typeof CONTENT_KINDS)[number];
export const CEILING_LEVELS = ["G", "PG", "PG-13", "R", "X"] as const;
export const ACCESS_WORKS = ["chat", "image", "video", "music", "voice", "coding"] as const;

export const CONTENT_CEILING_KEY = "content.ceiling";
export const CONTENT_UNRATED_KEY = "content.unrated";
export const CONTENT_OWN_CEILING_KEY = "content.own_ceiling";
export const CONTENT_OWN_UNRATED_KEY = "content.own_unrated";
export const ACCESS_THINKING_KEY = "access.thinking";
export const ACCESS_TIER_BOOST_KEY = "access.tier.boost";
export const ACCESS_TIER_MAX_KEY = "access.tier.max";

const KIND_NAME: Record<ContentKindId, string> = { chat: "chat replies", web: "web search", news: "News", library: "the library", made: "things Home makes" };
// The copy phrases avoid the label's own words (COPY-LINT-01: a copy line never repeats its label).
const KIND_PHRASE: Record<ContentKindId, string> = { chat: "answers", web: "searching the web", news: "the news", library: "saved shows and songs", made: "pictures, clips and songs" };
const GROUP = "person.allowance";
const base = { scope: "person" as const, merge: "override" as const, level: "basic" as const, lives_in: GROUP, honoured_by: ["home"] };
const ceilingBands = { child: "G", teen: "PG-13", adult: "X" } as const;
const LEVEL_LINES: Record<string, string> = {
  default: "Follows the main setting.",
  G: "Gentle, nothing beyond G.",
  PG: "Mild, with a little that is grown-up.",
  "PG-13": "Some grown-up themes, nothing explicit.",
  R: "Strong language and themes.",
  X: "Everything, with nothing held back.",
};
const WORK_LABEL: Record<string, string> = { chat: "Chat", image: "Pictures", video: "Videos", music: "Music", voice: "Voice" };
const workLines = (power: string): Record<string, string> => ({ chat: `Chat replies with ${power}.`, image: `Pictures with ${power}.`, video: `Videos with ${power}.`, music: `Music with ${power}.`, voice: `Voices with ${power}.` });

function select(key: string, options: readonly string[], dflt: string, label: string, help: string, does: string, optionLines: Record<string, string>, layers: Array<"band" | "household" | "person">, bandDefault?: Record<string, string>): SettingsKey {
  return SettingsKey.parse({
    key, selector: "select", range: { options: [...options] }, default: dflt, label, help,
    copy: { does, options: Object.fromEntries(options.map((option) => [option, optionLines[option]!])) },
    ...base, layers, ...(bandDefault ? { band_default: bandDefault } : {}),
  });
}
const allKinds = { child: "default", teen: "default", adult: "default" };

export const ACCESS_SETTINGS_KEYS: SettingsKey[] = [
  select(CONTENT_CEILING_KEY, CEILING_LEVELS, "X", "Content level", "The most grown-up things this person can see anywhere in Home. The household's role default applies until an admin changes it.", "Sets how grown-up the things shown anywhere in Home may be.", LEVEL_LINES, ["band", "household", "person"], ceilingBands),
  ...CONTENT_KINDS.map((kind) => select(`${CONTENT_CEILING_KEY}.${kind}`, ["default", ...CEILING_LEVELS], "default", `Content level for ${KIND_NAME[kind]}`, `The most grown-up things this person can see in ${KIND_NAME[kind]}. Default follows the content level above.`, `How grown-up ${KIND_PHRASE[kind]} may be, or default to the main setting.`, LEVEL_LINES, ["band", "household", "person"], allKinds)),
  SettingsKey.parse({
    key: CONTENT_UNRATED_KEY, selector: "boolean", default: true, label: "Unrated items",
    help: "Lets through things that nothing could rate. Children and teens do not see them until an admin allows it.", copy: { does: "Lets through things nothing has rated yet." },
    ...base, layers: ["band", "household", "person"], band_default: { child: false, teen: false, adult: true },
  }),
  ...CONTENT_KINDS.map((kind) => select(`${CONTENT_UNRATED_KEY}.${kind}`, ["default", "yes", "no"], "default", `Unrated items in ${KIND_NAME[kind]}`, `Whether things nobody has rated yet show in ${KIND_NAME[kind]}. Default follows the setting above.`, `Shows or hides unrated ${KIND_PHRASE[kind]}, or follows the main setting.`, { default: "Follows the main setting.", yes: "Shows what nothing has rated yet.", no: "Hides what nothing has rated yet." }, ["band", "household", "person"], allKinds)),
  select(CONTENT_OWN_CEILING_KEY, ["default", ...CEILING_LEVELS], "default", "Your content level", "Lower it any time; it never goes above what your household gives you.", "Lowers what you see any time, never above what the household gives.", LEVEL_LINES, ["person"]),
  ...CONTENT_KINDS.map((kind) => select(`${CONTENT_OWN_CEILING_KEY}.${kind}`, ["default", ...CEILING_LEVELS], "default", `Your content level for ${KIND_NAME[kind]}`, `Lower it any time; it never goes above what your household gives you for ${KIND_NAME[kind]}.`, `Lowers what you see in ${KIND_PHRASE[kind]} any time.`, LEVEL_LINES, ["person"])),
  select(CONTENT_OWN_UNRATED_KEY, ["default", "no"], "default", "Hide unrated items", "Choose no to hide anything that has not been rated. Default follows your household.", "Keeps anything nothing has rated yet out of what you see.", { default: "Follows the household.", no: "Keeps out anything nothing has rated yet." }, ["person"]),
  SettingsKey.parse({
    key: ACCESS_THINKING_KEY, selector: "boolean", default: true, label: "Thinking before answering",
    help: "Lets Home think longer before it answers.", copy: { does: "Lets Home think longer before it answers." },
    ...base, layers: ["band", "household", "person"], band_default: { child: false, teen: false, adult: true },
  }),
  ...([[ACCESS_TIER_BOOST_KEY, "Boost", "Uses more of the home's power for a faster or better result.", { child: [], teen: [...ACCESS_WORKS], adult: [...ACCESS_WORKS] }],
    [ACCESS_TIER_MAX_KEY, "Max", "Uses the most of the home's power for one big job.", { child: [], teen: [], adult: [] }]] as const).map(([key, name, does, bands]) => SettingsKey.parse({
    key, selector: "select", range: { options: [...ACCESS_WORKS], multiple: true }, default: [...ACCESS_WORKS], label: `${name} for`,
    help: `Which kinds of work may use ${name}. ${does}`, copy: { does, option_labels: WORK_LABEL, options: workLines(name === "Boost" ? "extra power" : "full power") },
    ...base, layers: ["band", "household", "person"], band_default: bands,
  })),
];
