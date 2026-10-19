#!/usr/bin/env bun
// LIBRARY-REVAMP-13: real Library content for scripts/screenshot.ts --library-review. Pictures are real generated images
// (so the thumbnail route has pixels to resize); the video, song and PDF are small stand-ins that carry the right media
// type. Persona names only. Run against a scratch data directory (MAIPAI_DATA_DIR), never a live hub.
//
//   bun run scripts/seed-library-review.ts <ownerDisplayName> <sharedWithDisplayName> [bulkCount]
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { people } from "../src/db/schema";
import { storeFile } from "../src/lib/attachments";
import { createShare } from "../src/lib/shares";

const [ownerName, shareName, bulkArg] = process.argv.slice(2);
if (!ownerName || !shareName) { console.error("usage: bun run scripts/seed-library-review.ts <owner> <shareWith> [bulkCount]"); process.exit(1); }
const person = (name: string) => { const row = db.select().from(people).where(eq(people.displayName, name)).get(); if (!row) { console.error(`no such person: ${name}`); process.exit(1); } return row; };
const owner = person(ownerName), other = person(shareName);

async function picture(width: number, height: number, from: [number, number, number], to: [number, number, number], format: "png" | "jpeg" = "jpeg") {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const t = (x / width + y / height) / 2, o = (y * width + x) * 3;
    raw[o] = from[0] + (to[0] - from[0]) * t; raw[o + 1] = from[1] + (to[1] - from[1]) * t; raw[o + 2] = from[2] + (to[2] - from[2]) * t;
  }
  const image = sharp(raw, { raw: { width, height, channels: 3 } });
  return new Uint8Array(await (format === "png" ? image.png() : image.jpeg({ quality: 82 })).toBuffer());
}
function put(name: string, mediaType: string, bytes: Uint8Array, provenance = "library:upload", retention: "kept" | "conversation" = "kept") {
  const stored = storeFile(owner, { conversationId: null, turnId: null, mediaType, bytes, provenance, retention, name });
  if (!stored.ok) { console.error(`could not store ${name}: ${stored.error}`); process.exit(1); }
  return stored.value.id;
}
const text = (value: string) => new TextEncoder().encode(value);

const fox = put("Fox in the snow", "image/jpeg", await picture(1600, 1000, [91, 141, 239], [240, 163, 94]), "picture-gen:{\"v\":1,\"audience\":\"all-ages\",\"prompt\":\"A fox in the snow\"}");
const garden = put("Garden at dawn", "image/jpeg", await picture(1600, 1000, [47, 158, 111], [232, 211, 106]), "picture-gen:{\"v\":1,\"audience\":\"all-ages\",\"prompt\":\"Garden at dawn\"}");
put("Harbour at night", "image/jpeg", await picture(1200, 1600, [20, 30, 80], [200, 120, 200]));
put("Trip plan.pdf", "application/pdf", text("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"));
put("Packing list.txt", "text/plain", text("Tent\nStove\nMaps\n"));
put("Otters in a kitchen", "video/mp4", Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0, 0, 0, 0, 0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d]), "video-gen:{\"v\":1,\"seconds\":9,\"prompt\":\"Otters in a kitchen\"}", "conversation");
put("Moonlit lullaby", "audio/mp4", Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0, 0x4d, 0x34, 0x41, 0x20, 0x6d, 0x70, 0x34, 0x32]));
const adults = put("After hours", "image/jpeg", await picture(1200, 800, [120, 20, 60], [30, 10, 40]), "picture-gen:{\"v\":1,\"audience\":\"adult-only\",\"prompt\":\"After hours\"}", "conversation");
void adults;
for (const [id, to] of [[fox, "household"], [garden, other.id]] as const) {
  const shared = createShare(owner, { fileId: id, to, provenance: "screenshot-seed" });
  if (!shared.ok) { console.error(`could not share: ${shared.error}`); process.exit(1); }
}
const bulk = Number(bulkArg ?? 0);
for (let i = 0; i < bulk; i++) put(`Photo ${String(i + 1).padStart(4, "0")}`, "image/jpeg", await picture(24 + (i % 100), 24 + (Math.floor(i / 100) % 100), [(i * 37) % 255, (i * 91) % 255, (i * 53) % 255], [(i * 17) % 255, (i * 29) % 255, 200]));
console.log(`seeded the Library for ${ownerName} (${bulk} extra pictures)`);
