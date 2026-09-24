import { db } from "@/db";
import { memoryEmbeddings } from "@/db/schema";

// Test-only mirror of memory.ts's own (unexported) vectorToBuffer: lets
// a test inject a known vector directly into memory_embeddings without
// going through a real embed() call, so recall()'s cosine scoring can
// be exercised with hand-picked, easy-to-reason-about numbers instead
// of the stub embedder's bag-of-words output. Upserts rather than a
// plain insert: memory.test.ts and context.test.ts (MEMORY-FLOOR-01)
// both found the stub embed backend genuinely runs in this suite, so
// remember()'s own fire-and-forget embed-on-write can still be
// mid-flight or already landed a real row for the same id - this call
// wins no matter which lands first.
export function injectVector(memoryId: string, vector: number[], space = "test", preprocess = "v1"): void {
  const row = { memoryId, space, dims: vector.length, vector: Buffer.from(new Float32Array(vector).buffer), hlc: "test-hlc", preprocess };
  db.insert(memoryEmbeddings).values(row).onConflictDoUpdate({ target: memoryEmbeddings.memoryId, set: row }).run();
}
