import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
const PODCAST_SEGMENT_KINDS = ["ad", "sponsor", "bumper", "selfpromo", "intro", "outro", "recap"] as const;

const values = ["skip", "mark", "off", "inherit"] as const;
export const PODCAST_SEGMENT_SETTINGS_KEYS: SettingsKey[] = PODCAST_SEGMENT_KINDS.flatMap((kind) => [
  SettingsKey.parse({ key: `podcasts.skip.${kind}`, scope: "person", selector: "select", range: { options: values }, default: "inherit", label: `${kind} segments`, help: `Choose what to do with ${kind} segments in podcast episodes.`, level: "basic", lives_in: "person.podcasts", honoured_by: ["home"] }),
  SettingsKey.parse({ key: `podcasts.skip.${kind}.default`, scope: "household", selector: "select", range: { options: values }, default: "inherit", label: `Default ${kind} behavior`, help: `Set the household default for ${kind} segments in podcast episodes.`, level: "advanced", lives_in: "household.media_lookups", honoured_by: ["home"] }),
  // A declared JSON map holds per-show values so arbitrary show ids do not create undeclared setting keys.
  SettingsKey.parse({ key: `podcasts.skip.${kind}.shows`, scope: "household", selector: "text", default: "{}", label: `${kind} show overrides`, help: `Per-show ${kind} segment behavior, stored as a JSON map.`, level: "advanced", lives_in: "household.media_lookups", honoured_by: ["home"] }),
]);
PODCAST_SEGMENT_SETTINGS_KEYS.push(SettingsKey.parse({ key: "podcasts.skip.bumpers_with_ads", scope: "household", selector: "boolean", default: true, label: "Skip bumpers with ads", help: "Skip a bumper when it is grouped with an adjacent skipped ad.", level: "basic", lives_in: "household.media_lookups", honoured_by: ["home"] }));
PODCAST_SEGMENT_SETTINGS_KEYS.push(SettingsKey.parse({ key: "podcasts.skip.backfill_latest", scope: "household", selector: "number", range: { min: 1, max: 20, step: 1 }, default: 3, label: "Podcast episodes to backfill", help: "How many of the latest episodes to analyze when a show is followed and when you request backfill.", level: "basic", lives_in: "household.media_lookups", honoured_by: ["home"] }));
PODCAST_SEGMENT_SETTINGS_KEYS.push(SettingsKey.parse({ key: "podcasts.skip.explainer.dismissed", scope: "person", selector: "boolean", default: false, label: "Podcast skip explainer seen", help: "Remembers that this person has seen the podcast skip explainer.", level: "basic", lives_in: "person.podcasts", honoured_by: ["home"] }));
