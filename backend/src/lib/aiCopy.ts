// The words of the AI job cards, read from the spec (rule S5): a card's title and sentence come from its card in
// spec/settings/areas.json, a choice's label and sentence from that card's `choices` or, for the Quick and Detailed
// choices and the music switch, from the key that holds the setting. Nothing is written here.
import areasFile from "@maipai/spec/settings/areas.json";
import keysFile from "@maipai/spec/settings/keys.json";
import type { AiCopy, AiJobId } from "../../../shared/aiChoices";

interface SpecCard { label: string; group?: string; description?: string; choices?: Array<{ id: string; label: string; description: string }> }
interface SpecKey { key: string; label: string; copy?: { does?: string; options?: Record<string, string> } }

const GROUPS: Record<AiJobId, string> = {
  chat: "household.ai_chat", pictures: "household.ai_pictures", videos: "household.ai_videos",
  music: "household.ai_music", voice: "household.ai_voice", coding: "household.ai_coding",
};
const QUALITY_KEYS: Record<string, string> = { pictures: "generation.picture_quality", videos: "generation.video_quality" };

const aiCards = (areasFile.areas as unknown as Array<{ sections: Array<{ id: string; cards?: SpecCard[] }> }>)
  .flatMap((area) => area.sections).filter((section) => section.id === "ai").flatMap((section) => section.cards ?? []);
const specKeys = keysFile as unknown as SpecKey[];

export const aiCopy: AiCopy = {
  card(job) {
    const card = aiCards.find((candidate) => candidate.group === GROUPS[job]);
    return { title: card?.label ?? job, summary: card?.description ?? "" };
  },
  choice(id) {
    const [job = "", name = ""] = id.split(".");
    const listed = aiCards.find((candidate) => candidate.group === GROUPS[job as AiJobId])?.choices?.find((choice) => choice.id === `${job}-${name}`);
    if (listed) return { label: listed.label, description: listed.description };
    const quality = QUALITY_KEYS[job] ? specKeys.find((key) => key.key === QUALITY_KEYS[job]) : undefined;
    if (quality) return { label: name.charAt(0).toUpperCase() + name.slice(1), description: quality.copy?.options?.[name] ?? "" };
    const music = job === "music" ? specKeys.find((key) => key.key === "generation.music.enabled") : undefined;
    if (music) return { label: music.label, description: music.copy?.does ?? "" };
    return { label: id, description: "" };
  },
};
