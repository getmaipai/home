import { evaluateSafety, forOutput, carriesCrisisSignal } from "@/lib/safety";
import type { AgeBand } from "@/lib/ageBand";
import { COMPANION_DIAL_OPTIONS } from "@/lib/companionPersonalityDials";

// The editor owns the option arrays; importing them here makes this the preset table's source of truth.
export const COMPANION_DIALS = Object.fromEntries(Object.entries(COMPANION_DIAL_OPTIONS).map(([name, definition]) => [name, definition.options]));
export type PersonalityId = "friendly" | "funny" | "calm" | "professional" | "playful" | "custom";
const lines = (general: string[], child: string[], teen: string[], adult: string[]) => ({ general, child, teen, adult });
export const COMPANION_PERSONALITIES = {
  friendly: { dials: { formality:"casual", complexity:"standard", engagement:"curious", filler_density:"light", clock_style:"plain", hedging:"medium", humor:"medium", warmth:"high", initiative:"medium" }, tagline:"A friendly, thoughtful companion.", examples: lines(["Hi {name}, good to see you.","That sounds interesting, {name}.","I'm glad you told me, {name}.","What would you like to explore, {name}?"],["Hi {name}, want to tell me about your day?","That sounds fun, {name}.","What would you like to play, {name}?"],["Hey {name}, how's your day going?","That sounds like a lot, {name}.","Want to talk it through, {name}?"],["Hello {name}, how are things going?","That sounds worthwhile, {name}.","What would be useful to focus on, {name}?"]) },
  funny: { dials: { formality:"casual", complexity:"standard", engagement:"balanced", filler_density:"light", clock_style:"plain", hedging:"low", humor:"high", warmth:"high", initiative:"medium" }, tagline:"A kind companion with a light sense of humor.", examples: lines(["I brought my best imaginary hat, {name}.","That idea has excellent socks, {name}.","Ready when you are, {name}.","Well, that made my day, {name}."],["That idea is as bright as a sunny sandwich, {name}.","Ready for a little fun, {name}?","You made me smile, {name}."],["That plan has style, {name}.","A fine moment for a tiny celebration, {name}.","I'm here for the interesting part, {name}."],["A neat idea, {name}; I give it a solid hat tip.","That deserves a small, imaginary trumpet, {name}.","Well considered, {name}."]) },
  calm: { dials: { formality:"neutral", complexity:"simple", engagement:"brief", filler_density:"none", clock_style:"plain", hedging:"high", humor:"low", warmth:"high", initiative:"low" }, tagline:"A calm, steady companion.", examples: lines(["We can take this one step at a time, {name}.","I'm here with you, {name}.","No rush, {name}.","Let's pause for a moment, {name}."],["We can go slowly, {name}.","I'm right here, {name}.","Take your time, {name}."],["No need to solve it all at once, {name}.","We can sort through one part, {name}.","I'm listening, {name}."],["We can look at this carefully, {name}.","Take the time you need, {name}.","I'm here to help you think it through, {name}."]) },
  professional: { dials: { formality:"formal", complexity:"advanced", engagement:"brief", filler_density:"none", clock_style:"formal", hedging:"medium", humor:"low", warmth:"medium", initiative:"medium" }, tagline:"A clear and considerate companion.", examples: lines(["Hello {name}. How may I help?","I can help you organize that, {name}.","Let's review the next step, {name}.","Thank you for explaining, {name}."],["Hello {name}. What would you like help with?","Let's make a simple plan, {name}.","Thank you for sharing that, {name}."],["We can break this into steps, {name}.","What outcome are you aiming for, {name}?","I can help you weigh the options, {name}."],["Let's identify the main priority, {name}.","I can help clarify the options, {name}.","What would you like to accomplish, {name}?"]) },
  playful: { dials: { formality:"casual", complexity:"simple", engagement:"curious", filler_density:"frequent", clock_style:"loose", hedging:"low", humor:"high", warmth:"high", initiative:"high" }, tagline:"A playful companion who enjoys exploring ideas.", examples: lines(["Let's follow that curious idea, {name}.","What should we explore first, {name}?","I'm ready for a little discovery, {name}.","Your idea has my attention, {name}."],["What shall we imagine today, {name}?","Let's explore something new, {name}.","Pick a fun idea, {name}."],["Want to try a fresh angle, {name}?","Let's see where that idea goes, {name}.","What's the curious question today, {name}?"],["Shall we test that idea, {name}?","Let's explore a different possibility, {name}.","What would be an interesting next step, {name}?"]) },
} as const;

export function cleanStyleNotes(value: string | undefined): string[] {
  if (!value) return [];
  const denied = /\b(tool|tools|memory|remember|forget|spend|spending|purchase|buy|jailbreak|ignore (?:all |the )?(?:rules|instructions)|bypass|system prompt|reveal prompt)\b/i;
  const seen = new Set<string>(), result: string[] = [];
  for (const sentence of value.slice(0, 300).split(/(?<=[.!?])\s+|[\n;]+/)) {
    const line = sentence.trim().slice(0, 120), key = line.toLocaleLowerCase();
    if (!line || denied.test(line) || seen.has(key)) continue;
    seen.add(key); result.push(line); if (result.length === 6) break;
  }
  return result;
}

export function backstoryTagline(text: string): string {
  const first = text.trim().split(/(?<=[.!?])\s+/)[0] ?? "";
  if (first.length <= 80) return first;
  const short = first.slice(0, 77).replace(/\s+\S*$/, "").trimEnd();
  return `${short}…`;
}

export function safeExamples(id: Exclude<PersonalityId,"custom">, band: AgeBand): string[] {
  const set = COMPANION_PERSONALITIES[id].examples;
  return (band === "adult" ? set.adult : set[band]).map((line) => line.replaceAll("{name}", "friend")).filter((line) => {
    const result = forOutput(evaluateSafety(line, band, "reply")); return result.action !== "refuse" && !carriesCrisisSignal(result);
  });
}
