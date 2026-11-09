import sharp from "sharp";
import { resolveCompanionEdit } from "@/lib/companionArt";
import { submitEdit, waitPicture } from "@/lib/pictures/stack";

type Anchor = { x: number; y: number; w: number; h: number };

export const TALK_SHAPES = {
  A: "lips pressed flat, closed",
  B: "slightly open, teeth lightly together",
  C: "open medium, relaxed, as saying EH",
  D: "wide open, as saying AH",
  E: "lips rounded into a small circle with the teeth hidden, as saying the O in go",
  F: "lips pushed forward and puckered, as saying OO",
} as const;

export const TALK_EYES = {
  closed: "both eyes gently closed as in a relaxed blink",
  half: "both eyes about half closed",
} as const;

const OUT = 1024;
const BACKDROP = "#d0d0d0";

/** One seed per companion so every mouth shape comes from the same face. */
function companionSeed(companionId: string): number {
  let hash = 2166136261;
  for (const char of companionId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

/**
 * The square cut-out the engine edits. The anchor is a top-left box in fractions of the picture,
 * so its centre is (x + w/2, y + h/2). cx and cy are relative to the cut-out.
 */
function geometry(width: number, height: number, anchor: Anchor, eyes = false) {
  const cx = (anchor.x + anchor.w / 2) * width;
  const cy = (anchor.y + anchor.h / 2) * height;
  const wanted = Math.round(Math.max(anchor.w * width, anchor.h * height) * (eyes ? 3 : 2));
  const side = Math.max(1, Math.min(wanted, width, height));
  const left = Math.max(0, Math.min(width - side, Math.round(cx - side / 2)));
  const top = Math.max(0, Math.min(height - side, Math.round(cy - side / 2)));
  return { left, top, side, cx: cx - left, cy: cy - top };
}

export function talkCropGeometry(width: number, height: number, anchor: Anchor, eyes = false) {
  return geometry(width, height, anchor, eyes);
}

async function maskPng(side: number, cx: number, cy: number, rx: number, ry: number) {
  const svg = `<svg width="${side}" height="${side}" xmlns="http://www.w3.org/2000/svg">` +
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="white"/></svg>`;
  return sharp({ create: { width: side, height: side, channels: 3, background: "black" } })
    .composite([{ input: Buffer.from(svg), blend: "over" }])
    .png()
    .toBuffer();
}

export async function makeTalkPicture(input: {
  rest: Uint8Array;
  anchor: Anchor;
  instruction: string;
  companionId: string;
  eyes?: boolean;
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  const flat = await sharp(input.rest).flatten({ background: BACKDROP }).png().toBuffer();
  const meta = await sharp(flat).metadata();
  const width = meta.width!;
  const height = meta.height!;
  const g = geometry(width, height, input.anchor, input.eyes);
  const region = { left: g.left, top: g.top, width: g.side, height: g.side };
  const crop = await sharp(flat).extract(region).resize(OUT, OUT).png().toBuffer();
  const scale = OUT / g.side;

  // The paste ellipse, in cut-out pixels. The edit mask is that ellipse grown by 1.15.
  const pasteRx = input.anchor.w * width * 0.46;
  const pasteRy = input.anchor.h * height * 0.46;
  const mask = await maskPng(OUT, g.cx * scale, g.cy * scale, Math.max(1, pasteRx * scale * 1.15), Math.max(1, pasteRy * scale * 1.15));

  const form = new FormData();
  form.append("image", new File([new Uint8Array(crop)], "talk.png", { type: "image/png" }));
  form.append("mask", new File([new Uint8Array(mask)], "mask.png", { type: "image/png" }));
  form.append("operation", "edit_masked");
  form.append("instruction", input.instruction);
  form.append("image_source", "uploaded");
  form.append("audience", "all-ages");
  form.append("timeout_ms", "1");
  form.append("model", resolveCompanionEdit().model);
  form.append("seed", String(companionSeed(input.companionId)));
  const job = await submitEdit(form);
  const result = await waitPicture(job.job, input.signal);

  const edited = await sharp(result.bytes).flatten({ background: BACKDROP }).resize(g.side, g.side).removeAlpha().raw().toBuffer();
  const localCx = Math.round(g.cx);
  const localCy = Math.round(g.cy);
  if (!input.eyes) {
    const base = await sharp(flat).extract(region).removeAlpha().raw().toBuffer();
    await matchRing(edited, base, g.side, localCx, localCy, Math.round(pasteRx * 1.15), Math.round(pasteRy * 1.15));
  }

  // Feather: a Gaussian whose reach (3 sigma) stays inside the anchor box, so the crop served for the
  // anchor box carries every changed pixel.
  const feather = Math.min(8, 0.04 * Math.min(input.anchor.w * width, input.anchor.h * height));
  const reach = [localCx - pasteRx - feather, localCy - pasteRy - feather, localCx + pasteRx + feather, localCy + pasteRy + feather];
  if (reach[0]! < 0 || reach[1]! < 0 || reach[2]! > g.side || reach[3]! > g.side) {
    throw new Error("The talk anchor is too close to the picture edge.");
  }
  const alphaSvg = `<svg width="${g.side}" height="${g.side}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><filter id="b"><feGaussianBlur stdDeviation="${feather / 3}"/></filter></defs>` +
    `<rect width="100%" height="100%" fill="black"/>` +
    `<ellipse cx="${localCx}" cy="${localCy}" rx="${pasteRx}" ry="${pasteRy}" fill="white" filter="url(#b)"/></svg>`;
  const alpha = await sharp(Buffer.from(alphaSvg)).greyscale().raw().toBuffer();
  const piece = await sharp(edited, { raw: { width: g.side, height: g.side, channels: 3 } })
    .joinChannel(alpha, { raw: { width: g.side, height: g.side, channels: 1 } })
    .png()
    .toBuffer();
  return new Uint8Array(await sharp(flat).composite([{ input: piece, left: g.left, top: g.top }]).png().toBuffer());
}

/** Moves the edited picture's average colour in a ring below the mouth to the rest picture's, in place. */
async function matchRing(edited: Buffer, base: Buffer, side: number, cx: number, cy: number, rx: number, ry: number): Promise<void> {
  const ringSvg = `<svg width="${side}" height="${side}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/>` +
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx + 40}" ry="${ry + 40}" fill="black"/></svg>`;
  const ring = await sharp(Buffer.from(ringSvg)).greyscale().raw().toBuffer();
  const before = [0, 0, 0];
  const after = [0, 0, 0];
  const firstRow = Math.max(0, cy - ry * 2);
  let count = 0;
  for (let p = 0; p < ring.length; p++) {
    if (ring[p]! <= 127 || Math.floor(p / side) <= firstRow) continue;
    count++;
    for (let c = 0; c < 3; c++) {
      before[c]! += base[p * 3 + c]!;
      after[c]! += edited[p * 3 + c]!;
    }
  }
  if (!count) return;
  for (let p = 0; p < edited.length; p++) {
    const shift = Math.round(before[p % 3]! / count - after[p % 3]! / count);
    edited[p] = Math.max(0, Math.min(255, edited[p]! + shift));
  }
}

/** The stored picture cut to exactly the anchor box, which the kit draws over the rest picture at that box. */
export async function cutTalkCrop(png: Uint8Array, anchor: Anchor, eyes = false): Promise<Uint8Array> {
  void eyes;
  const meta = await sharp(png).metadata();
  const width = meta.width!;
  const height = meta.height!;
  const left = Math.max(0, Math.min(width - 1, Math.round(anchor.x * width)));
  const top = Math.max(0, Math.min(height - 1, Math.round(anchor.y * height)));
  const boxWidth = Math.max(1, Math.min(width - left, Math.round(anchor.w * width)));
  const boxHeight = Math.max(1, Math.min(height - top, Math.round(anchor.h * height)));
  return new Uint8Array(await sharp(png).extract({ left, top, width: boxWidth, height: boxHeight }).png().toBuffer());
}
