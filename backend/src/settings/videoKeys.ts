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
];
