// Opt-in local bench: bun run scripts/bench/library-thumbnails.ts /path/to/photo.jpg [...]
// Uses an isolated database and leaves the supplied originals untouched.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

const photos = process.argv.slice(2);
if (!photos.length) throw new Error("Supply local photo paths.");
const scratch = mkdtempSync(join(tmpdir(),"maipai-thumb-bench-"));
process.env.MAIPAI_DATA_DIR = scratch;
process.env.MAIPAI_KEYSTORE_BACKEND = "file";
try {
  const { db, sqlite } = await import("@/db");
  const { people, attachments } = await import("@/db/schema");
  const { newPersonId, newFileId } = await import("@/lib/id");
  const { nextHlc } = await import("@/lib/hlc");
  const { fileThumbnail } = await import("@/lib/fileThumbnails");
  const now = new Date().toISOString();
  const actor = db.insert(people).values({ id:newPersonId(),displayName:"Sage",role:"owner",avatarSeed:"sage",source:"hub",createdAt:now,updatedAt:now,hlc:nextHlc() }).returning().get()!;
  for (const [index, photo] of photos.entries()) {
    const input = readFileSync(photo); const metadata = await sharp(input).metadata();
    const sha256 = createHash("sha256").update(input).digest("hex");
    const id = newFileId(); const storagePath = `people/${actor.id}/attachments/${id}`;
    mkdirSync(dirname(join(scratch,storagePath)),{ recursive:true }); writeFileSync(join(scratch,storagePath),input);
    db.insert(attachments).values({ id,ownerPersonId:actor.id,mediaType:"image/jpeg",size:input.length,sha256,storagePath,provenance:"bench",createdAt:now,hlc:nextHlc() }).run();
    for (const width of [320,640] as const) {
      const start = performance.now(); const response = await fileThumbnail(actor,id,width);
      if (response.status !== 200) throw new Error(`Preview failed: ${response.status}`);
      const size = (await response.arrayBuffer()).byteLength; const coldMs = performance.now()-start;
      const times: number[] = [];
      for (let n=0;n<100;n++) { const start = performance.now(); const warm = await fileThumbnail(actor,id,width); await warm.arrayBuffer(); times.push(performance.now()-start); }
      times.sort((a,b)=>a-b);
      console.log(JSON.stringify({ photo:index+1,inputWidth:metadata.width,inputHeight:metadata.height,inputBytes:input.length,width,bytes:size,coldMs,p50Ms:times[50],p95Ms:times[95],maxMs:times[99] }));
    }
  }
  sqlite.close();
} finally { rmSync(scratch,{ recursive:true,force:true }); }
