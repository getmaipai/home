// The words of the AI job cards, read from the spec (rule S5): a card's title and sentence come from its card in
// spec/settings/areas.json, a choice's label and sentence from that card's `choices` or, for the Quick and Detailed
// choices and the music switch, from the key that holds the setting. Nothing is written here.
import areasFile from "@maipai/spec/settings/areas.json";
import keysFile from "@maipai/spec/settings/keys.json";
import type { AiCopy, AiJobId } from "../../../shared/aiChoices";
import { FACE_FINDER_NAME, faceFinderDescription } from "@/lib/visionAssets";
import { INGREDIENTS_NAME, ingredientsDescription } from "@/lib/videos/ingredientsAdapter";

interface SpecCard { label: string; group?: string; groups?: string[]; view?: string; description?: string; choices?: Array<{ id: string; label: string; description: string }> }
interface SpecKey { key: string; label: string; copy?: { does?: string; options?: Record<string, string> } }

const GROUPS: Record<AiJobId, string> = {
  chat: "household.ai_chat", pictures: "household.ai_pictures", picturesdetailed: "household.ai_pictures", videos: "household.ai_videos",
  music: "household.ai_music", stems: "household.ai_stems", voice: "household.ai_voice", wakeword: "household.ai_wakeword", vision: "household.ai_vision", coding: "household.ai_coding",
  faces: "household.ai_faces", ingredients: "household.ai_ingredients",
};
// VIDEO-SETTINGS-04: the words come from the tier keys. The choice ids keep their old names (quick, detailed); the words say Standard and Boost.
const QUALITY_KEYS: Record<string, string> = { pictures: "generation.picture_tier", videos: "generation.video_tier" };
const TIER_OF_CHOICE: Record<string, string> = { quick: "standard", detailed: "boost" };

// The hub's own parts (the face finder files, the video-from-pictures adapter) are not Stack components and the spec has no card for them yet, so their words live
// beside the records that pin them (lib/visionAssets.ts, lib/videos/ingredientsAdapter.ts). Size, licence and source are read from those pins, never retyped.
const HUB_CARDS: Partial<Record<AiJobId, { title: string; summary: string }>> = {
  faces: { title: "Telling people apart", summary: "Lets Home give each person in a picture their own panel when it builds a reference sheet." },
  ingredients: { title: "Video from pictures", summary: "Lets Home make a short video from reference pictures you attach." },
};
const HUB_CHOICES: Record<string, () => { label: string; description: string }> = {
  "faces.finder": () => ({ label: FACE_FINDER_NAME, description: faceFinderDescription() }),
  "ingredients.adapter": () => ({ label: INGREDIENTS_NAME, description: ingredientsDescription() }),
};

const aiCards = (areasFile.areas as unknown as Array<{ sections: Array<{ id: string; cards?: SpecCard[] }> }>)
  .flatMap((area) => area.sections).filter((section) => section.id === "ai").flatMap((section) => section.cards ?? []);
const glance = aiCards.find((card) => card.view === "ai.glance");
const specKeys = keysFile as unknown as SpecKey[];

function cardFor(job: AiJobId): SpecCard | undefined {
  const group = GROUPS[job];
  return aiCards.find((card) => card.group === group) ?? aiCards.find((card) => card.groups?.includes(group));
}

export const aiCopy: AiCopy = {
  card(job) {
    const hub = HUB_CARDS[job];
    if (hub) return hub;
    const card = cardFor(job);
    if (card && card !== glance) return { title: card.label, summary: card.description ?? "" };
    const listed = glance?.choices?.find((choice) => choice.id === job);
    return { title: listed?.label ?? job, summary: listed?.description ?? "" };
  },
  choice(id) {
    const hub = HUB_CHOICES[id];
    if (hub) return hub();
    if (id === "music.voice") return { label: "Sing a song in another voice", description: "Let a saved household voice sing a song you made or own." };
    if (id === "voice.realistic") return { label: "Realistic voice for recordings", description: "Use a more natural voice for recorded work, such as voiceovers and video lines. This is not for live chat and needs a large Mac." };
    const [job = "", name = ""] = id.split(".");
    const listed = cardFor(job as AiJobId)?.choices?.find((choice) => choice.id === `${job}-${name}`)
      ?? glance?.choices?.find((choice) => choice.id === `${job}-${name}`);
    if (listed) return { label: listed.label, description: listed.description };
    const quality = QUALITY_KEYS[job] ? specKeys.find((key) => key.key === QUALITY_KEYS[job]) : undefined;
    if (quality) { const tier = TIER_OF_CHOICE[name] ?? name; return { label: tier.charAt(0).toUpperCase() + tier.slice(1), description: quality.copy?.options?.[tier] ?? "" }; }
    const music = job === "music" ? specKeys.find((key) => key.key === "generation.music.enabled") : undefined;
    if (music) return { label: music.label, description: music.copy?.does ?? "" };
    return { label: id, description: "" };
  },
};

/** The sentence under an added chat model's name, from the AI card's copy in the spec. */
const glanceCard = (areasFile.areas as unknown as Array<{ sections: Array<{ cards?: Array<{ view?: string; copy?: Record<string, string> }> }> }>)
  .flatMap((area) => area.sections).flatMap((section) => section.cards ?? []).find((card) => card.view === "ai.glance");
export const ADDED_CHAT_DESCRIPTION = glanceCard?.copy?.added_description ?? "";
