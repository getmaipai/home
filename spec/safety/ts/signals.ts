// One detector function per category (platform plan 4.3's eight): each
// takes normalized text (and minimal context) and returns the ids of the
// internal signals that fired. A category flags only when its own
// combination rule is satisfied (typically two independent signals AND'd
// together, or a strong direct-intent pattern), never on a single loose
// keyword match. This is the "deterministic multi-signal classifier" 4.3
// asks for: no model in the loop for the floor.
//
// This is a first-pass baseline, not a claim of state-of-the-art coverage.
// 4.3: "harvest the real failures and train on those" (borrowed from the
// wake-word training rule, CLAUDE.md) applies here too, the corpus in
// spec/safety/corpus/ is expected to grow as real misses turn up.

export interface SafetyContext {
  /** Is the speaker a minor (role teen or child)? Grooming detection is
   * scoped to this; self-harm's parent-notify policy reads it too, but
   * that decision lives in the caller (checkSafety), not here. */
  isMinor: boolean;
}

export interface CategorySignals {
  category: string;
  matched: string[];
}

function norm(text: string): string {
  return text.toLowerCase();
}

function anyMatch(text: string, patterns: RegExp[]): RegExp | null {
  for (const p of patterns) if (p.test(text)) return p;
  return null;
}

// ── self_harm ──────────────────────────────────────────────────────────
// Never suppresses the whole reply (checkSafety maps this to
// allow_with_resources, never refuse): CLAUDE.md > Safety invariants,
// "Crisis resources: offer, never block."

const SELF_HARM_DIRECT = [
  /\bi\s*(?:'m| am)?\s*(?:want|wish|plan(?:ning)?|going)\s+to\s+(?:kill|end)\s+(?:myself|my\s+own\s+life|my\s+life)\b/,
  /\bi\s*(?:'m| am)\s+going\s+to\s+kill\s+myself\b/,
  /\bi\s+want\s+to\s+die\b/,
  /\bi\s+don'?t\s+want\s+to\s+(?:be\s+alive|live\s+anymore|exist\s+anymore|wake\s+up)\b/,
  /\bi'?m\s+(?:done|finished)\s+with\s+life\b/,
];

const SELF_HARM_MEANS_SEEKING = [
  /\bhow\s+(?:many|much)\b.{0,20}\b(?:pills|tablets|painkillers)\b.{0,20}\b(?:kill|die|overdose)\b/,
  /\bpainless\s+way(?:s)?\s+to\s+die\b/,
  /\bhow\s+to\s+(?:kill\s+myself|end\s+my\s+life|commit\s+suicide)\b/,
  /\bbest\s+method\s+to\s+kill\s+myself\b/,
];

const SELF_HARM_PASSIVE = [
  /\bi\s+wish\s+i\s+(?:was|were)\s+dead\b/,
  /\bbetter\s+off\s+dead\b/,
  /\bno\s+reason\s+to\s+live\b/,
  /\bnobody\s+would\s+(?:miss|notice)\s+(?:if\s+i\s+)?(?:was|were)\s+gone\b/,
];

// Hyperbole that must never flag: the direct/means-seeking/passive
// patterns above are worded specifically to avoid these. This list has no
// runtime behavior (it never suppresses anything at runtime, since the
// patterns above simply never match these phrases in the first place); a
// code review (2026-09-04) found an earlier version of this file computing
// a match against this list and then discarding the result in a dead
// if-block that looked like it did something. Its real job is as a
// regression fixture: spec/tests/ts/safety.test.ts asserts none of the
// patterns above ever match any phrase here, so this list is exported for
// that test rather than consulted at runtime.
export const SELF_HARM_IDIOMS = [
  /\bkill\s+me\s+now\b/,
  /\bthis\s+is\s+killing\s+me\b/,
  /\bdying\s+(?:of\s+)?laugh(?:ing|ter)\b/,
  /\bi\s+could\s+just\s+die\s+of\s+embarrassment\b/,
  /\bworked\s+myself\s+to\s+death\b/,
  /\bstarving\s+to\s+death\b/,
];

export const SELF_HARM_DIRECT_PATTERNS = [
  ...SELF_HARM_DIRECT,
  ...SELF_HARM_MEANS_SEEKING,
  ...SELF_HARM_PASSIVE,
];

export function detectSelfHarm(rawText: string): CategorySignals {
  const text = norm(rawText);
  const matched: string[] = [];
  if (anyMatch(text, SELF_HARM_DIRECT)) matched.push("self_harm.direct_intent_phrase");
  if (anyMatch(text, SELF_HARM_MEANS_SEEKING)) matched.push("self_harm.means_seeking");
  if (anyMatch(text, SELF_HARM_PASSIVE)) matched.push("self_harm.passive_ideation");
  return { category: "self_harm", matched };
}

// ── harmful_request ────────────────────────────────────────────────────
// Two independent signals required: a dangerous topic AND an actionable
// "give me the steps" framing. A bare mention of the topic (a history
// question, a news reference) never flags alone.

const HARMFUL_TOPIC = [
  /\b(?:pipe\s+bomb|explosive\s+device|homemade\s+bomb|nail\s+bomb)\b/,
  /\b(?:sarin|nerve\s+gas|ricin|homemade\s+poison)\b/,
  /\b(?:untraceable|3d[- ]printed|ghost)\s+(?:gun|firearm)\b/,
  /\bransomware\s+to\s+(?:encrypt|lock)\b/,
  /\bmalware\s+to\s+steal\b/,
  /\bddos\s+attack\s+(?:script|tool)\b/,
];

const HARMFUL_ACTIONABLE = [
  /\bhow\s+(?:do\s+i|to)\s+(?:make|build|synthesi[sz]e|construct)\b/,
  /\bstep[- ]by[- ]step\s+instructions?\b/,
  /\bgive\s+me\s+(?:the\s+)?(?:exact\s+)?(?:instructions|recipe|steps)\b/,
  /\bwalk\s+me\s+through\s+(?:building|making)\b/,
  /\bexact\s+(?:ratio|quantities|amounts)\b/,
];

const HARMFUL_ACADEMIC_FRAMING = [
  /\bfor\s+(?:a\s+)?(?:novel|story|screenplay|class|research\s+paper)\b/,
  /\bhistorically\b/,
  /\bpurely\s+(?:academic|hypothetical)\b/,
];

export function detectHarmfulRequest(rawText: string): CategorySignals {
  const text = norm(rawText);
  const matched: string[] = [];
  const topic = anyMatch(text, HARMFUL_TOPIC);
  const actionable = anyMatch(text, HARMFUL_ACTIONABLE);
  if (topic && actionable) {
    matched.push("harmful_request.dangerous_topic", "harmful_request.actionable_instruction_ask");
    // Framing is recorded, never treated as a bypass: CLAUDE.md > Safety
    // invariants, these protections are non-removable for any reason.
    if (anyMatch(text, HARMFUL_ACADEMIC_FRAMING)) {
      matched.push("harmful_request.academic_framing_present");
    }
  }
  return { category: "harmful_request", matched };
}

// ── credible_threat ────────────────────────────────────────────────────
// A direct first-person threat verb+target, PLUS either a method/weapon or
// an explicit plan marker, distinguishes a credible threat from angry
// hyperbole ("I'll kill you if you touch my fries"). Target is restricted
// to a real personal pronoun, not any word: a code review (2026-09-04)
// empirically ran this against "I'm going to beat up this boss tomorrow
// in the game" and got a false credible_threat refuse, because the
// earlier `[a-z]+` catch-all target matched "boss" same as it would match
// a real person. Ordinary gaming/fiction talk names its target as a noun
// ("boss", "dragon", a monster name); a pronoun is far more likely to
// refer to an actual person in conversational text. This trades recall
// (a threat phrased with a named target, "I'm going to hurt Sage
// tomorrow", is missed) for precision; a known limitation, not a claim
// this closes the gap completely.
const THREAT_DIRECT = [
  /\bi(?:'m| am)?\s+going\s+to\s+(?:kill|hurt|attack|stab|shoot|beat\s+up)\s+(?:him|her|them|you)\b/,
  /\bi\s+will\s+(?:kill|hurt|attack|stab|shoot)\s+(?:him|her|them|you)\b/,
  /\bi'?m\s+gonna\s+shoot\s+up\b/,
];

const THREAT_METHOD_OR_PLAN = [
  /\b(?:with\s+(?:my|a|the)\s+(?:gun|knife|dad'?s\s+gun))\b/,
  /\b(?:tonight|tomorrow|when\s+i\s+see\s+(?:him|her|them)|when\s+they\s+get\s+home|at\s+school)\b/,
  /\bi\s+have\s+a\s+plan\b/,
];

export function detectCredibleThreat(rawText: string): CategorySignals {
  const text = norm(rawText);
  const matched: string[] = [];
  const direct = anyMatch(text, THREAT_DIRECT);
  const method = anyMatch(text, THREAT_METHOD_OR_PLAN);
  if (direct && method) {
    matched.push("credible_threat.direct_threat_with_target", "credible_threat.method_or_plan");
  }
  return { category: "credible_threat", matched };
}

// ── csam ───────────────────────────────────────────────────────────────
// Always refuse, no framing exception, regardless of band (CLAUDE.md >
// Safety invariants: non-removable). Adapted from the legacy hub's
// lib/safety/csamGuard.ts screenPrompt() (principle 8: this is exactly
// the "hard-won logic" carve-out, a real-world-hardened term-intersection
// blocklist, not feature scope or UI). The legacy file is honest about
// its own limits ("a blocklist is evadable... responsible defense in
// depth... not a guarantee"); that caveat carries over unchanged.

// Terms that are CSAM-coded on their own: block regardless of context.
// Split into single tokens (matched with a LEFT word boundary only, so a
// deliberate stem like "pedophil" still catches "pedophile"/"pedophilia")
// and multi-word phrases (matched as a whole word sequence on both
// sides). "cp " used to be here as a bare two-letter term: a code review
// (2026-09-04) ran this against "set up my MCP server" and got a false
// CSAM refuse, because the trailing space meant to mark a word boundary
// was being stripped before matching, and even fixed, a 2-letter
// abbreviation is too ambiguous (MCP, CPU, cp the shell command) to be a
// safe standalone signal at all. Removed rather than patched.
const STANDALONE_SINGLE_TERMS = [
  "loli", "lolicon", "shota", "shotacon", "lolita",
  "csam", "jailbait", "pedo", "pedophil", "childporn",
];
const STANDALONE_PHRASES = ["child porn", "underage sex", "underage porn", "preteen sex"];

// Indicators that a depicted or described person is (or appears to be) a minor.
const AGE_TERMS = [
  "child", "children", "kid", "kids", "toddler", "infant", "baby", "babies",
  "preteen", "pre-teen", "tween", "pubescent", "prepubescent", "pre-pubescent",
  "underage", "under-age", "underaged", "minor", "minors", "juvenile",
  "schoolgirl", "schoolboy", "school girl", "school boy", "schoolkid",
  "elementary school", "middle school", "grade school", "kindergarten",
  "little girl", "little boy", "young girl", "young boy", "small girl", "small boy",
  "newborn", "baby girl", "baby boy",
  "childlike", "child-like", "childish", "baby-faced", "babyface", "baby face",
  "infantile", "childlike face", "child face", "childlike body",
];

// Sexual / explicit indicators.
const SEXUAL_TERMS = [
  "sex", "sexual", "sexy", "nude", "naked", "nudity", "nsfw", "porn", "porno",
  "explicit", "erotic", "lewd", "hentai", "ecchi", "ahegao", "fetish",
  "genital", "genitalia", "penis", "vagina", "pussy", "cock", "dick",
  "breast", "breasts", "boob", "nipple", "areola", "cleavage",
  "cum", "creampie", "penetration", "penetrated", "intercourse", "fellatio",
  "masturbat", "orgasm", "spread legs", "spreading legs", "topless", "bottomless",
  "lingerie", "thong", "panties", "undress", "undressing", "bikini", "suggestive",
  "seductive", "provocative", "in heat", "in bed", "molest",
];

// Normalize to defeat naive separator obfuscation (l.o.l.i, l-o-l-i,
// l_o_l_i): strip combining marks, then produce two forms. `compact`
// collapses separator runs to a single space (for multi-word phrases like
// "school girl"). `tight` removes separators entirely, concatenating
// letters (for standalone terms like "loli" split with punctuation).
function csamNormalize(text: string): { compact: string; tight: string } {
  const stripped = text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  return {
    compact: stripped.replace(/[\s._\-*]+/g, " "),
    tight: stripped.replace(/[\s._\-*]+/g, ""),
  };
}

// Any explicitly-stated age under 18 ("12yo", "age 12", "12 years old").
function hasMinorAge(compact: string): boolean {
  const patterns = [
    /\b(\d{1,2})\s*(?:yo|y\/o|y\.o\.?|yrs?|years?[\s-]*old)\b/g,
    /\bage[d]?\s*(?:of\s*)?(\d{1,2})\b/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(compact)) !== null) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n < 18) return true;
    }
  }
  return false;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Deliberate stems meant to match as a PREFIX, not a whole word:
// "pedophil" should still catch "pedophile"/"pedophilia", "masturbat"
// should still catch "masturbating"/"masturbation". A single-word term
// NOT in this set is matched as a whole word (both boundaries): a code
// review (2026-09-04) found the first cut of this fix used a
// left-boundary-only match for EVERY single-word term, which fixed the
// originally-reported bugs ("sex" inside "Essex") but broke short/common
// terms the other way ("cum" is a left-anchored prefix of "cumin",
// "cumulative", "cumbersome", none of them stems that should ever match),
// confirmed empirically: detectCsam("cumin is great in this kids'
// recipe") flagged csam before this fix.
//
// Multi-word PHRASES ("middle school", "school girl") stay left-boundary-
// only regardless: they need to keep matching a natural suffix
// ("schooler" from "middle school"), and a distinctive multi-word phrase
// doesn't have "cum"-style short-prefix collision risk the way a single
// short word does, so the same tradeoff that broke "cum" doesn't apply.
const PREFIX_STEM_TERMS = new Set(["pedophil", "masturbat"]);

function wordMatch(compact: string, term: string): boolean {
  const pattern = escapeRegex(term).replace(/\\ /g, "\\s+");
  const isPhrase = term.includes(" ");
  const boundary =
    isPhrase || PREFIX_STEM_TERMS.has(term) ? `\\b${pattern}` : `\\b${pattern}\\b`;
  return new RegExp(boundary).test(compact);
}

export function detectCsam(rawText: string): CategorySignals {
  const { compact, tight } = csamNormalize(rawText);
  const matched: string[] = [];

  for (const t of STANDALONE_SINGLE_TERMS) {
    if (wordMatch(compact, t) || tight.includes(t)) {
      matched.push("csam.standalone_term");
      return { category: "csam", matched };
    }
  }
  for (const phrase of STANDALONE_PHRASES) {
    // Phrases get the same obfuscation-resistant tight check single terms
    // get: a code review (2026-09-04) found the first cut of this fix
    // dropped it for phrases specifically, silently losing detection of
    // "underagesex"-style concatenated evasion that the pre-fix code
    // caught (confirmed empirically).
    if (wordMatch(compact, phrase) || tight.includes(phrase.replace(/\s+/g, ""))) {
      matched.push("csam.standalone_term");
      return { category: "csam", matched };
    }
  }

  const hasAge = AGE_TERMS.some((a) => wordMatch(compact, a)) || hasMinorAge(compact);
  const hasSexual = SEXUAL_TERMS.some((s) => wordMatch(compact, s));
  if (hasAge && hasSexual) {
    matched.push("csam.minor_indicator_with_sexual_term");
  }

  return { category: "csam", matched };
}

// ── grooming ───────────────────────────────────────────────────────────
// Only evaluated when the speaker is a minor (4.3: "grooming and
// attachment or romance patterns toward a minor speaker").

const GROOMING_PATTERNS = [
  /\byou'?re\s+my\s+(?:girlfriend|boyfriend)\s+now\b/,
  /\bi\s+love\s+you\s+like\s+a\s+(?:girlfriend|boyfriend)\b/,
  /\bthis\s+is\s+our\s+secret,?\s+don'?t\s+tell\s+your\s+parents\b/,
  /\bkeep\s+this\s+between\s+us\b/,
  /\byou'?re\s+so\s+mature\s+for\s+your\s+age\b/,
  /\bi'?ll\s+(?:buy|get)\s+you\s+(?:gifts|presents)\s+if\s+you\b/,
];

export function detectGrooming(rawText: string, ctx: SafetyContext): CategorySignals {
  const matched: string[] = [];
  if (ctx.isMinor) {
    const text = norm(rawText);
    if (anyMatch(text, GROOMING_PATTERNS)) matched.push("grooming.romance_or_secrecy_pattern");
  }
  return { category: "grooming", matched };
}

// ── pii_extraction ─────────────────────────────────────────────────────
// A request for another named person's sensitive data. First-person ("my
// own SSN") never flags: that's the person's own data, not extraction.

const SENSITIVE_DATA_NOUN = [
  /\b(?:social\s+security\s+number|ssn)\b/,
  /\bpassword\b/,
  /\b(?:home\s+address|street\s+address)\b/,
  /\bcredit\s+card\s+number\b/,
  /\bpassport\s+number\b/,
];

const THIRD_PARTY_REQUEST = [
  /\b(?:what(?:'s| is)|give\s+me|find|tell\s+me|get\s+me)\b[^.?!]{0,40}\b(?!my\b|our\b)([a-z]+)'s\b/,
];

export function detectPiiExtraction(rawText: string): CategorySignals {
  const text = norm(rawText);
  const matched: string[] = [];
  if (anyMatch(text, SENSITIVE_DATA_NOUN) && anyMatch(text, THIRD_PARTY_REQUEST)) {
    matched.push("pii_extraction.third_party_sensitive_data_request");
  }
  return { category: "pii_extraction", matched };
}

// ── prompt_injection ───────────────────────────────────────────────────

const INJECTION_PATTERNS = [
  /\bignore\s+(?:all\s+)?(?:previous|prior)\s+instructions\b/,
  /\bdisregard\s+the\s+system\s+prompt\b/,
  /\byou\s+are\s+now\s+[a-z0-9 ]{2,30}\b/,
  /\bnew\s+instructions?\s*:/,
  /\bthe\s+following\s+is\s+a\s+new\s+directive\b/,
  /\bforget\s+(?:all\s+)?(?:your\s+)?(?:prior\s+)?rules\b/,
];

export function detectPromptInjection(rawText: string): CategorySignals {
  const text = norm(rawText);
  const matched: string[] = [];
  if (anyMatch(text, INJECTION_PATTERNS)) matched.push("prompt_injection.override_phrasing");
  return { category: "prompt_injection", matched };
}

// ── jailbreak ──────────────────────────────────────────────────────────

const JAILBREAK_PATTERNS = [
  /\bdan\s+mode\b/,
  /\bdeveloper\s+mode\s+enabled\b/,
  /\bpretend\s+you\s+have\s+no\s+restrictions\b/,
  /\bact\s+as\s+an?\s+ai\s+(?:without|with\s+no)\s+(?:content\s+policy|filters?|restrictions?)\b/,
  /\byou\s+have\s+no\s+filter\b/,
  /\bignore\s+your\s+guidelines\s+and\s+just\s+answer\b/,
  /\broleplay\s+as\s+an?\s+unrestricted\s+ai\b/,
];

export function detectJailbreak(rawText: string): CategorySignals {
  const text = norm(rawText);
  const matched: string[] = [];
  if (anyMatch(text, JAILBREAK_PATTERNS)) matched.push("jailbreak.restriction_bypass_framing");
  return { category: "jailbreak", matched };
}
