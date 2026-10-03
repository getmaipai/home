// THIN-7E (docs/BACKLOG.md "Thin chat path", rule 12): ASK-01, the
// unknown-name question, on the one path. When a person mentions a name Home
// does not know, the assistant asks once who or what it is, reads the answer
// with the deterministic parser, and remembers it.
//
// Every decision here is made by the functions in unknownNames.ts
// (resolveNames, replyAsksAbout, parseWhoAnswer, applyWhoAnswer, whoQuestion,
// looksLikeWhoAnswer, candidateByName ...) and conversationHistory.ts's open
// questions, called as they are. What this file holds is the glue the old engine
// kept inside turnEngine.ts (resolveTurnSubjects, subjectsSectionFor, the pending
// ask's `who` branch, appendedAsk), re-expressed over the default path's own
// state so nothing under turnMachine/ imports the old engine. THIN-7D
// deletes the old copies; these are then the only ones.
//
// Where each piece runs on the default path:
//   subjects + the unknown line  -> nodes/context.ts (subjectsForTurn)
//   the who-answer, the early answer of a judge's open question
//                                -> nodes/commands.ts (answerWhoTurn), after `safety`
//   the appended question        -> nodes/model.ts (askAppendFor), before the output gate
//   the stored ask, the open question marked asked
//                                -> turnNext.ts logResult (the commit the append returns)
import { listActivePeople } from "@/lib/access";
import {
  getPendingAsk,
  setPendingAsk,
  lastTurnSubjects,
  lastTwoTurnsSubjects,
  pendingOpenQuestionsFor,
  markOpenQuestionAsked,
  resolveOpenQuestion,
  resolveOpenQuestionsAbout,
  expireOpenQuestion,
  queueOpenQuestion,
  type OpenQuestionRow,
  type PendingAsk,
} from "@/lib/conversationHistory";
import { ensurePersonEntity, entityForSpeaker, registryNamesFor, subjectLabel } from "@/lib/subjects";
import { applyWhoAnswer, candidateByName, framedName, looksLikeWhoAnswer, parseWhoAnswer, replyAsksAbout, replyAsksIdentityOf, resolveNames, unknownNamesLine, whoQuestion, type SubjectRef } from "@/lib/unknownNames";
import { framedUnknownNames } from "@/lib/turnContext";
import { COURTESY_PREFIX } from "@/lib/utteranceShape";
import { matchCommand } from "@/lib/commands";
import { loadAllManifests, matchPattern, commandOpeners } from "@/lib/turnShared";
import { sanitizeForPrompt } from "@/lib/promptSanitize";
import { visibleText } from "@/lib/wellFormed";
import type { PersonRow } from "@/types";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";
import type { ProtocolAnswer } from "@/lib/turnSignal";

// ---------------------------------------------------------------------------
// Subjects: the names in the utterance, resolved before the model runs.

export interface TurnSubjects {
  subjects: SubjectRef[];
  /** The first name framed as household with no noun settling it: the one the reply asks about. */
  unknownAsk: string | null;
  /** The context's own lines about the subjects (the unknown line, the About line), or "". */
  section: string;
}

/** The old engine's resolveTurnSubjects() for ASK-01: the household's and the
 * registry's names are household refs, the rest unresolved; a turn that names
 * nobody carries the previous turn's subjects (a carried unresolved one lives
 * two turns unless re-mentioned, and never re-asks). */
export function subjectsForTurn(input: { actor: PersonRow; text: string; signal: TurnSignal; recentUserTexts: readonly string[]; conversationId: string; supersedes?: string; turnId: string }): TurnSubjects {
  const { actor, text, signal, recentUserTexts, conversationId, supersedes, turnId } = input;
  const household = listActivePeople();
  const rosterNames = household.flatMap((p) => (p.nickname ? [p.displayName, p.nickname] : [p.displayName]));
  const registry = registryNamesFor(actor);
  const knownForHub = [...rosterNames, ...registry.map((r) => r.name)];
  const resolved = resolveNames(
    text,
    signal,
    {
      names: knownForHub,
      resolveEntity: (name) => {
        const member = household.find((p) => p.displayName.trim().toLowerCase() === name.toLowerCase() || (p.nickname ?? "").trim().toLowerCase() === name.toLowerCase());
        if (member) return ensurePersonEntity(member).value?.id ?? null;
        return registry.find((r) => r.name.toLowerCase() === name.toLowerCase())?.id ?? null;
      },
      recent: recentUserTexts.slice(-3),
    },
    turnId,
  );
  let carried: SubjectRef[] = [];
  if (resolved.subjects.length === 0 && !supersedes) {
    const lastTwo = lastTwoTurnsSubjects(conversationId);
    const newest = lastTwo[0] ?? [];
    const older = lastTwo[1] ?? [];
    const lowerText = text.toLowerCase();
    carried = newest.filter((s) => {
      if (s.type !== "unresolved") return true;
      const sf = s.surface_form.toLowerCase();
      const onOlder = older.some((o) => o.type === "unresolved" && o.surface_form.toLowerCase() === sf);
      return !onOlder || lowerText.includes(sf);
    });
    const olderWorld = older;
    carried = carried.filter((s) => {
      if (s.type !== "world") return true;
      const name = s.display_name.trim().toLowerCase();
      const onOlder = olderWorld.some((o) => o.type === "world" && o.display_name.trim().toLowerCase() === name);
      return !onOlder || lowerText.includes(name);
    });
  }
  // One entry per household entity (a name and its alias both resolve to the one row), at most three deep.
  const seenEntities = new Set<string>();
  const subjects: SubjectRef[] = [...resolved.subjects, ...carried]
    .filter((s) => {
      if (s.type !== "household") return true;
      if (seenEntities.has(s.entity_id)) return false;
      seenEntities.add(s.entity_id);
      return true;
    })
    .slice(0, 3);
  const unknownAsk = resolved.unknown.find((u) => u.ask)?.name ?? null;
  return { subjects, unknownAsk, section: subjectsSectionFor(actor, subjects) };
}

/** The context's own lines about the turn's subjects: the unknown line for names
 * the hub has never heard, and one line per registry subject with what the
 * registry holds (kind, relation to the speaker when stated, pronouns). Never a
 * candidate's guessed kind (subjectLabel() hides it); a sensitive entity is the
 * household's adults' to see. */
function subjectsSectionFor(actor: PersonRow, subjects: readonly SubjectRef[]): string {
  const lines: string[] = [];
  const unknownLine = unknownNamesLine(framedUnknownNames({ subjects }));
  if (unknownLine) lines.push(unknownLine);
  const about: string[] = [];
  for (const ref of subjects) {
    if (ref.type !== "household") continue;
    const entity = entityForSpeaker(actor, ref.entity_id);
    if (!entity || entity.account_person_id || (entity.source === "inferred" && !entity.confirmed_by_person_id)) continue;
    if (entity.sensitive && !(actor.role === "owner" || actor.role === "admin")) continue;
    const label = subjectLabel(actor, entity.id) ?? entity.name;
    const kind = label.includes("(") ? label : `${label} (${entity.kind === "person" ? "someone the household knows" : `a ${entity.kind}`})`;
    const pronouns = entity.pronouns ? `, ${entity.pronouns}` : "";
    const description = entity.description ? `: ${sanitizeForPrompt(entity.description)}` : "";
    about.push(`${kind}${pronouns}${description}`);
  }
  if (about.length > 0) lines.push(`About: ${about.join("; ")}.`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Open questions: the judge's queued questions, asked once at the end of a reply.

/** The name an open question is about, from its subject (an entity, or the far end of a relationship from the speaker). */
function openQuestionName(question: OpenQuestionRow): string | null {
  return framedName(question.subjectId, question.person);
}

/** The next open question to put: the oldest pending one whose subject is in
 * play (named in the utterance or the last two user turns, or a subject on the
 * turn), else the oldest pending entity question; a relationship question about a
 * name not in play waits. */
function nextOpenQuestionInPlay(personId: string, utterance: string, ctx: { history: readonly string[]; subjects: readonly SubjectRef[] }): OpenQuestionRow | null {
  const pending = pendingOpenQuestionsFor(personId).filter((q) => {
    if (!q.subjectId || openQuestionName(q) !== null) return true;
    expireOpenQuestion(q.id);
    console.log(`[ask] the open question ${q.id} lapsed: its subject is gone`);
    return false;
  });
  if (pending.length === 0) return null;
  const recent = [utterance, ...ctx.history.slice(-2)].join("\n");
  const subjectIds = new Set(ctx.subjects.flatMap((s) => (s.type === "household" ? [s.entity_id] : [])));
  const inPlay = (q: OpenQuestionRow): boolean => {
    if (q.subjectId && subjectIds.has(q.subjectId)) return true;
    const name = openQuestionName(q);
    return name !== null && new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(recent);
  };
  return pending.find(inPlay) ?? pending.find((q) => !(q.subjectId ?? "").startsWith("rel-")) ?? null;
}

// ---------------------------------------------------------------------------
// The answer: the person's reply to a question put on an earlier turn.

export interface WhoAnswerTurn {
  /** The reply, whole: ASK-01's own acknowledgement line. No model runs. */
  text: string;
  /** The entity a `who` answer created or confirmed, the turn's subject. */
  subjects: SubjectRef[];
  /** For the turn signal: an answer that states a kind is the inform the judge reads. */
  protocol: ProtocolAnswer;
}

/** Whether the utterance is a command in place of an answer ("turn on the office
 * lights"): a household command, a bundled package's literal pattern, or an
 * opener that is one of the installed packages' own verbs. Such a turn routes as
 * itself, never read as the answer. */
function isCommandInPlaceOfAnswer(text: string, actor: PersonRow): boolean {
  const loaded = loadAllManifests();
  const opener = text.trim().replace(COURTESY_PREFIX, "").split(/\s+/)[0]?.toLowerCase().replace(/[^a-z']/g, "") ?? "";
  if (commandOpeners(loaded).has(opener)) return true;
  if (matchCommand(text, actor)) return true;
  for (const { manifest } of loaded) {
    if (manifest.routing?.always_offer) continue;
    for (const pattern of manifest.routing?.patterns ?? []) if (matchPattern(text, pattern) !== null) return true;
  }
  return false;
}

/** The `who` branch of the old engine's resolvePendingAsk(), on the stored pending
 * ask, and the answer of a judge's open question that arrives before it is put.
 * Returns the reply when this turn was an answer or a cancel, or null when the
 * turn goes on to the model (an unreadable answer clears the ask; a command routes
 * as itself). The answer is read by the deterministic parser, never by a model. */
export function answerWhoTurn(input: { actor: PersonRow; text: string; conversationId: string; turnId: string; pendingWho: PendingAsk | null; temporary: boolean }): WhoAnswerTurn | null {
  const { actor, text, conversationId, turnId, pendingWho, temporary } = input;
  if (pendingWho && pendingWho.kind === "who") {
    const name = pendingWho.name ?? "";
    if (isCommandInPlaceOfAnswer(text, actor)) {
      if (pendingWho.openQuestionId) resolveOpenQuestion(pendingWho.openQuestionId, "declined");
      return null;
    }
    const parsed = parseWhoAnswer(text, name, { relationAsked: pendingWho.subjectId?.startsWith("rel-") === true });
    if (parsed === "declined") {
      if (pendingWho.openQuestionId) resolveOpenQuestion(pendingWho.openQuestionId, "declined");
      // The judge's twin question about the same candidate goes with it: a cancel is never asked again.
      const twin = name ? candidateByName(actor, name) : null;
      if (twin) resolveOpenQuestionsAbout(actor.id, twin.id, "declined");
      // The judge may not have seen the name yet: the decline is recorded so its later candidate queues no question.
      if (name && !pendingWho.openQuestionId) {
        const record = queueOpenQuestion({ person: actor.id, conversationId, kind: "who", text: whoQuestion(name), source: turnId });
        markOpenQuestionAsked(record.id);
        resolveOpenQuestion(record.id, "declined");
      }
      return { text: "Okay, no problem.", subjects: [], protocol: { kind: "who", answer: "negative" } };
    }
    if (parsed === null) {
      if (pendingWho.openQuestionId) resolveOpenQuestion(pendingWho.openQuestionId, "declined");
      return null;
    }
    const outcome = applyWhoAnswer(actor, { name, subjectId: pendingWho.subjectId ?? null }, parsed, turnId);
    if (pendingWho.openQuestionId) resolveOpenQuestion(pendingWho.openQuestionId, "answered");
    // The judge's own question about the same entity (queued while the engine's ask stood) is answered by this too.
    if (outcome.entity) resolveOpenQuestionsAbout(actor.id, outcome.entity.id, "answered");
    if (outcome.replacedEntityId) resolveOpenQuestionsAbout(actor.id, outcome.replacedEntityId, "answered");
    console.log(`[ask] the answer about a name was read on turn ${turnId}: ${outcome.entity ? `${outcome.entity.kind} ${outcome.entity.id}` : "no entity"}`);
    return {
      text: outcome.reply,
      subjects: outcome.entity ? [{ type: "household", entity_id: outcome.entity.id, carried_question: null }] : [],
      protocol: { kind: "who", answer: parsed.kind ? "value" : parsed.verdict === "no" ? "negative" : "affirmative" },
    };
  }
  if (temporary) return null;
  // A question the judge queued but has not asked yet can be answered before it is put: only a bare answer
  // shape that names nobody else, about the question in play, on the conversation that raised it.
  const openPending = nextOpenQuestionInPlay(actor.id, text, { history: [], subjects: lastTurnSubjects(conversationId) });
  if (!openPending || openPending.kind !== "who" || !openPending.subjectId) return null;
  const about = openQuestionName(openPending);
  const here = openPending.conversationId === conversationId || lastTurnSubjects(conversationId).some((s) => s.type === "household" && s.entity_id === openPending.subjectId);
  if (!about || !here || !looksLikeWhoAnswer(text, about)) return null;
  const parsed = parseWhoAnswer(text, about);
  if (!parsed || parsed === "declined" || !parsed.kind) return null;
  const outcome = applyWhoAnswer(actor, { name: about, subjectId: openPending.subjectId }, parsed, turnId);
  markOpenQuestionAsked(openPending.id);
  resolveOpenQuestion(openPending.id, "answered");
  console.log(`[ask] an open question was answered before it was asked on turn ${turnId}: ${outcome.entity ? `${outcome.entity.kind} ${outcome.entity.id}` : "no entity"}`);
  return {
    text: outcome.reply,
    subjects: outcome.entity ? [{ type: "household", entity_id: outcome.entity.id, carried_question: null }] : [],
    protocol: { kind: "who", answer: "value" },
  };
}

// ---------------------------------------------------------------------------
// The question: put at the end of the reply.

export interface AskAppend {
  /** The text to append (with its leading space), or "" when the model's own question already asks it or nothing asks this turn. */
  append: string;
  /** Persists the ask (the pending ask, the open question's status) once the question is known to have reached the
   * person: the delivered text carries it. A refusal or a malformed replacement that lost the question commits
   * nothing, so no ask stands that the person never heard. */
  commit: (deliveredText: string) => void;
}

export const NO_ASK_APPEND: AskAppend = { append: "", commit: () => {} };

/** The old engine's appendedAsk(): ASK-01's unknown name first, then the model's own question about a bare name
 * (bound as the ask), then the judge's next open question in play. A temporary chat asks about an unknown name but
 * stores nothing: the stored ask is a no-op there and the judge's queue is never touched. */
export function askAppendFor(input: { actor: PersonRow; conversationId: string; turnId: string; replyText: string; utterance: string; subjects: readonly SubjectRef[]; unknownAsk: string | null; recentUserTexts: readonly string[]; temporary: boolean }): AskAppend {
  const { actor, conversationId, turnId, replyText, utterance, subjects, unknownAsk, recentUserTexts, temporary } = input;
  const visible = visibleText(replyText);
  if (unknownAsk) {
    const name = unknownAsk;
    const asked = replyAsksAbout(visible, name);
    return {
      append: asked ? "" : ` ${whoQuestion(name)}`,
      commit: (delivered) => {
        if (temporary || !replyAsksAbout(visibleText(delivered), name)) return;
        setPendingAsk(conversationId, { kind: "who", prompt: whoQuestion(name), packageId: "engine", args: { name }, name, carriedQuestion: utterance });
        console.log(`[ask] turn ${turnId} asks about an unknown name (${asked ? "the model's own question" : "appended"})`);
      },
    };
  }
  if (temporary) return NO_ASK_APPEND;
  if (getPendingAsk(conversationId)) return NO_ASK_APPEND;
  // The model's own question about a bare unresolved name ("Serena, someone you know or a public figure?") is bound
  // as the ask; the engine appends nothing of its own there.
  const bareAsked = subjects.find((s): s is Extract<SubjectRef, { type: "unresolved" }> => s.type === "unresolved" && s.candidate_kinds.length === 0 && replyAsksIdentityOf(visible, s.surface_form));
  if (bareAsked) {
    const name = bareAsked.surface_form;
    return {
      append: "",
      commit: (delivered) => {
        if (!replyAsksIdentityOf(visibleText(delivered), name)) return;
        setPendingAsk(conversationId, { kind: "who", prompt: whoQuestion(name), packageId: "engine", args: { name }, name, carriedQuestion: utterance });
        console.log(`[ask] turn ${turnId} binds the model's own question about a bare name`);
      },
    };
  }
  const question = nextOpenQuestionInPlay(actor.id, utterance, { history: recentUserTexts, subjects });
  if (!question) return NO_ASK_APPEND;
  const name = openQuestionName(question);
  if (question.subjectId && name === null) {
    expireOpenQuestion(question.id);
    console.log(`[ask] the open question ${question.id} lapsed: its subject is gone`);
    return NO_ASK_APPEND;
  }
  const asked = name !== null && replyAsksAbout(visible, name);
  return {
    append: asked ? "" : ` ${question.text}`,
    commit: (delivered) => {
      const carried = asked ? name !== null && replyAsksAbout(visibleText(delivered), name) : delivered.includes(question.text);
      if (!carried) return;
      markOpenQuestionAsked(question.id);
      setPendingAsk(conversationId, { kind: "who", prompt: question.text, packageId: "engine", args: { name: name ?? "" }, name: name ?? "", subjectId: question.subjectId, openQuestionId: question.id });
      console.log(`[ask] turn ${turnId} asks the open question ${question.id} (${question.kind}${asked ? ", the model's own question" : ""})`);
    },
  };
}
