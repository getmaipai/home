// A fetch-only Stack stand-in. No music service, audio encoder or model is started.
import { __setMusicFetchForTests, type MusicBody, type StackMusicJob } from "@/lib/music/stack";
import { __setMusicStatusForTests, readyMusicStatusForTests } from "@/lib/music/ready";
import { __resetMusicJobsForTests, __setMusicPollMsForTests } from "@/lib/music/jobs";
import { resolveOrCreateConversation, logTurn } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import type { PersonRow } from "@/types";
import type { TurnState } from "@/lib/turnMachine/contract";
export const LYRICS = "[Verse]\nMorning light\nWarm and bright\n[Chorus]\nPancakes rise\nUnder sunny skies\n[Verse 2]\nCoffee flows\n[Chorus]\nPancakes rise\nUnder sunny skies";
export const LRC = "[00:01.00]Morning light\n[00:05.00]Warm and bright\n[00:20.00]Pancakes rise\n[00:25.00]Under sunny skies\n[00:40.00]Coffee flows\n[00:45.00]Pancakes rise\n[00:50.00]Under sunny skies";
export function testM4a(): Uint8Array {
  const bytes = new Uint8Array(4096); bytes.set([0, 0, 0, 28, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]); return bytes;
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
export function installFakeMusicStack() {
  const fake = {
    submitted: [] as MusicBody[], deleted: [] as string[], polls: new Map<string, number>(), pollsToFinish: 2,
    fail: null as { code: string; error: string } | null,
    refuse: null as { status: number; code: string; error: string } | null,
    lrc: LRC as string | ((seconds: number) => string),
    immediate: false, queued: false, model: "ace-step-1-5-turbo" as string | undefined, beforeSubmit: undefined as (() => Promise<void>) | undefined,
    stems: false,
    restore() { __setMusicFetchForTests(null); __setMusicStatusForTests(undefined); __setMusicPollMsForTests(null); __resetMusicJobsForTests(); },
  };
  __resetMusicJobsForTests(); __setMusicPollMsForTests(2); __setMusicStatusForTests(readyMusicStatusForTests());
  __setMusicFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname;
    const method = init?.method ?? "GET";
    if (path === "/stack/v1/music") return json(readyMusicStatusForTests());
    if (path === "/stack/v1/stems") return json({ available: fake.stems, state: fake.stems ? "idle" : "not-installed" });
    if (path === "/v1/audio/stems" && method === "POST") { fake.stems = true; fake.polls.set("stems-job", 0); return json({ job: "stems-job" }, 202); }
    if (path.startsWith("/v1/audio/stems/") && path.endsWith(".m4a")) return new Response(testM4a(), { headers: { "content-type": "audio/mp4" } });
    if (path === "/v1/audio/stems/stems-job") {
      const polls = (fake.polls.get("stems-job") ?? 0) + 1; fake.polls.set("stems-job", polls);
      return json(polls >= fake.pollsToFinish ? { state: "done", data: [{ url: "/v1/audio/stems/vocals.m4a", name: "vocals", duration_s: 52 }, { url: "/v1/audio/stems/drums.m4a", name: "drums", duration_s: 52 }] } : { state: "running", stage: "splitting", progress_fraction: 0.5, eta_seconds: 3 });
    }
    if (path === "/v1/audio/music" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as MusicBody;
      fake.submitted.push(body); const id = `mjob-${fake.submitted.length}`; fake.polls.set(id, 0);
      await fake.beforeSubmit?.();
      if (fake.refuse) return json(fake.refuse, fake.refuse.status);
      return json({ job: id, ...(fake.immediate ? { data: [{ duration_s: body.duration_s, seed: body.seed ?? 77, lrc: typeof fake.lrc === "function" ? fake.lrc(body.duration_s!) : fake.lrc, model: body.task === "edit" ? "none" : fake.model }] } : {}) }, fake.immediate ? 200 : 202);
    }
    const match = /^\/v1\/audio\/music\/([^/]+)(\/file)?$/.exec(path);
    if (match) {
      const id = match[1]!;
      if (method === "DELETE") { fake.deleted.push(id); return json({ ok: true }); }
      if (match[2]) return new Response(testM4a(), { headers: { "content-type": "audio/mp4" } });
      const polls = (fake.polls.get(id) ?? 0) + 1; fake.polls.set(id, polls);
      if (fake.fail?.code === "no_memory") return json({ state: "cancelled", ...fake.fail });
      if (fake.fail) return json({ state: "failed", ...fake.fail });
      const body = fake.submitted[Number(id.split("-")[1]) - 1]!;
      const result: StackMusicJob = fake.queued ? { state: "queued", stage: "queued", progress_fraction: 0, eta_seconds: 15, position: 2 } : polls >= fake.pollsToFinish
        ? { state: "done", data: [{ duration_s: body.duration_s, seed: body.seed ?? 77, lrc: typeof fake.lrc === "function" ? fake.lrc(body.duration_s!) : fake.lrc, bpm: body.bpm, key: body.key, model: body.task === "edit" ? "none" : fake.model }] }
        : { state: polls === 1 ? "queued" : "running", stage: "planning", stage_label: "Planning", progress_fraction: 0.25, eta_seconds: 15, position: 2 };
      return json(result);
    }
    return json({ code: "unknown_route" }, 404);
  }) as typeof fetch);
  return fake;
}
export function musicState(actor: PersonRow, temporary = false, conversationId?: string): TurnState {
  const conv = resolveOrCreateConversation(actor, "chat", conversationId, { temporary });
  if (!conv.ok) throw new Error("no conversation");
  const turnId = newConversationTurnId();
  if (!temporary) logTurn(actor, "chat", "make a folk song", { reply: { text: "On its way." }, source: "plugin", plugin_id: "generate_music", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conv.value.id, turn_id: turnId });
  return { actor, surface: "chat", turnId, conversationId: conv.value.id, temporary, planBasis: { surfaceClass: "written" }, context: [], utterance: "make a folk song", musicAllowed: true, musicEditAllowed: true, crisis: false } as unknown as TurnState;
}
export async function waitForMusic(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("music job did not settle"); await new Promise((r) => setTimeout(r, 5)); }
}
