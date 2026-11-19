// Is what the person said over the reply only an acknowledgement ("mm-hm", "yeah, okay"), or a real interruption?
// Words are compared after folding spelling variants: hyphens removed and repeated letters collapsed, so
// "Mm-hmm", "mhm", "mmm" and "uh huh" all land on the same few forms.
const fold = (word: string) => word.replace(/-/g, "").replace(/(.)\1+/g, "$1");
const WORDS = "yeah yes yep yup ya mm mhm mhmm hm hmm uhhuh uh huh um right okay ok k kay sure wow oh ooh ah aha ha haha hehe nice cool true exactly totally really gotcha i see got it no way alright yea".split(" ");
const BACKCHANNELS = new Set(WORDS.map(fold));
// Said alone or anywhere in the phrase, these mean "stop talking".
const STOPPERS = new Set(["stop", "wait", "hold", "shut", "no", "nope", "hang", "enough", "quiet", "pause", "but", "actually"]);
export function isBackchannel(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[^a-z\s-]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return true;
  const words = normalized.split(" ");
  if (words.length > 4) return false;
  if (words.some((word) => STOPPERS.has(word))) {
    // "no way" is an acknowledgement; a bare "no" is not.
    if (!(words.length === 2 && words[0] === "no" && words[1] === "way")) return false;
  }
  return words.every((word) => BACKCHANNELS.has(fold(word)));
}
