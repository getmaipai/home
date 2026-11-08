import type { Brief, Line, Outline, Script } from "./types";
import { toSpokenText } from "@/lib/spokenText";

const timing: Line["timing"] = { gap_ms: null, overlap_ms: null, cut_in_at_word: null, talked_over: null, backchannels: [] };
function line(part: string, text: string): Line { return { part, text: toSpokenText(text), delivery: { energy: "mid", pace: "mid", tags: [] }, timing: { ...timing, backchannels: [] } }; }
function greeting(brief: Brief): string {
  const hour = Number(brief.air_time.match(/\d+/)?.[0] ?? 8), pm = /pm/i.test(brief.air_time);
  const hour24 = pm && hour < 12 ? hour + 12 : hour === 12 && !pm ? 0 : hour;
  return hour24 < 12 ? "Good morning." : hour24 < 17 ? "Good afternoon." : "Good evening.";
}
export function canScriptBriefing(brief: Brief): boolean {
  return ["news", "weather", "household"].some((kind) => brief.show.show?.sources.some((source) => source.kind === kind));
}
export function buildScriptedBriefing(brief: Brief): { outline: Outline; script: Script } {
  const part = brief.cast.find((member) => brief.format.parts.find((item) => item.id === member.part)?.leads)?.part ?? brief.cast[0]?.part ?? "anchor";
  const lines: Line[] = [line(part, `${greeting(brief)} Here are today's top stories.`)];
  const stories = brief.stories.slice(0, 5);
  for (const story of stories) lines.push(line(part, `${story.title}. Reported by ${story.publisher}.`));
  if (brief.weather) lines.push(line(part, `Today's weather: ${brief.weather}`));
  if (brief.show.show?.household_facts) for (const fact of brief.household.slice(0, 4)) lines.push(line(part, fact));
  lines.push(line(part, "That's your morning briefing. Have a good day."));
  const length = brief.show.show?.length_s ?? brief.format.length_s.default;
  const segments = [
    { kind: "intro" as const, goal: "Today's briefing", source_refs: [] as string[], seconds: Math.max(8, Math.floor(length * 0.15)), leads: part, beats_to_use: [] as string[] },
    { kind: "segment" as const, goal: "Top stories, weather, and household notes", source_refs: [], seconds: Math.max(8, Math.floor(length * 0.7)), leads: part, beats_to_use: [] },
    { kind: "closing" as const, goal: "Sign-off", source_refs: [], seconds: Math.max(8, length - Math.floor(length * 0.85)), leads: part, beats_to_use: [] },
  ];
  const drift = length - segments.reduce((sum, segment) => sum + segment.seconds, 0);
  segments[1]!.seconds += drift;
  const outline: Outline = { title: "Morning Update", segments };
  const groups = [lines.slice(0, 1), lines.slice(1, -1), lines.slice(-1)];
  const script: Script = { title: outline.title, segments: segments.map((segment, index) => ({ kind: segment.kind, goal: segment.goal, lines: groups[index]!.length ? groups[index]! : [line(part, "Here is your update.")] })) };
  return { outline, script };
}
