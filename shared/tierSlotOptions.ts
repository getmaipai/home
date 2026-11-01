// TIER-HOME-04: what the saved slot records (`engines.<role>.tier.<tier>`) really change today, in one place. The AI and models dialogs offer a
// level or an option only when something reads it, so the page never shows a switch that does nothing. The readers:
//   video   lib/videos/slotBody.ts   model, `length_seconds`, `resolution`, the level's tier and its off switch
//   music   lib/music/jobs.ts        the level's tier and its off switch (the engine has one model and reads no option)
//   image   lib/pictures/policy.ts   Standard and Boost model and off switch (Max: `maxAvailable`); no option is read
//   chat    nothing for Boost or Max: no chat request names a level (the composer has no level control; the Max lease swaps in the coding model)
//   voice   nothing for Boost or Max: the Stack has no voice model above Standard
// Adding a reader means adding its names here in the same commit; the spec's vocabulary (`resource-tiers.json`) stays the list of names a slot may carry.
export type SlotLevel = "standard" | "boost" | "max";

export const SLOT_OPTIONS_READ: Readonly<Record<string, readonly string[]>> = {
  chat: [],
  image: [],
  video: ["length_seconds", "resolution"],
  music: [],
  voice: [],
};

export const SLOT_LEVELS_READ: Readonly<Record<string, readonly SlotLevel[]>> = {
  chat: ["standard"],
  image: ["standard", "boost", "max"],
  video: ["standard", "boost", "max"],
  music: ["standard", "boost"],
  voice: ["standard"],
};
