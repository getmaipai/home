// VIDEO-GEN-04: the household's video controls (docs/design/video-generation-2026-10-17.md, section 7 and 10).
// Declared here like the picture keys (pictureKeys.ts) and shown on the same Settings card, Pictures and videos.
// Children and teens never make videos whatever these say (lib/videos/policy.ts): they are controls for adults only,
// and the absolute lines have no key.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const VIDEO_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "generation.video.enabled",
    scope: "household",
    selector: "boolean",
    default: true,
    label: "Adults can make videos",
    help: "Adults can ask chat for short videos. Children and teens cannot, whatever this says.",
    level: "basic",
    copy: { does: "Turns video making on or off for the grown-ups here." },
    lives_in: "household.pictures",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "generation.video.adult_adapters",
    scope: "household",
    selector: "select",
    range: { options: ["allowed", "restricted"] },
    default: "allowed",
    label: "Adult-only video styles",
    help: "Whether adults can use video styles marked adult-only. Children and teens never can.",
    level: "basic",
    copy: {
      does: "Decides whether every saved video style can be picked in chat.",
      options: {
        allowed: "Every saved video style can be picked.",
        restricted: "Video styles with an age limit are left out of the choices.",
      },
    },
    lives_in: "household.pictures",
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
        quick: "5 seconds with no sound, in about two minutes. Can start from a picture.",
        detailed: "Up to 10 seconds with sound and spoken words, in a minute or two. Starts from words, with many more styles.",
      },
    },
    lives_in: "household.pictures",
    honoured_by: ["home"],
  }),
];
