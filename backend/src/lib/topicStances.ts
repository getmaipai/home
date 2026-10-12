// MINOR-TOPICS-01b: which stance each sensitive-subject family takes for one
// person on one turn. The band's record (contentCeiling.ts, mirrored from the
// spec) gives the defaults and the range; a parent's keys may only choose
// inside that range; a fixed family takes no key. Adults get nothing, so an
// adult's prompt is unchanged. No text is read: this maps settings to stances.
import type { AgeBand } from "@/lib/ageBand";
import { getCeilingForBand } from "@/lib/contentCeiling";
import { getHouseholdSettingValue, getSettingValueForPerson } from "@/lib/settings";
import { cleanStoryNames, type TopicFamily, type TopicStance } from "@maipai/spec/interpreters/ts/topicBlock.js";

export interface TopicStances {
  band: "child" | "teen";
  stances: Record<TopicFamily, TopicStance>;
  /** Child only; empty when the family-story keep is off or on a teen. */
  familyStoryNames: string[];
}

/** The raw settings the resolver reads. A person map holds the child's own keys, a household map the teen keys. */
export interface TopicSettingsInput {
  person?: Readonly<Record<string, unknown>>;
  household?: Readonly<Record<string, unknown>>;
}

const CHILD_KEYS: Partial<Record<TopicFamily, string>> = {
  bodies: "topics.bodies",
  health: "topics.health",
  risk: "topics.risk",
  violence: "topics.violence",
};
const TEEN_KEYS: Partial<Record<TopicFamily, string>> = {
  bodies: "topics.teen.bodies",
  risk: "topics.teen.risk",
};

const CHILD_PERSON_KEYS: readonly string[] = [
  ...(Object.values(CHILD_KEYS) as string[]),
  "topics.family_stories",
  "topics.family_story_names",
];
const MAX_NAMES_INPUT = 600;

/** Pure: band + stored values in, stances out. Adult (or an unknown band) returns null. */
export function resolveTopicStances(band: AgeBand, settings: TopicSettingsInput = {}): TopicStances | null {
  if (band !== "child" && band !== "teen") return null;
  const record = getCeilingForBand(band);
  const topics = record.topics;
  if (!topics) return null;
  // A teen reads only the household keys, never a person's: no person key exists for a teen.
  const keys = band === "child" ? CHILD_KEYS : TEEN_KEYS;
  const source = band === "child" ? settings.person : settings.household;
  const stances = {} as Record<TopicFamily, TopicStance>;
  for (const [family, entry] of Object.entries(topics) as [TopicFamily, (typeof topics)[TopicFamily]][]) {
    let stance = entry.stance as TopicStance;
    const key = keys[family];
    const asked = key && !entry.fixed ? source?.[key] : undefined;
    if (typeof asked === "string" && (entry.allowed as readonly string[]).includes(asked)) stance = asked as TopicStance;
    stances[family] = stance;
  }
  let familyStoryNames: string[] = [];
  const stories = record.family_stories;
  if (band === "child" && stories && (settings.person?.["topics.family_stories"] ?? stories.default) !== "off") {
    const custom = settings.person?.["topics.family_story_names"];
    const parsed = typeof custom === "string" ? custom.slice(0, MAX_NAMES_INPUT).split(/[,\n]/) : [];
    const cleaned = cleanStoryNames(parsed);
    familyStoryNames = cleaned.length > 0 ? cleaned : [...stories.names];
  }
  return { band, stances, familyStoryNames };
}

/** Reads the stored keys for this person (child) or the household (teen) and resolves. */
export function topicStancesForPerson(personId: string, band: AgeBand): TopicStances | null {
  if (band === "child") {
    const person: Record<string, unknown> = {};
    for (const key of CHILD_PERSON_KEYS) person[key] = getSettingValueForPerson(personId, key);
    return resolveTopicStances(band, { person });
  }
  if (band === "teen") {
    const household: Record<string, unknown> = {};
    for (const key of Object.values(TEEN_KEYS) as string[]) household[key] = getHouseholdSettingValue(key);
    return resolveTopicStances(band, { household });
  }
  return null;
}
