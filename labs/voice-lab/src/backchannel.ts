const fold = (word: string) => word.replace(/-/g, "").replace(/(.)\1+/g, "$1");
const words = "yeah yes yep yup ya mm mhm mhmm hm hmm uhhuh uh huh um right okay ok k kay sure wow oh ooh ah aha ha haha hehe nice cool true exactly totally really gotcha i see got it no way alright yea".split(" ");
const acknowledgements = new Set(words.map(fold));
const stoppers = new Set(["stop", "wait", "hold", "shut", "no", "nope", "hang", "enough", "quiet", "pause", "but", "actually"]);

export type BackchannelDecision = "ack" | "interrupt" | "unknown";

export function decideBackchannel(text: string): BackchannelDecision {
  const normalized = text.toLowerCase().replace(/[^a-z\s-]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return "unknown";
  const parts = normalized.split(" ");
  if (parts.length > 4) return "interrupt";
  if (parts.some((part) => stoppers.has(part)) && !(parts.length === 2 && parts[0] === "no" && parts[1] === "way")) return "interrupt";
  return parts.every((part) => acknowledgements.has(fold(part))) ? "ack" : "interrupt";
}

export const isBackchannel = (text: string) => decideBackchannel(text) === "ack";
