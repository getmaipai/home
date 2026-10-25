// NEWS-02 and NEWS-07 (news design sections 7 and 8): household picture and full-text settings. Declared
// here ahead of the pinned spec tag, like the likeness and picture keys, and written to the spec registry by
// `scripts/gen-settings-registry.ts`; scripts/check.sh lists them as ahead of the spec until a tag carries them.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import { TOPICS } from "@/lib/news/topics";

export const NEWS_FULL_TEXT_PREFETCH_KEY = "news.full_text_prefetch";

export const NEWS_IMAGES_KEY = "news.images";
export const NEWS_IMAGE_CACHE_MB_KEY = "news.image_cache_mb";
export const NEWS_IMAGE_CACHE_MB_DEFAULT = 512;
export const NEWS_IMAGE_CACHE_MB_MIN = 32;

export const NEWS_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: NEWS_FULL_TEXT_PREFETCH_KEY, scope: "household", selector: "boolean", default: true,
    label: "Load News stories ahead of time",
    help: "Keep full text ready for followed channels and the top stories in Today. On by default. Home tries each item only once, at most one every 30 seconds for each site (so no one site is flooded) and 150 per site in 24 hours. It follows each site's robots rules and pauses on the first block. Turn this off to load pages only when someone opens or saves a story.",
    level: "advanced", secret: false, lives_in: "household.news", honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "news.images",
    scope: "household",
    selector: "boolean",
    default: true,
    label: "Pictures in News",
    help: "Show the picture each news story came with. Home asks the publisher for a picture once, the first time a screen shows that story, and keeps a copy; it never fetches pictures in the background. Turn this off and News shows text only.",
    level: "advanced",
    secret: false,
    lives_in: "household.news",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "news.image_cache_mb",
    scope: "household",
    selector: "number",
    range: { min: NEWS_IMAGE_CACHE_MB_MIN },
    default: NEWS_IMAGE_CACHE_MB_DEFAULT,
    label: "News picture storage (MB)",
    help: "How much disk space News pictures may use. When it fills, Home removes the pictures nobody has looked at for the longest time. A picture nobody opens for 14 days is removed either way.",
    level: "advanced",
    secret: false,
    lives_in: "household.news",
    honoured_by: ["home"],
  }),
];

const DEFAULT_TOPIC_BANDS = ["adult", "teen", "child"] as const;

/** `news.default_topics.<band>`: the topics everyone of a user type follows until they unfollow one. Adults and teens follow every
 * topic offered to them; children follow none until the household picks (their News is the Kids' lists only). */
export const NEWS_DEFAULT_TOPIC_KEYS: SettingsKey[] = DEFAULT_TOPIC_BANDS.map((band) => {
  const offered = TOPICS.filter((topic) => (topic.bands as readonly string[]).includes(band));
  return SettingsKey.parse({
    key: `news.default_topics.${band}`, scope: "household", selector: "select",
    range: { options: offered.map((topic) => topic.id), multiple: true },
    default: band === "child" ? [] : offered.map((topic) => topic.id),
    label: `Topics followed by default for ${band}`,
    help: `The News topics that start out followed for people using ${band} controls. Each person can unfollow any of them on their own Following page, and a topic they unfollow stays unfollowed when you change this. Only an admin can change this.`,
    copy: {
      does: "Chooses which News topics start out followed for this user type.",
      options: Object.fromEntries(offered.map((topic) => [topic.id, topic.description])),
      option_labels: Object.fromEntries(offered.map((topic) => [topic.id, topic.label])),
    },
    level: "basic", secret: false, lives_in: "household.news", honoured_by: ["home"],
  });
});
NEWS_SETTINGS_KEYS.push(...NEWS_DEFAULT_TOPIC_KEYS);
