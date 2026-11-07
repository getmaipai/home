// LTXD-E2/E3 (Home side, no UI): `edit_video` change `restyle`, first effect `colorize`. Real finished jobs from the fake video Stack; the fake also answers
// POST /v1/videos/restyle (the Stack route) and records what Home sent.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { newConversationTurnId } from "@/lib/id";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { withMark } from "@/lib/adultLock";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { getVideoJobFor, type VideoJob } from "@/lib/videos/jobs";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { runGenerateVideo } from "@/lib/videos/tool";
import { EDIT_MINOR_LINE } from "@/lib/videos/editGate";
import { RESTYLE_MAX_SECONDS, RESTYLE_NOTE, RESTYLE_SOURCE_TOO_LONG_LINE, RESTYLE_LORA_MISSING_LINE, editVideoArgs, runEditVideo } from "@/lib/videos/editTool";
import { VIDEO_RESTYLES, restyleBody } from "@/lib/videos/editPlan";
import { RESTYLE_FAILURE_COPY } from "@/lib/failureCopy";
import { __setVideosFetchForTests } from "@/lib/videos/stack";
import { installFakeVideoStack, testJpeg, type FakeVideoStack } from "./videoFixture";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";
import type { TurnState } from "@/lib/turnMachine/contract";

let fake: FakeVideoStack;
let restyles: Array<Record<string, unknown>>;
let restyleRefusal: { status: number; code: string; error: string } | null;
const COLORIZER_ID = "lora-c0c0c0c0c0c0c0c0";
const COLORIZER = { id: COLORIZER_ID, name: "ltx-ic-colorizer", sha256: "c".repeat(64), bytes: 1000, base_model: "ltx-2.3", licence: "Apache-2.0", source_url: null, classification: "all-ages" as const, trigger_words: [], strength_default: 1, added_at: "2026-11-06T00:00:00Z" };

beforeEach(() => {
  resetDb();
  fake = installFakeVideoStack();
  fake.ltx25max = "ready";
  __setVideoStatusForTests(readyVideoStatusForTests({ ltx25max: "ready" }));
  __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]);
  fake.loras.push({ ...COLORIZER });
  restyles = []; restyleRefusal = null;
  const base = fake.handler;
  __setVideosFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if ((init?.method ?? "GET").toUpperCase() === "POST" && url.pathname === "/v1/videos/restyle") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      restyles.push(body);
      if (restyleRefusal) return new Response(JSON.stringify({ error: restyleRefusal.error, code: restyleRefusal.code }), { status: restyleRefusal.status, headers: { "content-type": "application/json" } });
      const job = { id: `vjob-${fake.jobs.length + 1}`, body, polls: 0, state: "queued", deleted: false };
      fake.jobs.push(job as never);
      return new Response(JSON.stringify({ created: 1, job: job.id, data: [] }), { status: 202, headers: { "content-type": "application/json" } });
    }
    return base(input as never, init);
  }) as unknown as typeof fetch);
});
afterEach(async () => { fake.restore(); __setKeyframesForTests(null); __setVideoStatusForTests(undefined); await new Promise((resolve) => setTimeout(resolve, 50)); });

function person(role: string, name = role): PersonRow {
  const now = new Date().toISOString();
  const id = `person-${name}xyz`;
  db.insert(people).values({ id, displayName: name, role, avatarSeed: name, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
}
function chatState(actor: PersonRow, conversationId?: string): TurnState {
  const conv = resolveOrCreateConversation(actor, "chat", conversationId, { temporary: false });
  if (!conv.ok) throw new Error("no conversation");
  const turnId = newConversationTurnId();
  logTurn(actor, "chat", "make a video", { reply: { text: "On its way." }, source: "plugin", plugin_id: "generate_video", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conv.value.id, turn_id: turnId });
  return { actor, surface: "chat", turnId, conversationId: conv.value.id, temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance: "make a video", persona: null, crisis: false } as unknown as TurnState;
}
const edit = (state: TurnState, args: Record<string, unknown>) => runEditVideo({ state, args, callId: "edit", spoken: false });
async function makeClip(actor: PersonRow): Promise<{ job: VideoJob; state: TurnState }> {
  const state = chatState(actor);
  const made = await runGenerateVideo({ state, args: { prompt: "A paper boat floats on a river at sunset", tier: "max" }, callId: "make", spoken: false });
  const id = (made.result?.data as { videoJobId?: string }).videoJobId;
  if (!id) throw new Error("clip was not started");
  await until(() => getVideoJobFor(actor, id)?.state === "done");
  return { job: getVideoJobFor(actor, id)!, state: chatState(actor, state.conversationId!) };
}
const finished = async (actor: PersonRow, outcome: Awaited<ReturnType<typeof edit>>) => {
  const id = (outcome.result?.data as { videoJobId: string }).videoJobId;
  await until(() => ["done", "failed", "cancelled"].includes(getVideoJobFor(actor, id)?.state ?? ""));
  return getVideoJobFor(actor, id)!;
};

describe("the plan", () => {
  test("colorize builds the Max Stack body from the single restyle definition", () => {
    expect(VIDEO_RESTYLES).toEqual([expect.objectContaining({ id: "colorize", label: "Colour it in", lora: "ltx-ic-colorizer", conditioning: "source", allow_suggesting: false })]);
    expect(restyleBody({ source: "job-1", restyle: "colorize", words: "warm autumn leaves" })).toEqual({ model: "ltx25-max", source: "job-1", lora: "ltx-ic-colorizer", strength: 1, prompt: "warm autumn leaves, natural realistic colours, daylight", conditioning: "source" });
    expect(restyleBody({ source: "job-1", restyle: "colorize" }).prompt).toBe("natural realistic colours, daylight");
  });

  test("failure copy gives a plain line for each Stack code", () => {
    for (const code of ["ic_lora_refused", "no_memory", "not_installed", "lora_missing"] as const) expect(RESTYLE_FAILURE_COPY[code]).toMatch(/\S/);
  });
});

describe("the arguments", () => {
  test("spatial_sound still takes surround and side, and surround is refused with restyle", () => {
    expect(editVideoArgs.safeParse({ clip: "latest", change: "spatial_sound", surround: true, side: "left" }).success).toBe(true);
    expect(editVideoArgs.safeParse({ clip: "latest", change: "spatial_sound" }).success).toBe(true);
    expect(editVideoArgs.safeParse({ clip: "latest", change: "restyle", restyle: "colorize", surround: true }).success).toBe(false);
    expect(editVideoArgs.safeParse({ clip: "latest", change: "restyle", restyle: "colorize", side: "left" }).success).toBe(false);
    expect(editVideoArgs.safeParse({ clip: "latest", change: "restyle", restyle: "colorize", words: "warm" }).success).toBe(true);
    expect(editVideoArgs.safeParse({ clip: "latest", change: "trim", from_s: 0, to_s: 1, surround: true }).success).toBe(false);
    expect(editVideoArgs.safeParse({ clip: "latest", change: "trim", from_s: 0, to_s: 1, restyle: "colorize" }).success).toBe(false);
    expect(editVideoArgs.safeParse({ clip: "latest", change: "restyle", restyle: "colorize", from_s: 2 }).success).toBe(false);
  });
});

describe("edit_video restyle", () => {
  test("colorize sends the Stack body, makes a new clip with the card note, and keeps the original", async () => {
    const owner = person("owner");
    const { job, state } = await makeClip(owner);
    const out = await edit(state, { clip: job.id, change: "restyle", restyle: "colorize", words: "warm autumn leaves" });
    expect(out.status).toBe("succeeded");
    const next = await finished(owner, out);
    expect(restyles).toHaveLength(1);
    expect(restyles[0]).toMatchObject({ model: "ltx25-max", source: expect.stringContaining("video-edit"), lora: COLORIZER_ID, strength: 1, prompt: "warm autumn leaves, natural realistic colours, daylight", conditioning: "source" });
    expect(next.state).toBe("done");
    expect(next.id).not.toBe(job.id);
    expect(next.request.edit).toMatchObject({ from: job.id, change: "restyle", note: RESTYLE_NOTE });
    expect(RESTYLE_NOTE).toBe("Colour added from your clip. This uses the Max model and takes a few minutes.");
    expect(getVideoJobFor(owner, job.id)?.state).toBe("done");
  });

  test("a person without the Max grant gets the Max line and nothing is sent", async () => {
    const adult = person("adult");
    const { job, state } = await makeClip(adult);
    const out = await edit(state, { clip: job.id, change: "restyle", restyle: "colorize" });
    expect(out.result?.data).toHaveProperty("refused");
    expect(out.result?.reply?.text).toContain("Max");
    expect(restyles).toHaveLength(0);
  });

  test("a child and a teen get EDIT_MINOR_LINE and nothing is sent", async () => {
    for (const role of ["child", "teen"]) {
      const minor = person(role, `${role}restyle`);
      const out = await edit(chatState(minor), { clip: "latest", change: "restyle", restyle: "colorize" });
      expect(out.result?.data).toHaveProperty("refused");
      expect(out.result?.reply?.text).toContain(EDIT_MINOR_LINE);
    }
    expect(restyles).toHaveLength(0);
  });

  test("an adult-only source gives an adult-only, locked new clip", async () => {
    const owner = person("owner");
    const { job, state } = await makeClip(owner);
    for (const file of [job.files[0]!.id, job.files[0]!.poster_id]) {
      const row = db.select().from(attachments).where(eq(attachments.id, file)).get()!;
      db.update(attachments).set({ provenance: withMark(row.provenance, { lock: "off", raiseToAdult: true })! }).where(eq(attachments.id, file)).run();
    }
    const next = await finished(owner, await edit(state, { clip: job.id, change: "restyle", restyle: "colorize" }));
    expect(next.state).toBe("done");
    expect(next.request.adultOnly).toBe(true);
    const row = db.select().from(attachments).where(eq(attachments.id, next.files[0]!.id)).get()!;
    expect(row.provenance).toContain("adult-only");
  });

  test("a missing colorizer LoRA gives a plain line that points an admin to Settings, Styles", async () => {
    fake.loras = fake.loras.filter((lora) => lora.id !== COLORIZER_ID);
    const owner = person("owner");
    const { job, state } = await makeClip(owner);
    const out = await edit(state, { clip: job.id, change: "restyle", restyle: "colorize" });
    expect(out.result?.data).toHaveProperty("refused");
    expect(out.result?.reply?.text).toContain(RESTYLE_LORA_MISSING_LINE);
    expect(RESTYLE_LORA_MISSING_LINE).toContain("Settings, Styles");
    expect(restyles).toHaveLength(0);
  });

  test("a source over ten seconds gets a plain line and nothing is sent", async () => {
    const owner = person("owner");
    const { job, state } = await makeClip(owner);
    const { videoJobs } = await import("@/db/schema");
    const files = job.files.map((file, index) => (index === 0 ? { ...file, seconds: RESTYLE_MAX_SECONDS + 2 } : file));
    db.update(videoJobs).set({ files: JSON.stringify(files) }).where(eq(videoJobs.id, job.id)).run();
    const out = await edit(state, { clip: job.id, change: "restyle", restyle: "colorize" });
    expect(out.result?.data).toHaveProperty("refused");
    expect(out.result?.reply?.text).toContain(RESTYLE_SOURCE_TOO_LONG_LINE);
    expect(restyles).toHaveLength(0);
  });

  test("a Stack refusal shows the plain line for its code, never the raw error", async () => {
    for (const code of ["ic_lora_refused", "no_memory", "not_installed", "lora_missing"] as const) {
      restyleRefusal = { status: 422, code, error: `raw ${code} detail` };
      const owner = person("owner", `owner${code.replace(/_/g, "")}`);
      const { job, state } = await makeClip(owner);
      const next = await finished(owner, await edit(state, { clip: job.id, change: "restyle", restyle: "colorize" }));
      expect(next.state).toBe("failed");
      expect(next.error).toContain(RESTYLE_FAILURE_COPY[code]);
      expect(next.error).not.toContain("raw ");
    }
  });

  test("a restyle job that fails on the Stack reads through its code", async () => {
    const owner = person("owner");
    const { job, state } = await makeClip(owner);
    fake.failWith = { error: "raw failure", code: "ic_lora_refused" } as never;
    const next = await finished(owner, await edit(state, { clip: job.id, change: "restyle", restyle: "colorize" }));
    expect(next.state).toBe("failed");
    expect(next.error).toContain(RESTYLE_FAILURE_COPY.ic_lora_refused);
  });
});
