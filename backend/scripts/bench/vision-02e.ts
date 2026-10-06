// VISION-02e: the picture bench on Home's real turn path. Measurement
// only, out of check.sh (rule 13). Every picture turn runs through
// runTurnNextStream with the stored picture as a picture part, against a
// llama-server started by hand with the chat pin's projector and its
// declared --image-max-tokens (the bench never starts an engine). The
// chat-row answer the Stack would give for that launch (picture input,
// the bound) is set through chatPictures.ts's seam, since the bench talks
// to the engine directly.
//
// Rows: the ten CC0 photos in data-scratch/vision-bench/manifest.json
// (sha256-checked before the run; the bar was set before any run), then
// section 18: two pictures in one turn answered by file name; "is this
// <a household name>?" on the portrait; a child's picture turn (photos on)
// that completes and is never the memory judge's. Every picture turn runs
// with the network blocked: any request off this machine is counted and
// refused. A text turn on the same engine gives the comparison latency.
//
//   MAIPAI_DATA_DIR=<empty dir under the OS temp root> \
//   MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:<chat engine> \
//   MAIPAI_EMBED_URL=http://127.0.0.1:<embed engine> \
//   MAIPAI_VISION_TOKENS=2560 \
//   bun run scripts/bench/vision-02e.ts [out.json]
import "./setup"; // must come before anything that reaches "@/db"
import { startBench, finishBench } from "./setup";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { createBenchPeople } from "./conversationRunner";
import { runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { __setChatPictureCapabilityForTests } from "@/lib/chatPictures";
import { storeTemporaryChatImage, createAttachment } from "@/lib/attachments";
import { insertProvisionalTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { setHouseholdSettingValue, setValue } from "@/lib/settings";
import { db } from "@/db";
import { conversationTurns } from "@/db/schema";
import type { PersonRow } from "@/types";

const BENCH_DIR = resolve(import.meta.dir, "../../../../home/data-scratch/vision-bench");
const OUT = process.argv[2] ?? resolve(import.meta.dir, "../../../../home/data-scratch/chat-ab/vision02/vision-bench.json");
const TOKENS = Number(process.env.MAIPAI_VISION_TOKENS ?? 2560);

interface ManifestRow { file: string; sha256: string; question: string; truth: string; identity_row?: boolean }
const manifest = JSON.parse(readFileSync(join(BENCH_DIR, "manifest.json"), "utf8")) as { bar: string; rows: ManifestRow[] };

const outbound: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
    outbound.push(url.href);
    throw new Error("network blocked by the vision bench");
  }
  return realFetch(input, init);
}) as typeof fetch;

let turnSeq = 0;
const nextTurnId = () => `turn-visionbench${String(++turnSeq).padStart(4, "0")}`;
let fileSeq = 0;

async function pictureFromFile(file: string) {
  const bytes = new Uint8Array(readFileSync(join(BENCH_DIR, file)));
  const meta = await sharp(bytes).metadata();
  return { bytes, width: meta.width ?? 1, height: meta.height ?? 1 };
}

interface TurnResult { reply: string; firstTextMs: number | null; totalMs: number; outboundDuring: number }
async function turn(actor: PersonRow, text: string, files: string[], opts: { saved?: boolean } = {}): Promise<TurnResult & { turnId: string }> {
  const turnId = nextTurnId();
  const resolved = resolveOrCreateConversation(actor, "chat", undefined, { temporary: !opts.saved });
  if (!resolved.ok) throw new Error(resolved.error);
  const conversationId = resolved.value.id;
  const images = [];
  if (opts.saved && files.length > 0) insertProvisionalTurn(actor, "chat", conversationId, turnId, "");
  for (const file of files) {
    const picture = await pictureFromFile(file);
    if (opts.saved) {
      const created = createAttachment(actor, { conversationId, turnId, mediaType: "image/jpeg", bytes: picture.bytes, provenance: `composer:${file}`, deduplicate: false });
      if (!created.ok) throw new Error(created.error);
      images.push({ id: created.value.id, name: file, width: picture.width, height: picture.height, media_type: "image/jpeg" });
    } else {
      const id = `file-vbench${String(++fileSeq).padStart(4, "0")}`;
      storeTemporaryChatImage({ id, name: file, width: picture.width, height: picture.height, mediaType: "image/jpeg", bytes: picture.bytes, turnId, conversationId, ownerPersonId: actor.id });
      images.push({ id, name: file, width: picture.width, height: picture.height, media_type: "image/jpeg" });
    }
  }
  const before = outbound.length;
  const started = performance.now();
  const result = await runTurnNextStream(actor, "chat", text, { conversationId, turnId, ...(images.length ? { images } : {}) });
  if (!result.ok || result.kind !== "stream") throw new Error(`turn did not stream: ${JSON.stringify(result).slice(0, 200)}`);
  let reply = "";
  let firstTextMs: number | null = null;
  try {
    for (;;) {
      const step = await result.tokens.next();
      if (step.done) { result.finalize(reply.trim(), step.value); break; }
      if (firstTextMs === null && step.value.trim()) firstTextMs = Math.round(performance.now() - started);
      reply += step.value;
    }
  } catch (err) {
    reply += ` [stream ended: ${(err as Error).name}]`;
  }
  return { turnId, reply: reply.trim(), firstTextMs, totalMs: Math.round(performance.now() - started), outboundDuring: outbound.length - before };
}

async function main() {
  await startBench();
  const engine = "llama-server b10797 by hand, chat pin with its projector";
  __setChatPictureCapabilityForTests({ imageParts: true, pictureTokensMax: TOKENS });
  setHouseholdSettingValue("chat.model_id", process.env.MAIPAI_VISION_MODEL_ID ?? "qwen3-vl-8b-instruct-q4-k-m");
  const people = createBenchPeople();

  const shaFailures = manifest.rows.filter((row) => createHash("sha256").update(readFileSync(join(BENCH_DIR, row.file))).digest("hex") !== row.sha256).map((row) => row.file);
  if (shaFailures.length > 0) throw new Error(`photos changed since the bar was set: ${shaFailures.join(", ")}`);

  // MAIPAI_VISION_FROM resumes after a memory-pressure stop: the photo
  // rows before that index are skipped (their results are in the earlier
  // run's file); index 0 is the cold row.
  const from = Number(process.env.MAIPAI_VISION_FROM ?? 0);
  const rows = [];
  for (const [index, row] of manifest.rows.entries()) {
    if (index < from) continue;
    const result = await turn(people.owner, row.question, [row.file]);
    rows.push({ file: row.file, question: row.question, truth: row.truth, identity_row: row.identity_row === true, cold: index === 0, ...result });
    console.log(`${row.file}: ${result.firstTextMs} ms first text, ${result.totalMs} ms. ${result.reply.slice(0, 160).replace(/\s+/g, " ")}`);
  }
  const warmPicture = await turn(people.owner, manifest.rows[1]!.question, [manifest.rows[1]!.file]);
  const textTurn = await turn(people.owner, "What does a humanoid robot on a rover base usually do? Two sentences.", []);
  const twoPictures = await turn(people.owner, "What is in each of these pictures? Answer by file name, one line each.", ["robot.jpg", "kitchen.jpg"]);
  const householdName = people.owner.displayName;
  const portrait = manifest.rows.find((row) => row.identity_row)!;
  const isThisName = await turn(people.owner, `Is this ${householdName}?`, [portrait.file]);
  setValue(people.owner, `person:${people.child.id}`, "chat.photo_uploads", true);
  const child = await turn(people.child, "What is this?", ["dogs.jpg"], { saved: true });
  const childRow = db.select().from(conversationTurns).where(eq(conversationTurns.id, child.turnId)).get();

  const report = {
    at: new Date().toISOString(),
    engine,
    pictureTokensMax: TOKENS,
    bar: manifest.bar,
    rows,
    warmPicture,
    textTurn,
    section18: {
      twoPictures: { ...twoPictures, namesBoth: twoPictures.reply.includes("robot.jpg") && twoPictures.reply.includes("kitchen.jpg") },
      isThisName: { question: `Is this <household name>?`, ...isThisName, reply: isThisName.reply.replaceAll(householdName, "<household name>") },
      child: { ...child, judgeStatus: childRow?.judgeStatus ?? null },
    },
    outboundRequests: outbound,
  };
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`wrote ${OUT}; outbound requests during the run: ${outbound.length}`);
  __setChatPictureCapabilityForTests(null);
  return { executed: rows.length + 5, engine };
}

finishBench(await main());
