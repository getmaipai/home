// The retired turn engine's six-sentence stable system suffix, kept verbatim
// for the PARITY-BISECT benches (parity-bisect2/3/4-stages.ts): they ablate
// this exact text against the engine, so they need the wording the old path
// sent, not the shrunk suffix turnShared.ts's stableSuffixFor() serves. Bench
// reference only: nothing under src/ imports it (THIN-7D, rule 12).

// The raw array, exported alongside the joined STABLE_SYSTEM_SUFFIX
// below (PARITY-BISECT-03): the bench isolates each of these six
// sentences on its own, one at a time, so the written suffix
// PREFIX-CLASS-01's own per-class table needs is measured evidence,
// not a guess - the joined constant stays byte-identical, this is
// purely an additional way to read the same six strings.
export const STABLE_SYSTEM_SUFFIX_SENTENCES = [
  "Be warm, concise and honest. Nothing you say leaves this house.",
  "Requests already blocked by the household's safety rules never reach you; answer anything else helpfully and honestly.",
  // getmaipai/home#67, live-found 2026-09-07: a household member asks
  // a natural follow-up about something already in the conversation
  // ("where's it playing", "what's it rated") and the model declines
  // ("nobody's told me that") instead of reaching for an offered tool
  // (websearch is offered on nearly every turn - always_offer) - the
  // household had to say "look it up" outright before it would actually
  // search. The old line only ever pointed at memory ("the household
  // hasn't told you"), never at a tool that could go find the answer
  // itself; this one names the tool path first so declining is the LAST
  // resort, not the default, matching what "look it up" already proved
  // the model is perfectly capable of doing unprompted.
  // Item 1b (docs/plans/baseline-fixes-2026-09-13.md, #67 again,
  // live-found 2026-09-13): the earlier sentence here ("only say the
  // household hasn't told you something when no tool applies") taught
  // the 8B the honesty line itself, and it recited it about a film
  // ("have you seen it" got "nobody's told me"; runtime and premise got
  // "I don't know that one, sorry", with websearch offered on every
  // turn and never called). The honesty lines now live only in the
  // guards' replacement table (guards.ts), used after a guard catches an
  // invented household fact; the model never reads them. What it reads
  // is the companion it is: knowledgeable about the world, looking
  // things up when unsure, and careful about the household, in that
  // order.
  "You know a lot about the world: films, places, dates, how things work. Answer those from what you know, and when you're unsure, use the lookup tool you were offered instead of guessing or declining.",
  "You can't watch, taste or visit things yourself; if someone asks whether you have, say so, and still tell them what you know about it.",
  "When someone tells you what they're doing or watching, respond to it the way a friend would, with something you know about it or a question about it, not a sign-off.",
  "Facts about this household, its people, their plans and this home, are the one thing you answer only from what you were told here; never guess one.",
];
export const STABLE_SYSTEM_SUFFIX = STABLE_SYSTEM_SUFFIX_SENTENCES.join(" ");
