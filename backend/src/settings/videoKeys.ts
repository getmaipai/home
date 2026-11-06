// VIDEO-GEN-04: the household's video controls (docs/design/video-generation-2026-10-17.md, section 7 and 10).
// Declared here like the picture keys (pictureKeys.ts) and shown on the same Settings card, Pictures and videos.
// Children and teens never make videos whatever these say (lib/videos/policy.ts): they are controls for adults only,
// and the minor line has no key.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const VIDEO_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "generation.video.enabled",
    scope: "household",
    selector: "boolean",
    default: true,
    label: "Video making",
    help: "Turns video making on or off for everyone in the home, children and teens too. Children's daily limits are under Pictures.",
    level: "basic",
    copy: { does: "Switches making clips on or off for the whole home." },
    lives_in: "household.media_videos",
    honoured_by: ["home"],
  }),
  // VIDEO-LTX-01 (owner ruling 2026-10-17): the same plain choice as pictures. Quick is the silent five second clip and the
  // default; Detailed makes a sound track with spoken words in the same pass, up to ten seconds, starting from words only.
  SettingsKey.parse({
    key: "generation.video_quality",
    scope: "household",
    selector: "select",
    range: { options: ["quick", "detailed"] },
    default: "quick",
    label: "Video quality",
    help: "Quick makes a short silent clip and can start from a picture. Detailed adds sound and spoken words, and makes longer clips from words. Anyone who can make videos can ask chat for the other one for a single video.",
    level: "basic",
    copy: {
      does: "Decides how chat makes a video when nobody asks for a kind.",
      options: {
        quick: "A silent 5 second clip in about two minutes, and it can start from a picture.",
        detailed: "A clip up to 10 seconds with sound and speech, made from words, with many more styles.",
      },
    },
    lives_in: "household.ai_videos",
    honoured_by: ["home"],
  }),
  // TIER-HOME-01: the household default level for a video (Standard or Boost); the old Quick and Detailed key stays readable until VIDEO-SETTINGS-09.
  SettingsKey.parse({
    key: "generation.video_tier",
    scope: "household",
    selector: "select",
    range: {"options": ["standard", "boost"]},
    default: "standard",
    label: "Level when nobody says",
    help: "Standard is fast and has sound. Boost has a sharper picture and takes a little longer. Anyone can pick a level for one video.",
    copy: {
      does: "Picks how chat makes a video if no level is named.",
      options: {
        standard: "Fast, with sound.",
        boost: "A sharper picture, a little slower.",
      },
    },
    level: "basic",
    lives_in: "household.media_videos",
    honoured_by: ["home"],
  }),
];
