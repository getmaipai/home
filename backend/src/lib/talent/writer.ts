import { z } from "zod";
import { completeBackground, type LlmMessage } from "@/lib/llm";
import { evaluateReply } from "@/lib/safety";
import { toSpokenText } from "@/lib/spokenText";
import { composePersonaPrompt } from "@/lib/persona";
import type { AgeBand } from "@/lib/ageBand";
import { contentChecksForFold } from "@/lib/pictures/minorLine";
import { foldForSafety } from "@maipai/spec/safety/ts/fold.js";
import { OutlineSchema, SegmentScriptSchema, type Brief, type Line, type Outline, type Script } from "./types";

export class TalentWriteError extends Error { constructor(message: string) { super(message); this.name = "TalentWriteError"; } }
export type Complete = typeof completeBackground;
let safetyCheck: typeof evaluateReply = evaluateReply;
let minorContentCheck: (text: string) => boolean = (text) => contentChecksForFold(foldForSafety(text)).adultContent;
export function __setTalentWriterSafetyForTests(value: typeof evaluateReply | null): void { safetyCheck = value ?? evaluateReply; }
export function __setTalentWriterMinorCheckForTests(value: ((text: string) => boolean) | null): void { minorContentCheck = value ?? ((text) => contentChecksForFold(foldForSafety(text)).adultContent); }
export const OUTLINE_PROMPT = `You are the producer of a short spoken show for one household. Plan the episode as JSON only, checked against the schema you are given. The format tells you the parts, the structure and the length in seconds. Size the segments so their seconds add up to within ten percent of the length. Each segment names what it is for, which sources it uses by id, how long it runs, which part leads it, and which of the cast's life lines (by id) it should touch, if any. Use only the sources in the brief. A cast member marked absent gets no segment to lead. If a cast member is marked returned, give the first exchange room for a short welcome back. The last segment of a scheduled show ends on tomorrow's hook. Title the episode in at most eight words.`;
export const SEGMENT_PROMPT = `You write the spoken lines of one segment of a show, as JSON only, checked against the schema. Rules. Use only the facts in the brief; a fact not in the brief is not said, opinion is fine and is the speaker's own. Quote outside voices as such ("the mayor said", "the paper reports"); never perform a real person who is not in the cast. No assistant phrasing, no "as an AI", no plugs, no sign-off except the show's own closing. People talk the way people talk: round numbers, hedges, a secondhand fact carries "they say" or "the report says", short acknowledgements. A reaction is one to six words. Interruptions: at most one in this segment when talk_over is light, two when lively, no cap when heated but each side keeps equal time and the moderator restores it. An interruption is written as timing.cut_in_at_word on the line being interrupted (the word number where the next speaker starts), overlap_ms between 250 and 700, talked_over yield when the speaker gives way or continue when they keep going under the other voice. A backchannel is a short word by another part under a long line at a word index. Mention a life line once, briefly, then move on; an absence is mentioned only in the first episode and on the return. A household fact is mentioned once, warmly, with no detail beyond the brief. The register is the part's; the personality is the speaker's. Write the words to be heard, not read: no headings, no lists, no URLs, no parentheses. Fit the seconds at the format's words per minute.`;

function responseFormat(schema: z.ZodType, name: string) {
  return { type: "json_schema" as const, json_schema: { name, schema: z.toJSONSchema(schema, { unrepresentable: "any" }) } };
}
function options(schema: z.ZodType, name: string, outline = false) {
  return { thinking: false as const, dropReasoning: true as const, temperature: outline ? 0.5 : 0.8, max_tokens: 1800, response_format: responseFormat(schema, name) };
}
async function completeSafely(complete: Complete, messages: LlmMessage[], opts: ReturnType<typeof options>): Promise<{ ok: true; text: string } | { ok: false }> {
  try { const reply = await complete(messages, opts); return reply.ok ? { ok: true, text: reply.text } : { ok: false }; }
  catch { return { ok: false }; }
}
function parse<T>(text: string, schema: z.ZodType<T>): T | null { try { return schema.parse(JSON.parse(text)); } catch { return null; } }
function allowedText(text: string, band: AgeBand): boolean { return safetyCheck({ text }, band).effective.action !== "refuse"; }
export function checkText(text: string, band: AgeBand): boolean { return allowedText(text, band); }
export function checkLines(lines: Line[], band: AgeBand, opts: { minorInCast: boolean }): { kept: Line[]; cut: number } {
  const kept: Line[] = []; let cut = 0, clearNextCutIn = false;
  for (const line of lines) {
    let evaluation: ReturnType<typeof evaluateReply> | null = null, minorRisk = false;
    try { evaluation = safetyCheck({ text: line.text, speech: toSpokenText(line.text) }, band); } catch { minorRisk = true; }
    if (opts.minorInCast) {
      try { minorRisk ||= minorContentCheck(line.text) || (evaluation?.effective.categories.includes("csam") ?? false); }
      catch { minorRisk = true; }
    }
    const refused = evaluation?.effective.action === "refuse" && (band !== "adult" || evaluation.effective.categories.includes("csam"));
    if (minorRisk || refused) { cut++; clearNextCutIn = line.timing.cut_in_at_word !== null; continue; }
    kept.push(clearNextCutIn ? { ...line, timing: { ...line.timing, cut_in_at_word: null } } : line);
    clearNextCutIn = false;
  }
  return { kept, cut };
}
function promptBrief(brief: Brief): string {
  return JSON.stringify({ ...brief, cast: brief.cast.map((member) => ({ ...member, minor_notice: member.minor ? "This synth is based on a minor." : undefined, absent: member.absent ? `absent: ${member.absent.text}; back: ${member.absent.back ?? "unknown"}` : null })) });
}
function validateOutline(raw: Outline, brief: Brief): Outline | null {
  const length = brief.show.show?.length_s ?? brief.format.length_s.default;
  const total = raw.segments.reduce((sum, segment) => sum + segment.seconds, 0);
  if (total < length * 0.9 || total > length * 1.1) return null;
  const title = checkText(raw.title, brief.audience) ? raw.title : `Episode ${brief.date}`;
  return { ...raw, title, segments: raw.segments.map((segment, index) => ({ ...segment, goal: checkText(segment.goal, brief.audience) ? segment.goal : `Segment ${index + 1}` })) };
}
function rescaleOutline(raw: Outline, brief: Brief): Outline | null {
  const length = brief.show.show?.length_s ?? brief.format.length_s.default, total = raw.segments.reduce((sum, segment) => sum + segment.seconds, 0);
  if (total <= 0) return null;
  const segments = raw.segments.map((segment) => ({ ...segment, seconds: Math.min(600, Math.max(8, Math.round(segment.seconds * length / total))) }));
  const drift = length - segments.reduce((sum, segment) => sum + segment.seconds, 0);
  const longest = segments.reduce((best, segment, index) => (segment.seconds > segments[best]!.seconds ? index : best), 0);
  segments[longest]!.seconds = Math.min(600, Math.max(8, segments[longest]!.seconds + drift));
  return { ...raw, segments };
}
export async function writeOutline(brief: Brief, complete: Complete = completeBackground): Promise<Outline> {
  const messages: LlmMessage[] = [{ role: "system", content: OUTLINE_PROMPT }, { role: "user", content: `Brief JSON:\n${promptBrief(brief)}` }];
  const repair = `The segment seconds did not add up to within ten percent of ${brief.show.show?.length_s ?? brief.format.length_s.default} seconds. Return a corrected outline whose segment seconds add up within that range.`;
  let lastParsed: Outline | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await completeSafely(complete, messages, options(OutlineSchema, "talent_outline", true));
    const raw = reply.ok ? parse(reply.text, OutlineSchema) : null;
    if (raw) { lastParsed = raw; const valid = validateOutline(raw, brief); if (valid) return valid; }
    messages.push({ role: "assistant", content: reply.ok ? reply.text : "" }, { role: "user", content: repair });
  }
  // The model is poor at adding up seconds (seen live 2026-11-07: both tries missed the range). A well-formed outline whose
  // seconds are only off is rescaled to the requested length, which is the same plan at the right size, never a failed episode.
  if (lastParsed) { const rescaled = rescaleOutline(lastParsed, brief); const valid = rescaled && validateOutline(rescaled, brief); if (valid) return valid; }
  throw new TalentWriteError("The outline could not be written. Try a shorter show or fewer topics.");
}
export async function writeSegment(brief: Brief, outline: Outline, index: number, complete: Complete = completeBackground, previous: Line[] = []): Promise<Line[]> {
  const segment = outline.segments[index];
  if (!segment) throw new TalentWriteError("This segment could not be written for this audience. Pick other sources or a different format.");
  const leads = brief.cast.map((member) => `Part ${member.part}:\n${composePersonaPrompt(member.persona, "spoken")}${member.minor ? "\nThis synth is based on a minor." : ""}`).join("\n\n");
  const refs = new Set(segment.source_refs);
  const sources = { stories: brief.stories.filter((story) => refs.has(story.id)), weather: refs.has("weather") ? brief.weather : null, household: refs.has("household") ? brief.household : [], documents: brief.documents, item: brief.item };
  const user = JSON.stringify({ brief: promptBrief(brief), sources, cards: brief.cards, beats: Object.fromEntries(Object.entries(brief.beats).map(([id, beats]) => [id, beats.filter((beat) => segment.beats_to_use.includes(beat.at))])), previous: previous.slice(-6), goal: segment.goal, seconds: segment.seconds, leads });
  const reply = await completeSafely(complete, [{ role: "system", content: `${SEGMENT_PROMPT}\n\n${leads}` }, { role: "user", content: user }], options(SegmentScriptSchema, "talent_segment"));
  const parsed = reply.ok ? parse(reply.text, SegmentScriptSchema) : null;
  if (!parsed) throw new TalentWriteError("This segment could not be written for this audience. Pick other sources or a different format.");
  const checked = checkLines(parsed.lines, brief.audience, { minorInCast: brief.cast.some((member) => member.minor) });
  if (checked.kept.length === 0) throw new TalentWriteError("This segment could not be written for this audience. Pick other sources or a different format.");
  return checked.kept;
}
export async function writeScript(brief: Brief, complete: Complete = completeBackground): Promise<Script> {
  const outline = await writeOutline(brief, complete), segments: Script["segments"] = []; let previous: Line[] = [];
  for (let index = 0; index < outline.segments.length; index++) {
    const plan = outline.segments[index]!;
    const lines = await writeSegment(brief, outline, index, complete, previous);
    segments.push({ kind: plan.kind, goal: plan.goal, lines });
    previous = [...previous, ...lines].slice(-6);
  }
  return { title: outline.title, segments };
}
