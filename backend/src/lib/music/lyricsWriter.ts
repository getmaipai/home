import { complete } from "@/lib/llm";
import { visibleText } from "@/lib/wellFormed";
import { refuseMusicPrompt } from "./policy";

export async function writeSongLyrics(input: { description: string; seconds: number; language?: string; title?: string }): Promise<string | null> {
  const sections = Math.max(1, Math.ceil(input.seconds / 30));
  const messages = [
    { role: "system" as const, content: "Write original song lyrics for a family music app from the person's description, in the language of the description (or the language field when given). Use section tags [Verse], [Chorus], [Verse], [Chorus], [Bridge], [Chorus] as the length allows. The chorus has a short memorable hook that repeats. Use short singable lines. Never use real artists' names, lyrics or melodies. Reply with the lyrics only, no title line, no commentary, no markdown fences." },
    { role: "user" as const, content: `Description: ${input.description}\nLanguage: ${input.language ?? "the language of the description"}\n${input.title ? `Song title: ${input.title}\n` : ""}Write about ${Math.max(8, sections * 8)} short lines, for a song about ${input.seconds} seconds long.` },
  ];
  try {
    const result = await complete("chat", messages, { temperature: 0.8 });
    if (!result.ok) return null;
    const lyrics = visibleText(result.value.text).trim().slice(0, 3500).trim();
    return lyrics && !refuseMusicPrompt(lyrics) ? lyrics : null;
  } catch { return null; }
}
