// CREATOR-05 review fixes (CREATOR-PORT-2026-11-13): the turn's band, mentions only on written chat, adult-only from the cast entry, film cast by id, no rows for a refused or temporary call.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationTurns, creationCast, mediaSubjects, people, videoJobs } from "@/db/schema";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import { createSynth, ensureSubject, type SynthRecord } from "@/lib/synths";
import { createMediaSubject, shareMediaSubject, subjectViewById } from "@/lib/mediaSubjects";
import { castForTool, castIsAdultOnly, castMentionIds, listCast, resolveCast } from "@/lib/cast";
import { bindCastSubjects } from "@/lib/films/plan";
import { realFilmEngines } from "@/lib/films/engines";
import { ensurePersonSubject, listMediaSubjects } from "@/lib/mediaSubjects";
import { withMentionedCast } from "@/lib/mentionedCastArgs";
import { listSynthCreditItems } from "@/lib/creations/credits";
import { runGenerateImage } from "@/lib/pictures/tool";
import { getPictureJob } from "@/lib/pictures/jobs";
import { runGenerateVideo } from "@/lib/videos/tool";
import { runMakeReferenceVideoTurn } from "@/lib/videos/referenceVideo";
import { __setStartFilmForTests, runMakeFilmTurn } from "@/lib/films/tool";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { setHouseholdSettingValue } from "@/lib/settings";
import { resetDb } from "./reset-db";
import { installFakeImageStack, until, type FakeImageStack } from "./pictureFixture";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { child, owner, teen } from "./support/testAuth";
import type { PersonRow } from "@/types";
import type { ToolExecutionOutcome } from "@/lib/turnMachine/contract";

setDefaultTimeout(30_000);
const persona = { display_name: "Marlow Fox", formality: "neutral", complexity: "standard", engagement: "balanced", filler_density: "light", audience: "all", examples: ["I like a good plan.", "Let us try that.", "Fine by me."], status: "ready" } as never;
const none = { kind: "none", person_id: null, name: null, refresh: "7d", minor: false } as const;
const life = { enabled: false, seed: "" };
const text = (o: ToolExecutionOutcome) => (o.result?.reply as { text?: string } | undefined)?.text ?? "";

let image: FakeImageStack;
let video: FakeVideoStack;
let sage: PersonRow, kid: PersonRow, teenRow: PersonRow;

async function makeSynth(actor: PersonRow, name: string): Promise<SynthRecord> {
  const made = await createSynth(actor, { persona: { ...(persona as object), display_name: name } as never, based_on: none, life });
  if (!made.ok) throw new Error(`fixture synth failed: ${made.error}`);
  return made.value.synth;
}
function chat(actor: PersonRow) {
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error("conversation");
  const turnId = newConversationTurnId();
  db.insert(conversationTurns).values({ id: turnId, personId: actor.id, surface: "chat", conversationId: conversation.value.id, userText: "hi", replyText: "ok", source: "model", safetyAction: "allow", createdAt: new Date().toISOString(), hlc: "1:0:test" }).run();
  return { conversationId: conversation.value.id, turnId };
}
const stateOf = (actor: PersonRow) => ({ actor, surface: "chat" as never, planBasis: { surfaceClass: "written" } as never, plan: undefined as never, temporary: false, ephemeral: false, ...chat(actor) }) as never;
const pic = (actor: PersonRow, args: Record<string, unknown>) => runGenerateImage({ state: stateOf(actor), args, callId: "c1", spoken: false });
const vid = (actor: PersonRow, args: Record<string, unknown>) => runGenerateVideo({ state: stateOf(actor), args, callId: "c2", spoken: false });

beforeEach(async () => {
  resetDb();
  const o = await owner();
  sage = o.row;
  kid = (await child(o.client)).row;
  await teen(o.client);
  teenRow = db.select().from(people).where(eq(people.role, "teen")).get()! as PersonRow;
  image = installFakeImageStack();
  video = installFakeVideoStack();
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } })));
});
afterEach(async () => { await new Promise((r) => setTimeout(r, 50)); image.restore(); video.restore(); __setStartFilmForTests(null); });


const real = { kind: "real_person", person_id: null, name: "Ada Lovelace", refresh: "7d", minor: false } as const;
async function makeSynthWith(actor: PersonRow, name: string, based_on: unknown, audience = "all"): Promise<SynthRecord> {
  const made = await createSynth(actor, { persona: { ...(persona as object), display_name: name, audience } as never, based_on: based_on as never, life });
  if (!made.ok) throw new Error(`fixture synth failed: ${made.error}`);
  return made.value.synth;
}
const subjectRows = () => db.select().from(mediaSubjects).all().length;

describe("1. the turn's band counts, not only the account's", () => {
  test("an adult account on a child's turn cannot cast household members, real-person synths or adult-only entries", async () => {
    setHouseholdSettingValue("generation.household_likeness", true as never);
    const ada = await makeSynthWith(sage, "Ada Lovelace", real);
    const night = await makeSynthWith(sage, "Night Fox", none, "adult");
    const plain = await makeSynth(sage, "Marlow Fox");
    const asAdult = listCast(sage).map((e) => e.name);
    expect(asAdult).toContain("Ada Lovelace");
    expect(asAdult).toContain("Night Fox");
    expect(listCast(sage).some((e) => e.kind === "member" && e.person_id === teenRow.id)).toBe(true);
    for (const band of ["child", "teen"] as const) {
      const names = listCast(sage, band).map((e) => e.name);
      expect(names).toContain("Marlow Fox");
      expect(names).not.toContain("Ada Lovelace");
      expect(names).not.toContain("Night Fox");
      expect(listCast(sage, band).some((e) => e.kind === "member")).toBe(false);
      const refs = [teenRow.id, sage.id, ada.id, night.id];
      const resolved = await resolveCast(sage, refs, { band });
      expect(resolved.members).toHaveLength(0);
      expect(resolved.refused).toHaveLength(refs.length);
      const tool = await castForTool(sage, { cast: [night.id] }, { band });
      expect(tool.ok).toBe(false);
    }
    expect((await castForTool(sage, { cast: [plain.id] }, { band: "child" })).ok).toBe(true);
    expect(listCast(sage, "adult").map((e) => e.name)).toContain("Ada Lovelace");
  });
});

describe("2. mentions count only on a written chat turn", () => {
  test("spoken, robot, satellite, shared and temporary turns ignore them", async () => {
    const synth = await makeSynth(sage, "Marlow Fox");
    const id = listCast(sage).find((e) => e.synth_id === synth.id)!.id;
    const mentions = [{ id, type: "cast" }];
    expect(castMentionIds(sage, mentions, { surface: "chat" })).toEqual([id]);
    expect(castMentionIds(sage, mentions, { surface: "chat", spoken: true })).toEqual([]);
    expect(castMentionIds(sage, mentions, { surface: "chat", temporary: true })).toEqual([]);
    for (const surface of ["robot", "tv", "phone", "pod", "overlay"]) expect(castMentionIds(sage, mentions, { surface })).toEqual([]);
    expect(castMentionIds(sage, mentions, { surface: "chat", written: false })).toEqual([]);
    expect(castMentionIds(sage, mentions, { surface: "chat", band: "child" })).toEqual([id]); // a plain synth stays castable by a child turn
    const night = await makeSynthWith(sage, "Night Fox", none, "adult");
    const nightId = listCast(sage).find((e) => e.synth_id === night.id)!.id;
    expect(castMentionIds(sage, [{ id: nightId, type: "cast" }], { surface: "chat", band: "child" })).toEqual([]);
  });
});

describe("4. the adult-only mark comes from the cast entry", () => {
  test("an adult-floor synth whose files carry no mark still marks the clip and the picture", async () => {
    const night = await makeSynthWith(sage, "Night Fox", none, "adult");
    const entry = listCast(sage).find((e) => e.synth_id === night.id)!;
    const chosen = await castForTool(sage, { cast: [entry.id] });
    if (!chosen.ok) throw new Error(chosen.line);
    expect(chosen.subjects.every(({ references }) => references.every((ref) => ref.audience !== "adult-only"))).toBe(true);
    expect(castIsAdultOnly(chosen)).toBe(true);
    const out = await vid(sage, { prompt: "Night Fox waves hello", cast: [entry.id] });
    expect(text(out)).not.toContain("not in your cast list");
    const job = db.select().from(videoJobs).all().at(-1)!;
    expect(JSON.parse(job.request).adultOnly).toBe(true);
    const plain = await makeSynth(sage, "Marlow Fox");
    const plainEntry = listCast(sage).find((e) => e.synth_id === plain.id)!;
    expect(castIsAdultOnly((await castForTool(sage, { cast: [plainEntry.id] }) as never))).toBe(false);
  });
});

describe("5. film cast is found by id, never by name", () => {
  test("bindCastSubjects sets only the picked members' ids and drops one the model planted", () => {
    const plan = { title: "T", summary: "S", cast: [{ name: "Pip", kind: "character", locked: "a tiny blue fox", subject_id: "msub-planted" }, { name: "Other", kind: "prop", locked: "a red kite thing", subject_id: "msub-planted2" }], shots: [], music: "m", credits: [] } as never;
    const bound = bindCastSubjects(plan, [{ id: "msub-real", name: "pip" }]) as unknown as { cast: Array<{ name: string; subject_id?: string }> };
    expect(bound.cast[0]!.subject_id).toBe("msub-real");
    expect(bound.cast[1]!.subject_id).toBeUndefined();
  });
  test("a household member cast reaches the run with its own subject, not a blank one or a same-named stranger", async () => {
    setHouseholdSettingValue("generation.household_likeness", true as never);
    const seen: Array<{ castSubjectIds?: string[] }> = [];
    __setStartFilmForTests(((input: { castSubjectIds?: string[] }) => { seen.push(input); return { id: "run-1" }; }) as never);
    const stranger = createMediaSubject(sage, { name: teenRow.displayName, kind: "character", look: "an unrelated stranger" });
    const entry = listCast(sage).find((e) => e.kind === "member" && e.person_id === teenRow.id)!;
    const out = await runMakeFilmTurn({ state: stateOf(sage), args: { idea: "A quiet film", cast: [entry.id] }, callId: "f9", spoken: false });
    expect(out.status).toBe("succeeded");
    const memberSubject = db.select().from(mediaSubjects).all().find((r) => r.personId === teenRow.id)!;
    expect(seen[0]!.castSubjectIds).toEqual([memberSubject.id]);
    expect(seen[0]!.castSubjectIds).not.toContain(stranger.id);
    __setStartFilmForTests(null);
    const before = subjectRows();
    const engines = realFilmEngines({ actor: sage, signal: new AbortController().signal, productionId: "p" });
    expect(await engines.ensureSubject({ name: teenRow.displayName, kind: "character", locked: "x", subjectId: memberSubject.id }, { signal: new AbortController().signal })).toBe(memberSubject.id);
    expect(subjectRows()).toBe(before);
    expect(listMediaSubjects(sage).some((s) => s.id === memberSubject.id)).toBe(false); // the old name lookup could never see it
  });
});

describe("6. no rows for a refused or temporary call", () => {
  test("a refused cast, and a temporary chat, make no subject", async () => {
    const synth = await makeSynth(sage, "Marlow Fox");
    const id = listCast(sage).find((e) => e.synth_id === synth.id)!.id;
    const before = subjectRows();
    const refused = await resolveCast(sage, [id, "nobody-here"]);
    expect(refused.refused).toHaveLength(1);
    expect(refused.members).toHaveLength(0);
    expect(subjectRows()).toBe(before);
    const temp = await resolveCast(sage, [id], { temporary: true });
    expect(temp.refused[0]!.line).toContain("temporary chat");
    expect(subjectRows()).toBe(before);
    const out = await pic(sage, { prompt: "Marlow Fox at the beach", cast: [id] });
    expect(subjectRows()).toBeGreaterThan(before); // a normal call still sets it up
    expect(out.status).toBe("succeeded");
    const tempState = { ...(stateOf(sage) as object), temporary: true } as never;
    const member = listCast(sage).find((e) => e.kind === "member" && e.person_id === teenRow.id);
    const tempOut = await runGenerateImage({ state: tempState, args: { prompt: "a picture", cast: [member?.id ?? sage.id] }, callId: "t1", spoken: false });
    expect(text(tempOut)).toContain("temporary chat");
  });
});
