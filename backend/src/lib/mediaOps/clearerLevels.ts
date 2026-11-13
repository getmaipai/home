// MAKE-CLEARER-01: the words people see for the three levels of Make clearer, once, for pictures and videos (the operations differ in how they run, not in what the
// levels are called). One line each and a time estimate; never a model name or a resource word (an admin reads the reason when a level is off).
import type { MediaLevel } from "./types";

export const CLEARER_LEVELS: readonly MediaLevel[] = [
  { id: "quick", label: "Quick", summary: "Less grain and sharper edges, done on this computer.", eta: "a few seconds" },
  { id: "better", label: "Better", summary: "Smart enlarging that rebuilds fine detail.", eta: "about a minute" },
  { id: "best", label: "Best", summary: "The most careful repair, for old or damaged pictures and faces.", eta: "a few minutes" },
];

export const CLEARER_VIDEO_LEVELS: readonly MediaLevel[] = [
  { id: "quick", label: "Quick", summary: "Less grain and sharper edges, same size.", eta: "under a minute" },
  { id: "better", label: "Better", summary: "Smart enlarging to twice the size.", eta: "a few minutes" },
  { id: "best", label: "Best", summary: "The most careful repair, for old or shaky footage.", eta: "several minutes" },
];
