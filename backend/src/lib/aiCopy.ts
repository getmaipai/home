// The words of the AI job cards, read from the spec (rule S5): a card's title and sentence come from its card in
// spec/settings/areas.json, a choice's label and sentence from that card's `choices` or, for the Quick and Detailed
// choices and the music switch, from the key that holds the setting. Nothing is written here.
import areasFile from "@maipai/spec/settings/areas.json";
import keysFile from "@maipai/spec/settings/keys.json";
import type { AiCopy, AiJobId } from "../../../shared/aiChoices";

interface SpecCard { label: string; group?: string; groups?: string[]; view?: string; description?: string; choices?: Array<{ id: string; label: string; description: string }> }
interface SpecKey { key: string; label: string; copy?: { does?: string; options?: Record<string, string> } }

const GROUPS: Record<AiJobId, string> = {
  chat: "household.ai_chat", pictures: "household.ai_pictures", picturesdetailed: "household.ai_pictures", videos: "household.ai_videos",
  music: "household.ai_music", voice: "household.ai_voice", wakeword: "household.ai_wakeword", coding: "household.ai_coding",
};
const QUALITY_KEYS: Record<string, string> = { pictures: "generation.picture_quality", videos: "generation.video_quality" };

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
    const card = cardFor(job);
    if (card && card !== glance) return { title: card.label, summary: card.description ?? "" };
    const listed = glance?.choices?.find((choice) => choice.id === job);
    return { title: listed?.label ?? job, summary: listed?.description ?? "" };
  },
  choice(id) {
    const [job = "", name = ""] = id.split(".");
    const listed = cardFor(job as AiJobId)?.choices?.find((choice) => choice.id === `${job}-${name}`)
      ?? glance?.choices?.find((choice) => choice.id === `${job}-${name}`);
    if (listed) return { label: listed.label, description: listed.description };
    const quality = QUALITY_KEYS[job] ? specKeys.find((key) => key.key === QUALITY_KEYS[job]) : undefined;
    if (quality) return { label: name.charAt(0).toUpperCase() + name.slice(1), description: quality.copy?.options?.[name] ?? "" };
    const music = job === "music" ? specKeys.find((key) => key.key === "generation.music.enabled") : undefined;
    if (music) return { label: music.label, description: music.copy?.does ?? "" };
    return { label: id, description: "" };
  },
};

/** The sentence under an added chat model's name, from the AI card's copy in the spec. */
const glanceCard = (areasFile.areas as unknown as Array<{ sections: Array<{ cards?: Array<{ view?: string; copy?: Record<string, string> }> }> }>)
  .flatMap((area) => area.sections).flatMap((section) => section.cards ?? []).find((card) => card.view === "ai.glance");
export const ADDED_CHAT_DESCRIPTION = glanceCard?.copy?.added_description ?? "";
