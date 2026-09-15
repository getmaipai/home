// ACT-02: on-disk, sha256-keyed embedding cache so a re-run (or a resume
// after a harness kill) never re-embeds text it has already seen -
// embedding tens of thousands of short texts through a local engine is
// the expensive part of this pipeline. Lifted from the emotion-only
// draft's embedTexts() (../../../../home-codex-act02/backend/scripts/
// train/turn-signal-heads.ts), unchanged in shape.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { LlamaServerClient } from "@maipai/spec/llm/ts/client.js";

function textCacheKey(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function embedBatch(client: LlamaServerClient, texts: string[]): Promise<number[][]> {
  const response = await client.embed({ model: "embed", input: texts });
  const byIndex = [...response.data].sort((a, b) => a.index - b.index);
  return byIndex.map((d) => d.embedding);
}

// Flushed to disk every this many newly-embedded texts (about 4-8
// batches), not just once at the end: a code review (2026-09-14) found
// the single end-of-call write meant a kill partway through a long call
// (GoEmotions alone is tens of thousands of texts) lost every embedding
// computed since the call started, unlike the rest of this pipeline
// (labelActStanceCorpus's own JSONL), which is built to survive exactly
// that kind of kill for at most one batch. Bun/JS has no real thread
// race on the shared `cache` object between awaits, so a periodic sync
// write from inside the worker loop is safe without a lock.
const FLUSH_EVERY = 512;

export async function embedTexts(client: LlamaServerClient, texts: readonly string[], cachePath: string, label: string): Promise<Float32Array[]> {
  const cache: Record<string, number[]> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
  const keys = texts.map(textCacheKey);
  const missingIdx = keys.map((k, i) => (cache[k] ? -1 : i)).filter((i) => i >= 0);

  if (missingIdx.length > 0) {
    console.log(`  ${label}: embedding ${missingIdx.length}/${texts.length} uncached text(s)...`);
    mkdirSync(join(cachePath, ".."), { recursive: true });
    const BATCH = 64;
    const CONCURRENCY = 4;
    let cursor = 0;
    let done = 0;
    let sinceFlush = 0;
    async function worker(): Promise<void> {
      while (cursor < missingIdx.length) {
        const start = cursor;
        cursor += BATCH;
        const idxSlice = missingIdx.slice(start, start + BATCH);
        if (idxSlice.length === 0) return;
        const batchTexts = idxSlice.map((i) => texts[i]!);
        const vectors = await embedBatch(client, batchTexts);
        for (let j = 0; j < idxSlice.length; j++) cache[keys[idxSlice[j]!]!] = vectors[j]!;
        done += idxSlice.length;
        sinceFlush += idxSlice.length;
        if (done % (BATCH * 10) < BATCH) console.log(`    ${done}/${missingIdx.length}`);
        if (sinceFlush >= FLUSH_EVERY) {
          sinceFlush = 0;
          writeFileSync(cachePath, JSON.stringify(cache));
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    writeFileSync(cachePath, JSON.stringify(cache));
  }

  return keys.map((k) => {
    const v = cache[k];
    if (!v) throw new Error("embedding cache is missing a key that was just written - internal bug");
    return Float32Array.from(v);
  });
}
