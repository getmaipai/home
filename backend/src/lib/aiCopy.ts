// The words of the setup wizard's units, read from the spec (rule S5): a unit's title and sentence come from its card in
// spec/settings/areas.json. Nothing is written here.
import areasFile from "@maipai/spec/settings/areas.json";
import type { SetupCopy } from "../../../shared/setupJobs";

interface SpecCard { label: string; group?: string; groups?: string[]; view?: string; description?: string; choices?: Array<{ id: string; label: string; description: string }> }

const GROUPS: Record<string, string> = {
  chat: "household.ai_chat", pictures: "household.ai_pictures", videos: "household.ai_videos", music: "household.ai_music", stems: "household.ai_stems",
  voice: "household.ai_voice", vision: "household.ai_vision", coding: "household.ai_coding", faces: "household.ai_faces", ingredients: "household.ai_ingredients",
};

// The hub's own parts (the face finder files, the video-from-pictures adapter) are not Stack components and the spec has no card for them yet, so their words live
// beside the records that pin them (lib/visionAssets.ts, lib/videos/ingredientsAdapter.ts). Size, licence and source are read from those pins, never retyped.
const HUB_CARDS: Record<string, { title: string; summary: string }> = {
  faces: { title: "Telling people apart", summary: "Lets Home give each person in a picture their own panel when it builds a reference sheet." },
  ingredients: { title: "Video from pictures", summary: "Lets Home make a short video from reference pictures you attach." },
};

const aiCards = (areasFile.areas as unknown as Array<{ sections: Array<{ id: string; cards?: SpecCard[] }> }>)
  .flatMap((area) => area.sections).filter((section) => section.id === "ai").flatMap((section) => section.cards ?? []);
const glance = aiCards.find((card) => card.view === "ai.glance");

function cardFor(job: string): SpecCard | undefined {
  const group = GROUPS[job] ?? "";
  return aiCards.find((card) => card.group === group) ?? aiCards.find((card) => card.groups?.includes(group));
}

export const aiCopy: SetupCopy = {
  card(job) {
    const hub = HUB_CARDS[job];
    if (hub) return hub;
    const card = cardFor(job);
    if (card && card !== glance) return { title: card.label, summary: card.description ?? "" };
    const listed = glance?.choices?.find((choice) => choice.id === job);
    return { title: listed?.label ?? job, summary: listed?.description ?? "" };
  },
};
