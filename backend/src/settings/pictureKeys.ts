// IMGGEN-SET-01: the household's picture controls (docs/design/image-generation-2026-10-17.md, "Policy"). Declared
// here and written to the spec registry by `scripts/gen-settings-registry.ts`, like the reference keys. Children and
// teens never make pictures whatever these say (lib/pictures/policy.ts): they are controls for adults only, and
// the absolute lines (nothing sexual involving a minor, no likeness of a real person without consent) have no key.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const PICTURE_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "generation.adults",
    scope: "household",
    selector: "boolean",
    default: true,
    label: "Adults can make pictures",
    help: "Adults can ask chat for pictures. Children and teens cannot, whatever this says.",
    level: "basic",
    copy: { does: "Turns picture making on or off for the grown-ups here." },
    lives_in: "household.pictures",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "generation.adult_adapters",
    scope: "household",
    selector: "select",
    range: { options: ["allowed", "restricted"] },
    default: "allowed",
    label: "Adult-only styles",
    help: "Whether adults can use styles marked adult-only. Children and teens never can.",
    level: "basic",
    copy: {
      does: "Decides whether every saved style can be picked in chat.",
      options: {
        allowed: "Every saved style can be picked.",
        restricted: "Styles with an age limit are left out of the choices.",
      },
    },
    lives_in: "household.pictures",
    honoured_by: ["home"],
  }),
  // IMGGEN-QUALITY-01 (owner ruling 2026-10-17): one plain choice. Quick is the default and stays fast; Detailed is the slower,
  // richer maker. The model names live only under Details on the Pictures page.
  SettingsKey.parse({
    key: "generation.picture_quality",
    scope: "household",
    selector: "select",
    range: { options: ["quick", "detailed"] },
    default: "quick",
    label: "Picture quality",
    help: "Quick makes a picture in a few seconds. Detailed takes longer and has more looks to choose from. Anyone can ask chat for the other one for a single picture.",
    level: "basic",
    copy: {
      does: "Decides how chat makes a picture when nobody asks for a kind.",
      options: {
        quick: "A few seconds a picture. Best for most requests.",
        detailed: "About 15 to 30 seconds a picture, with finer detail and many more styles.",
      },
    },
    lives_in: "household.pictures",
    honoured_by: ["home"],
  }),
];
