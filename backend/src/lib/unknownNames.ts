// ASK-01 (docs/dev.md, "The chat design pass", section 3; docs/dev/
// session-a.md "ASK-01"): the unknown-name rule. A name the hub has
// never heard is asked about, never assumed, and the answer creates the
// entity as the person stated it. Three pieces, one module, all
// deterministic: the turn-time resolver (which names an utterance
// carries, which of them the household knows, which are framed as
// household and so get the engine's own question), the question's
// text, and the parser that reads the answer ("he's our rabbit", "my
// cousin, she teaches piano") into step 3a's own creation and confirm
// paths. Neither the chat model nor the judge model decides whether a
// name is known or what it is.
//
// The tagger is `compromise` (MIT), a maintained dependency through bun
// (the org's prebuilt rule), never a copied word list: its proper-noun
// tags find the candidates, the frames below decide what the engine
// does with them. CHAT-13's subject stack reuses this resolver.
import nlp from "compromise";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";
import { entityKindNouns, kindForNoun, relationshipTypes } from "@maipai/spec/records/ts/validate.js";
import { db } from "@/db";
import { entities, memoryRecords, relationships } from "@/db/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import { createEntity, deleteEntity, toEntity, updateEntity } from "@/lib/entities";
import { deleteRelationship, promoteToStated } from "@/lib/relationships";
import { ensureSubjectEntity, kindForRelation, RELATION_PHRASES, writeRelation } from "@/lib/subjects";
import { nextHlc } from "@/lib/hlc";
import type { Entity } from "@maipai/spec/gen/ts/entity.js";
import type { PersonRow } from "@/types";

export type EntityKind = "person" | "pet" | "place" | "organization" | "thing";

/** SPEC-01's SubjectRef (spec/schemas/subject-ref.schema.json), as a
 * structural type: the generated binding is a `oneOf` refinement over
 * `any`, which types nothing for a consumer, so the three variants are
 * spelled here once and checked against the schema by
 * tests/unknownNames.test.ts's round trip through the binding. */
export type SubjectRef =
  | { type: "household"; entity_id: string; carried_question: string | null }
  | { type: "world"; kind: string; display_name: string; year: number | null; source_kind: "web" | "wikidata" | "wikipedia" | "weather" | "package" | null; stable_key: string | null; recency: "current" | "dated" | "unknown"; carried_question: string | null }
  | { type: "unresolved"; surface_form: string; candidate_kinds: EntityKind[]; provenance: string; confidence: number; carried_question: string | null };

/** A name the turn could not resolve, with what the utterance said
 * about it. `ask` is true when the utterance frames the name as
 * household (the coherence review's amendment: a relation phrase, "my"
 * or "our" in its clause, a pronoun for it in the same turn, or the
 * roster's own shape) and no noun settled its kind: the engine asks.
 * A bare proper noun with no frame is unresolved with no ask (a film,
 * a band, a place in the world); the judge's open question catches a
 * household inference about it later. */
export interface UnknownName {
  name: string;
  hintedKinds: EntityKind[];
  ask: boolean;
  /** The third-person pronoun the person used for it this turn, when
   * one did ("Nadia ... her marathon"). */
  pronoun: "he" | "she" | "they" | null;
}

export interface ResolvedNames {
  /** SPEC-01's shape: a household ref per known name (the entity the
   * turn resolved), an unresolved ref per unknown one. */
  subjects: SubjectRef[];
  unknown: UnknownName[];
}

export interface KnownNames {
  /** The household's display names and nicknames, and the speaker's
   * registry names and aliases (people and pets, places and things). */
  names: readonly string[];
  /** The entity id a known name resolves to, or null (a member with no
   * entity yet resolves through the caller's own ensure path). */
  resolveEntity: (name: string) => string | null;
}

// A sentence-initial capitalized word compromise leaves as a plain
// noun is a name only when nothing else claims it; these never are.
const NOT_A_NAME = new Set([
  "i", "he", "she", "they", "we", "you", "it", "me", "him", "her", "them", "us", "my", "our", "your", "his", "their", "its",
  "everyone", "everybody", "someone", "somebody", "nobody", "anyone", "people", "who", "what", "when", "where", "why", "how",
  "that", "this", "these", "those", "the", "a", "an", "and", "but", "so", "then", "well", "also", "ok", "okay", "yes", "no", "yeah", "nope",
  "hey", "hi", "hello", "thanks", "thank", "please", "sorry", "wait", "oh", "hmm", "um", "uh", "yep", "sure", "right", "maybe",
  "today", "tomorrow", "yesterday", "tonight", "morning", "evening", "afternoon", "night", "weekend", "week", "month", "year",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "mom", "dad", "mum", "mother", "father", "grandma", "grandpa", "nana", "papa",
  "dinner", "lunch", "breakfast", "remember", "remind", "set", "add", "tell", "turn", "play", "call", "text", "what's", "whats",
  "can", "could", "would", "should", "will", "do", "does", "did", "is", "are", "was", "were", "have", "has", "had", "let", "let's",
]);

const THIRD_PERSON_PRONOUN_RE = /(?<![\p{L}])(he|him|his|she|her|hers|they|them|their|theirs)(?![\p{L}])/giu;

function pronounFamily(word: string): "he" | "she" | "they" | null {
  const w = word.toLowerCase();
  if (w === "he" || w === "him" || w === "his") return "he";
  if (w === "she" || w === "her" || w === "hers") return "she";
  if (w === "they" || w === "them" || w === "their" || w === "theirs") return "they";
  return null;
}

/** The pronoun families the person used in this text ("he", "she",
 * "they"), for the guards' pronoun check and the unknown's own hint. */
export function pronounFamiliesIn(text: string): Set<"he" | "she" | "they"> {
  const found = new Set<"he" | "she" | "they">();
  for (const m of text.matchAll(THIRD_PERSON_PRONOUN_RE)) {
    const f = pronounFamily(m[1]!);
    if (f) found.add(f);
  }
  return found;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function namePattern(name: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, "iu");
}

/** Every noun a relation phrase or an answer can carry: the kind
 * vocabulary's nouns and the relationship vocabulary's own said_as
 * nouns ("my cousin", "our dog"), one set, read from the spec. */
let relationNounCache: Map<string, { kind: EntityKind | undefined; type: string | null }> | null = null;
function relationNouns(): Map<string, { kind: EntityKind | undefined; type: string | null }> {
  if (relationNounCache) return relationNounCache;
  const nouns = new Map<string, { kind: EntityKind | undefined; type: string | null }>();
  for (const type of relationshipTypes()) {
    for (const phrase of type.said_as ?? []) {
      const [head, ...rest] = phrase.split(" ");
      if ((head === "my" || head === "our") && rest.length === 1 && /^[a-z-]+$/.test(rest[0]!)) {
        const noun = rest[0]!;
        nouns.set(noun, { kind: kindForNoun(noun) ?? kindForRelation(type.id), type: type.id });
      }
    }
  }
  for (const entry of entityKindNouns()) {
    for (const noun of entry.nouns) {
      if (!nouns.has(noun)) nouns.set(noun, { kind: entry.kind, type: null });
    }
  }
  relationNounCache = nouns;
  return nouns;
}

let relationNounRes: RegExp[] | null = null;
/** Three shapes, each its own pass so one match never eats the next
 * ("my sister Nadia's dog Rover" is Nadia, a person, and Rover, a
 * dog): a head then the name ("my cousin Clover", "the dog Rover"),
 * another name's possessive then the name ("Nadia's dog Rover"), and
 * the name then the speaker's phrase ("Clover, my cousin"). The head
 * is the speaker's own ("my", "our") or a bare article (a kind with no
 * relation of the speaker's). A name never ends in a possessive. */
function relationNounPatterns(): RegExp[] {
  if (relationNounRes) return relationNounRes;
  const alternatives = [...relationNouns().keys()].sort((a, b) => b.length - a.length).map(escapeRe).join("|");
  const name = "(?<name>\\p{Lu}[\\p{L}-]*(?:\\s+\\p{Lu}[\\p{L}-]*)*)(?![\\p{L}])";
  const nouns = `(?<noun>${alternatives})(?:'s\\s+(?<inner>${alternatives}))?`;
  relationNounRes = [
    new RegExp(`(?<![\\p{L}])(?<head>my|our|the|a|an)\\s+(?:[a-z-]+\\s+)?${nouns},?\\s+${name}`, "giu"),
    new RegExp(`(?<![\\p{L}])(?<head>\\p{Lu}[\\p{L}]+'s)\\s+(?:[a-z-]+\\s+)?${nouns},?\\s+${name}`, "giu"),
    // The connector is required: "Tell Nadia my phone is broken" is a
    // verb and its object, not Nadia's phone (a review).
    new RegExp(`${name}(?:,|\\s+(?:is|who is|who's))\\s+(?<head>my|our)\\s+(?:[a-z-]+\\s+)?${nouns}(?![\\p{L}])`, "giu"),
  ];
  return relationNounRes;
}

interface RelationFrame {
  name: string;
  noun: string;
  kind: EntityKind | undefined;
  type: string | null;
}

/** The relation phrases beside a name in the text ("my cousin Clover"):
 * the noun nearest the name decides ("our neighbor's dog Juniper" is a
 * dog). */
export function relationFramesIn(text: string): RelationFrame[] {
  const plain = text.replace(/[\u2018\u2019]/g, "'");
  const frames: RelationFrame[] = [];
  for (const re of relationNounPatterns()) {
    for (const m of plain.matchAll(re)) {
      const name = m.groups?.name ?? "";
      if (!name || NOT_A_NAME.has(name.toLowerCase()) || frames.some((f) => f.name === name)) continue;
      // The innermost noun ("neighbor's dog": dog), else the head noun.
      const headNoun = (m.groups?.noun ?? "").toLowerCase();
      const noun = (m.groups?.inner ?? headNoun).toLowerCase();
      const info = relationNouns().get(noun);
      if (!info) continue;
      // The relation type is the head noun's, and only when the head is
      // the innermost noun and the phrase is the speaker's own: "my
      // neighbor's dog" and "the dog" state no relation of the speaker's.
      const own = /^(?:my|our)$/i.test(m.groups?.head ?? "");
      frames.push({ name, noun, kind: info.kind, type: own && noun === headNoun ? info.type : null });
    }
  }
  return frames;
}

/** Whether the clause of the signal that holds this offset carries a
 * first-person possessive ("Clover borrowed our tent"). */
function possessiveInClause(text: string, at: number, signal: TurnSignal | undefined): boolean {
  const clause = signal?.clauses.find((c) => at >= c.range.start && at < c.range.end);
  const span = clause ? text.slice(clause.range.start, clause.range.end) : text;
  return /(?<![\p{L}])(?:my|our)(?![\p{L}])/iu.test(span);
}

/** "Clover and I", "me and Clover", "Pippa and Clover", "Clover's": the
 * shapes a household member's own name takes in family talk. */
function rosterShapeAround(text: string, name: string, knownInText: readonly string[]): boolean {
  const n = escapeRe(name);
  const withMe = `(?:i|me|we${knownInText.length > 0 ? `|${knownInText.map(escapeRe).join("|")}` : ""})`;
  return new RegExp(`(?<![\\p{L}])${n}(?:'s|’s)(?![\\p{L}])|(?<![\\p{L}])${n}\\s+and\\s+${withMe}(?![\\p{L}])|(?<![\\p{L}])${withMe}\\s+and\\s+${n}(?![\\p{L}])`, "iu").test(text);
}

// A kind noun in front of a name says it is the world's ("the band
// Tempo", "the film Cobra"): never a household unknown, whatever else
// the sentence carries.
const WORLD_KIND_RE = /(?<![\p{L}])(?:the|a|an|that|this)\s+(?:new\s+|latest\s+|old\s+)?(?:band|film|movie|show|series|game|album|song|track|book|novel|author|artist|singer|actor|actress|director|team|club|brand|app|podcast|channel|company|store|chain|restaurant|city|town|country|place|character|hero|villain|comic|cartoon)\s+$/iu;
function worldFramed(text: string, at: number): boolean {
  return WORLD_KIND_RE.test(text.slice(0, at));
}

interface Candidate {
  name: string;
  at: number;
  tokens: number;
}

/** The proper nouns the tagger finds, plus a sentence-initial
 * capitalized word it left as a plain noun (the tagger cannot tell
 * "Clover borrowed" from "Dinner is"; the frames below can). Multi-word
 * spans stay whole ("Marsh Lantern" is one name, never the roster's
 * Marsh). */
function candidatesIn(text: string): Candidate[] {
  const doc = nlp(text);
  const terms = doc.terms().json({ offset: true }) as Array<{ terms: Array<{ tags: string[] }>; offset: { start: number; length: number } }>;
  const sentenceStarts = new Set((doc.sentences().json({ offset: true }) as Array<{ offset: { start: number } }>).map((s) => s.offset.start));
  const out: Candidate[] = [];
  let open: Candidate | null = null;
  const close = () => {
    if (open) out.push(open);
    open = null;
  };
  for (const term of terms) {
    const tags = new Set(term.terms[0]?.tags ?? []);
    const raw = text.slice(term.offset.start, term.offset.start + term.offset.length);
    const word = raw.replace(/[^\p{L}\p{N}'’-]+$/u, "").replace(/^[^\p{L}\p{N}]+/u, "");
    const capitalized = /^\p{Lu}/u.test(word);
    const proper = tags.has("ProperNoun") && capitalized && !tags.has("Date") && !tags.has("Pronoun");
    const initialNoun = !proper && capitalized && sentenceStarts.has(term.offset.start) && tags.has("Noun") && !tags.has("Pronoun") && !tags.has("Date") && !tags.has("Possessive");
    const bare = word.replace(/(?:'s|’s)$/u, "");
    // The possessive comes off before the filter ("Grandma's" is
    // Grandma, a review).
    if ((proper || initialNoun) && bare.length >= 2 && !NOT_A_NAME.has(bare.toLowerCase())) {
      if (open && !/[,.;:!?]/.test(text.slice(open.at, term.offset.start))) {
        open = { name: `${open.name} ${bare}`, at: open.at, tokens: open.tokens + 1 };
      } else {
        close();
        open = { name: bare, at: term.offset.start, tokens: 1 };
      }
      continue;
    }
    close();
  }
  close();
  return out;
}

/** Resolves the names an utterance carries before the model runs. */
export function resolveNames(text: string, signal: TurnSignal | undefined, known: KnownNames, provenance: string): ResolvedNames {
  const subjects: SubjectRef[] = [];
  const unknown: UnknownName[] = [];
  const seen = new Set<string>();
  const knownLower = new Map(known.names.filter((n) => n.trim().length > 1).map((n) => [n.trim().toLowerCase(), n.trim()]));
  const frames = relationFramesIn(text);
  const pronouns = pronounFamiliesIn(text);
  const candidates = candidatesIn(text);
  // The signal's own named subjects (a relation phrase's name, a
  // report's source) join the tagger's, so "my sister Nadia says" is
  // never missed at the start of a sentence.
  for (const clause of signal?.clauses ?? []) {
    if (clause.subject.kind === "named" && clause.subject.name && !candidates.some((c) => c.name.toLowerCase() === clause.subject.name!.toLowerCase())) {
      const at = text.search(namePattern(clause.subject.name));
      if (at >= 0 && !NOT_A_NAME.has(clause.subject.name.toLowerCase())) candidates.push({ name: clause.subject.name, at, tokens: clause.subject.name.split(/\s+/).length });
    }
  }
  // A known name anywhere in the text (a member's nickname the tagger
  // never saw as a name, a lowercase pet), for the household refs and
  // the pronoun frame: a pronoun beside a known name is theirs.
  // A roster name inside a longer proper noun is not the household
  // ("the new Marsh Lantern album"; asksAboutHousehold()'s rule).
  const insideLonger = (n: string) => candidates.some((c) => c.tokens > 1 && namePattern(n).test(c.name) && c.name.toLowerCase() !== n.toLowerCase());
  const knownInText = [...knownLower.values()].filter((n) => namePattern(n).test(text) && !insideLonger(n));
  for (const c of candidates) {
    const key = c.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const knownName = knownLower.get(key);
    if (knownName) {
      const id = known.resolveEntity(knownName);
      if (id) subjects.push({ type: "household", entity_id: id, carried_question: null });
      continue;
    }
    // A roster name inside a longer proper noun is the world's
    // ("the new Marsh Lantern album"), never a household unknown.
    const frame = frames.find((f) => f.name.toLowerCase() === key);
    const hinted = frame?.kind ? [frame.kind] : [];
    // A personal pronoun ("he", "she") for it in the same turn frames
    // it as household when no known name could be what the pronoun
    // refers to; "they" does not (a band, a company, a crowd).
    // Only on a statement: a question about a public figure carries
    // a pronoun too ("what did Shakespeare write before he died"), and
    // is the world's (a review).
    const personal = [...pronouns].filter((p) => p !== "they");
    const clauseAct = signal?.clauses.find((cl) => c.at >= cl.range.start && c.at < cl.range.end)?.act ?? signal?.primary_act;
    const statement = clauseAct !== "question" && clauseAct !== "directive";
    const framed =
      frame !== undefined ||
      (c.tokens === 1 && !worldFramed(text, c.at) && (possessiveInClause(text, c.at, signal) || rosterShapeAround(text, c.name, knownInText) || (statement && personal.length > 0 && knownInText.length === 0)));
    subjects.push({ type: "unresolved", surface_form: c.name, candidate_kinds: hinted, provenance, confidence: framed ? 0.8 : 0.4, carried_question: null });
    const pronoun = personal.length === 1 && knownInText.length === 0 ? personal[0]! : null;
    unknown.push({ name: c.name, hintedKinds: hinted, ask: framed && c.tokens === 1 && hinted.length === 0, pronoun });
  }
  for (const knownName of knownInText) {
    if (seen.has(knownName.toLowerCase())) continue;
    seen.add(knownName.toLowerCase());
    const id = known.resolveEntity(knownName);
    if (id) subjects.push({ type: "household", entity_id: id, carried_question: null });
  }
  return { subjects, unknown };
}

/** The name an ask's subject id refers to, for the person: an entity's
 * own name, or the far end of a relationship from the person's entity. */
export function framedName(subjectId: string | null | undefined, personId: string): string | null {
  if (!subjectId) return null;
  if (subjectId.startsWith("ent-")) return entityRow(subjectId)?.name ?? null;
  if (!subjectId.startsWith("rel-")) return null;
  const edge = db.select().from(relationships).where(and(eq(relationships.id, subjectId), isNull(relationships.deletedAt))).get();
  if (!edge) return null;
  const self = db.select({ id: entities.id }).from(entities).where(and(eq(entities.accountPersonId, personId), isNull(entities.deletedAt))).get()?.id ?? null;
  const otherId = edge.fromId === self ? edge.toId : edge.fromId;
  return entityRow(otherId)?.name ?? null;
}

// The bare shape of an answer to a question that has not been put yet
// ("he's our rabbit", "she is my sister", "that's our dog", or just "my
// cousin", "a friend from work"): a pronoun for the name and a
// copula, then a noun phrase; or nothing but the noun phrase. Narrow
// on purpose (a review: "my sister is visiting tomorrow" and "my dog
// is sick" are statements of their own, never the answer to a question
// nobody asked); a statement that names anybody else is its own turn.
const PRONOUN_ANSWER_RE = /^(?:(?:oh|well|ok(?:ay)?|hmm|yes|yeah|actually)[,\s]+)*(?:he|she|they|it|that|this)(?:'s| is| was|'re| are)\s+(?:(?:a|an|the|my|our|one of my|one of our)\s+)?(?:(?!(?:and|but|or|so)\b)[a-z-]+\s+)?((?!(?:and|but|or|so)\b)[a-z-]+)/i;
const BARE_NOUN_ANSWER_RE = /^(?:(?:oh|well|ok(?:ay)?|hmm|actually)[,\s]+)*(?:a|an|the|my|our|one of my|one of our)\s+(?:[a-z-]+\s+)?([a-z-]+)(?:\s+(?:from|at|of)\s+[a-z-]+)?\s*[.!]?$/i;
export function looksLikeWhoAnswer(text: string, name: string): boolean {
  const plain = text.trim().replace(/[‘’]/g, "'");
  if (plain.split(/\s+/).length > 14) return false;
  const others = candidatesIn(plain).filter((c) => c.name.toLowerCase() !== name.toLowerCase());
  if (others.length > 0) return false;
  const m = PRONOUN_ANSWER_RE.exec(plain) ?? BARE_NOUN_ANSWER_RE.exec(plain);
  if (!m) return false;
  return relationNouns().has(m[1]!.toLowerCase());
}

/** Step 3a's amendment (ASK-01 part 4): whether the speaker's own words
 * state the kind of the named entity, not only its name: a kind noun
 * beside the name ("my coworker Quill", "the dog Rover", "Nadia's cat
 * Pip"). A name with no noun is the model's kind guess: an inferred
 * entity and an open question, never knowledge. */
export function speakerStatedKind(userText: string, name: string, kind: EntityKind): boolean {
  // The guess the rule guards against is a person or a pet (the kinds
  // the guards treat as household subjects and the prompt labels); a
  // place, an organization or a thing the speaker named is stated by
  // the name alone, as before (a review: "we went to Lakeview Park"
  // must not queue "Who's Lakeview Park?").
  if (kind !== "person" && kind !== "pet") return true;
  return relationFramesIn(userText).some((f) => f.name.toLowerCase() === name.trim().toLowerCase() && f.kind === kind);
}

/** The engine's own question about a name: never a kind guess. */
export function whoQuestion(name: string): string {
  return `Who's ${name}?`;
}

/** The context line for the names the person framed as household and
 * the hub has never heard: one line, ahead of the memory section, so
 * the model cannot mistake the trust reminder for knowing them. */
export function unknownNamesLine(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const list = names.join(", ");
  const who = names.length === 1 ? `who or what ${names[0]} is` : "who or what they are";
  return `Names in this message you have never heard before: ${list}. You don't know ${who}: don't guess, and don't claim to remember.`;
}

const QUESTION_SENTENCE_RE = /\?\s*$/;

/** Whether the reply already asks who or what the name is (a question
 * sentence naming it and asking who, what or which), so the engine
 * adds nothing. "How is Clover doing?" is chit-chat, not the ask (a
 * review: its answer was bound as the person's statement of who). */
export function replyAsksAbout(reply: string, name: string): boolean {
  const re = namePattern(name);
  return reply
    .split(/(?<=[.!?])\s+/)
    .some((s) => QUESTION_SENTENCE_RE.test(s.trim()) && re.test(s) && /(?<![\p{L}])(?:who|what|which)(?![\p{L}])/iu.test(s));
}

// ==== The answer parser ====

const DECLINE_RE =
  /^(?:(?:no|nah|nope|oh|ok(?:ay)?|actually|hmm)[,\s]+)*(?:never ?mind(?: (?:that|it|about it|him|her|them))?|forget (?:it|that|him|her|them|about it)|not now|not right now|later|maybe later|doesn'?t matter|it doesn'?t matter|don'?t worry(?: about it)?|skip (?:it|that)|no ?one|nobody|drop it|leave it|no thanks|no thank you|stop|none of your business|i'?d rather not(?: say)?|no|nope|nah)\s*[.!]?$/i;
const YES_RE = /^(?:(?:oh|well|ok(?:ay)?|hmm)[,\s]+)*(?:yes|yeah|yep|yup|correct|right|exactly|that'?s right|she is|he is|they are|it is|sure(?: is)?|mhm|uh[- ]?huh)\s*[.!]?$/i;
const NO_RE = /^(?:(?:oh|well|hmm)[,\s]+)*(?:no|nope|nah|not really|wrong|that'?s wrong|not quite)\b/i;
const ANSWER_LEAD_RE = /^(?:(?:oh|well|ok(?:ay)?|hmm|no|nope|nah|yes|yeah|actually)[,\s]+)*(?:(?:he|she|they|it|that|this)(?:'s|’s| is| was|'re|’re| are)\s+|(?:he's|she's|they're|it's)\s+)?/i;
const ANSWER_LEAD_FULL_RE = /^(?:(?:oh|well|ok(?:ay)?|hmm|no|nope|nah|yes|yeah|actually|not really|wrong)[,\s]+)*(?:(?:he|she|they|it|that|this|that one|this one|\p{Lu}[\p{L}-]*)(?:'s|’s| is| was|'re|’re| are|'d be| would be)\s+(?:just\s+|only\s+|actually\s+)?)?$/iu;

export interface WhoAnswer {
  kind: EntityKind | undefined;
  /** The relationship type the answer stated from the speaker's side
   * ("my cousin": relative_of), or null. */
  relationType: string | null;
  noun: string | null;
  pronouns: "he" | "she" | "they" | null;
  /** The specific word and what else was said, for the description. */
  description: string | null;
  /** A bare yes or no to a question that proposed a relation. */
  verdict: "yes" | "no" | null;
}

/** Reads the person's answer to "Who's X?" / "Is X your coworker?".
 * Null when the parser cannot read it (a new subject, a question of
 * their own): the ask is cleared and the model answers the turn.
 * `declined` is a cancel ("never mind", "not now"): no entity, no
 * second ask. */
export function parseWhoAnswer(text: string, name?: string, opts: { relationAsked?: boolean } = {}): WhoAnswer | "declined" | null {
  const plain = text.trim().replace(/[‘’]/g, "'");
  // A bare no to "Is Raven your coworker?" is the answer (the guess
  // goes), never a cancel (a review); to "Who's Clover?" it declines.
  if (opts.relationAsked && /^(?:(?:oh|well|hmm)[,\s]+)*(?:no|nope|nah|not really|wrong|that'?s wrong|not quite)\s*[.!]?$/i.test(plain)) {
    return { kind: undefined, relationType: null, noun: null, pronouns: null, description: null, verdict: "no" };
  }
  if (DECLINE_RE.test(plain)) return "declined";
  // A bare yes answers "Is Raven your coworker?"; to "Who's Clover?"
  // it says nothing and is unreadable (a review: "sure" was "Got it.").
  if (YES_RE.test(plain)) return opts.relationAsked ? { kind: undefined, relationType: null, noun: null, pronouns: null, description: null, verdict: "yes" } : null;
  const pronounSet = pronounFamiliesIn(plain);
  const pronouns = pronounSet.size === 1 ? [...pronounSet][0]! : null;
  // "my cousin", "our rabbit", "a friend from work", "the neighbor's dog".
  const alternatives = [...relationNouns().keys()].sort((a, b) => b.length - a.length).map(escapeRe).join("|");
  const phrase = new RegExp(`(?<![\\p{L}])(my|our|a|an|the|one of my|one of our)\\s+(?:[a-z-]+\\s+)?(${alternatives})(?:'s\\s+(${alternatives}))?(?![\\p{L}])`, "iu").exec(plain);
  const verdict = NO_RE.test(plain) ? "no" : null;
  if (!phrase) return verdict ? { kind: undefined, relationType: null, noun: null, pronouns, description: null, verdict } : null;
  // The phrase sits where an answer puts it: first, or after a
  // lead-in and a pronoun with its copula ("no, she is my sister").
  // Anything else in front ("turn on the office lights", "tell Nadia
  // my phone is broken") is a turn of its own, never the answer (a
  // review: a command was read as "Clover is a office").
  if (!ANSWER_LEAD_FULL_RE.test(plain.slice(0, phrase.index))) return verdict ? { kind: undefined, relationType: null, noun: null, pronouns, description: null, verdict } : null;
  const head = phrase[2]!.toLowerCase();
  const noun = (phrase[3] ?? phrase[2]!).toLowerCase();
  const info = relationNouns().get(noun);
  if (!info) return null;
  const owned = /^(?:my|our|one of my|one of our)$/i.test(phrase[1]!);
  // A relation only from the speaker's side ("my cousin"); "a rabbit"
  // and "the neighbor's dog" state a kind and no relation of theirs.
  const relationType = owned && noun === head ? info.type : null;
  // What else was said, after the phrase: "she teaches piano".
  const before = plain.slice(0, phrase.index).replace(ANSWER_LEAD_RE, "").trim();
  const after = plain
    .slice(phrase.index + phrase[0].length)
    .replace(/^[\s,;:.!-]+/, "")
    .replace(/^(?:and|who|that|-)\s+/i, "")
    .trim();
  // The name itself is not a description of it ("my coworker Nadia").
  const withoutName = (s: string) => (name ? s.replace(namePattern(name), "").replace(/^[\s,.]+|[\s,.]+$/g, "").replace(/\s+,/g, ",") : s);
  const rest = [before, after]
    .map(withoutName)
    // The copula the name's own lead leaves behind ("Nadia is my
    // sister": "is") is not a description.
    .map((part) => part.replace(/^(?:'s|is|was|are|'re|were)\s*$/i, ""))
    .filter((s) => s.length > 0 && !/^[.!?]*$/.test(s))
    .join(", ")
    .replace(/[.!]+$/, "");
  const description = rest.length > 0 ? `${noun}, ${rest}` : noun;
  return { kind: info.kind, relationType, noun, pronouns, description, verdict };
}

export interface WhoAnswerOutcome {
  entity: Entity | null;
  /** The candidate of the wrong kind the answer retired, when one was. */
  replacedEntityId?: string;
  /** What the hub says back: a one-line acknowledgment naming what it
   * learned, never a guess. */
  reply: string;
}

function displayName(name: string): string {
  return name.length > 0 ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

/** Applies a read answer through step 3a's own paths: the entity the
 * person answered about is `local` (ensureSubjectEntity with stated),
 * the relation `stated` (writeRelation), a candidate confirmed
 * (updateEntity confirm, promoteToStated), and the pronouns set from
 * the answer's own pronoun. A candidate of another kind than the
 * person stated is replaced by one of the stated kind, its records
 * re-pointed and its edges that no longer fit removed: the person's
 * word wins over the judge's guess, and no ghost of the guess stays. */
export function applyWhoAnswer(speaker: PersonRow, pending: { name: string; subjectId?: string | null }, answer: WhoAnswer, turnId: string): WhoAnswerOutcome {
  const name = pending.name;
  const subjectId = pending.subjectId ?? null;
  const candidateEdge = subjectId?.startsWith("rel-") ? (db.select().from(relationships).where(and(eq(relationships.id, subjectId), isNull(relationships.deletedAt))).get() ?? null) : null;
  let entity: Entity | null = null;
  let replacedEntityId: string | undefined;
  // "yes" to "Is Raven your coworker?": the candidate edge is stated
  // by the person now, and the entity it points at confirmed.
  if (answer.verdict === "yes" && candidateEdge) {
    promoteToStated(speaker, candidateEdge.id);
    const otherId = candidateEdge.fromId === selfEntityId(speaker) ? candidateEdge.toId : candidateEdge.fromId;
    entity = confirmCandidateEntity(speaker, otherId, answer.pronouns);
    return { entity, reply: `Got it.` };
  }
  if (answer.verdict === "no" && candidateEdge && !answer.kind) {
    // "no" alone: the guess goes, the entity stays unconfirmed.
    deleteRelationship(speaker, candidateEdge.id);
    return { entity: null, reply: "Okay, scratch that." };
  }
  if (answer.verdict === "no" && candidateEdge) deleteRelationship(speaker, candidateEdge.id);
  if (!answer.kind) return { entity: null, reply: "Got it." };

  // The engine's own ask carries no subject; by the time the person
  // answers, the judge may have made its candidate for the name (an
  // inferred entity with its own open question). That candidate is the
  // one the answer is about (a review), so it is confirmed or replaced
  // rather than a second entity made beside it.
  const candidateEntityId = subjectId?.startsWith("ent-") ? subjectId : candidateEdge ? (candidateEdge.fromId === selfEntityId(speaker) ? candidateEdge.toId : candidateEdge.fromId) : (candidateByName(speaker, name)?.id ?? null);
  const candidate = candidateEntityId ? entityRow(candidateEntityId) : null;
  const candidateUnconfirmed = candidate !== null && candidate.source === "inferred" && candidate.confirmedByPersonId === null;
  if (candidate && candidate.kind !== answer.kind && candidateUnconfirmed) {
    // The stated kind wins over the guess: a new local entity first,
    // then the records and edges follow it and the guess is retired
    // (a review: nothing is deleted before the replacement exists). A
    // confirmed or stated entity of another kind is not a guess and
    // is left as it is.
    const made = createFreshEntity(speaker, name, answer.kind);
    if (made) {
      repointEntity(candidate.id, made.id, answer.kind);
      deleteEntity(speaker, candidate.id);
      entity = made;
      replacedEntityId = candidate.id;
    }
  } else if (candidate && candidate.kind !== answer.kind) {
    entity = entityRowToEntity(candidate.id);
  } else if (candidate) {
    entity = confirmCandidateEntity(speaker, candidate.id, null);
  } else {
    const made = ensureSubjectEntity(speaker, { name: displayName(name), kind: answer.kind }, true);
    entity = made.ok && made.value ? made.value : null;
  }
  if (!entity) return { entity: null, reply: "Got it." };
  const edit: { pronouns?: string; description?: string } = {};
  if (answer.pronouns) edit.pronouns = answer.pronouns;
  if (answer.description && !entity.description) edit.description = answer.description;
  if (Object.keys(edit).length > 0) {
    const updated = updateEntity(speaker, entity.id, edit);
    if (updated.ok && updated.value) entity = updated.value;
  }
  if (answer.relationType) {
    const result = writeRelation(speaker, { type: answer.relationType, name, stated: true }, entity, turnId, 1);
    if (!result.ok) console.error(`[ask] relation ${answer.relationType} for ${entity.id} failed: ${result.error}`);
  }
  const what = answer.relationType && answer.noun ? `your ${answer.noun}` : answer.noun ? `a ${answer.noun}` : answer.kind;
  return { entity, ...(replacedEntityId ? { replacedEntityId } : {}), reply: `Got it, ${entity.name} is ${what}.` };
}

/** The speaker's own unconfirmed inferred entity of this name, or null. */
export function candidateByName(speaker: PersonRow, name: string): { id: string } | null {
  const wanted = name.trim().toLowerCase();
  return (
    db
      .select({ id: entities.id, name: entities.name, source: entities.source, confirmedByPersonId: entities.confirmedByPersonId, person: entities.person })
      .from(entities)
      .where(isNull(entities.deletedAt))
      .all()
      .find((e) => e.person === speaker.id && e.source === "inferred" && e.confirmedByPersonId === null && e.name.trim().toLowerCase() === wanted) ?? null
  );
}

function selfEntityId(speaker: PersonRow): string | null {
  return db.select({ id: entities.id }).from(entities).where(and(eq(entities.accountPersonId, speaker.id), isNull(entities.deletedAt))).get()?.id ?? null;
}

function entityRow(id: string) {
  return db.select().from(entities).where(and(eq(entities.id, id), isNull(entities.deletedAt))).get() ?? null;
}

/** Step 3a's confirm transition on a candidate entity, by the person
 * answering; a child's answer (no confirming role) still sets the
 * pronouns, and the candidate stays theirs to confirm. */
function confirmCandidateEntity(speaker: PersonRow, id: string, pronouns: "he" | "she" | "they" | null): Entity | null {
  const row = entityRow(id);
  if (!row) return null;
  const edit: { confirm?: true; pronouns?: string } = {};
  if (row.source === "inferred" && row.confirmedByPersonId === null) edit.confirm = true;
  if (pronouns) edit.pronouns = pronouns;
  if (Object.keys(edit).length === 0) return updateEntity(speaker, id, {}).value ?? null;
  let result = updateEntity(speaker, id, edit);
  if (!result.ok && edit.confirm && result.status === 403) result = updateEntity(speaker, id, pronouns ? { pronouns } : {});
  return result.ok && result.value ? result.value : null;
}

/** A new local entity of the stated kind, created beside the candidate
 * of the wrong kind: createEntity directly, since ensureSubjectEntity
 * would find the candidate by name. */
function createFreshEntity(speaker: PersonRow, name: string, kind: EntityKind): Entity | null {
  const made = createEntity(speaker, { kind, name: displayName(name), scope: "person", person: speaker.id, source: "local", ...(kind === "place" ? { place_kind: "map" as const } : {}) });
  return made.ok && made.value ? made.value : null;
}

function entityRowToEntity(id: string): Entity | null {
  const row = entityRow(id);
  return row ? toEntity(row) : null;
}

/** The candidate's records and edges follow the entity that replaces
 * it; an edge whose type no longer joins a person and the new kind goes. */
function repointEntity(oldId: string, newId: string, kind: EntityKind): void {
  const now = new Date().toISOString();
  db.update(memoryRecords).set({ subjectId: newId, hlc: nextHlc() }).where(eq(memoryRecords.subjectId, oldId)).run();
  const edges = db
    .select()
    .from(relationships)
    .where(or(eq(relationships.fromId, oldId), eq(relationships.toId, oldId)))
    .all();
  for (const edge of edges) {
    const type = relationshipTypes().find((t) => t.id === edge.type);
    const fits = type && ((edge.fromId === oldId && (type.from as string[]).includes(kind)) || (edge.toId === oldId && (type.to as string[]).includes(kind)));
    if (!fits) {
      db.update(relationships).set({ deletedAt: now, updatedAt: now, hlc: nextHlc() }).where(eq(relationships.id, edge.id)).run();
      continue;
    }
    db.update(relationships)
      .set({ fromId: edge.fromId === oldId ? newId : edge.fromId, toId: edge.toId === oldId ? newId : edge.toId, updatedAt: now, hlc: nextHlc() })
      .where(eq(relationships.id, edge.id))
      .run();
  }
}

/** The text of the judge's open question for a candidate: a guessed
 * entity gets the plain question (never its guessed kind); a guessed
 * relationship is put as the question it is, in the phrase the person
 * would use. */
export function candidateQuestion(kind: "entity" | "relationship", name: string, relationPhrase?: string): string {
  if (kind === "entity" || !relationPhrase) return whoQuestion(displayName(name));
  return `Is ${displayName(name)} ${relationPhrase}?`;
}

/** The phrase for a relationship type from the speaker's side, from
 * the vocabulary's own said_as ("my coworker" becomes "your coworker"),
 * or null for a type nobody says ("owned_by"). */
export function relationPhraseFor(type: string): string | null {
  // The prompt's own phrase for the type (subjects.ts), never a rewrite
  // of a said_as example (a review: "Is Tesla your dog?" for owns).
  return RELATION_PHRASES[type] ?? null;
}
