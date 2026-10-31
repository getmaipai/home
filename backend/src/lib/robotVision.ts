// ROBOT-VISION-01 (owner's ruling, 2026-10-21, docs/design/robot-vision-2026-10-21.md): a robot with its camera on keeps a short,
// expiring idea of what is around it. The robot posts a picture; the local chat model describes it in one plain sentence; the
// picture is dropped the moment that finishes; only the sentence is kept, in this process's memory, for a minute or two.
//
// The data rules (RULES.md, "Robot vision"): a picture and its description are never written to disk, never put in a stored turn,
// memory, the library, a backup, a log or a stat, never returned by any route, never shown to another person; there is no
// history, only the one latest description per robot, and it expires. Nothing here reads, writes or logs the picture's bytes
// beyond handing them once to the local chat engine through Home's own Stack client (docs/PRIVACY.md).
import { complete, type LlmImagePart } from "@/lib/llm";
import { chatLeaseHeld } from "@/lib/chatLease";
import { chatModelReadsPictures } from "@/lib/chatPictures";
import { getDeviceSettingValue, getHouseholdSettingValue } from "@/lib/settings";
import { activeTurnCount } from "@/lib/turnActivity";
import { getStackClient } from "@/lib/stackEngine";
import { ROBOT_VISION_KEY } from "@/settings/robotVisionKeys";
import type { LookResult } from "@maipai/spec/gen/ts/look-result.js";

export type RobotVisionMode = "continual" | "on_demand" | "none";
export type Brightness = "dark" | "dim" | "bright" | "unknown";

/** How long one description may be used. Continual mode refreshes it well inside this. */
export const SCENE_TTL_MS = 90_000;
/** One picture per robot at most this often; the robot's cadence is slower, this is the hub's own floor. */
export const MIN_FRAME_INTERVAL_MS = 4_000;
/** ROBOT-VISION-BUSY-01: the background look is the lowest priority (chat, then pictures, then video, then the rest), so it is rare. */
export const SCENE_FRAME_INTERVAL_MS = 30_000;
export const MAX_FRAME_BYTES = 512 * 1024;
/** What an on-demand look may reuse: a description younger than this answers "what do you see" without a new picture. */
export const FRESH_ENOUGH_MS = 12_000;

export function robotVisionMode(deviceId: string): RobotVisionMode {
  const value = getDeviceSettingValue(deviceId, ROBOT_VISION_KEY);
  return value === "on_demand" || value === "none" ? value : "continual";
}

export interface RobotScene {
  /** One plain sentence, at most about 25 words. Never a name; never a body. */
  caption: string;
  /** How many faces the robot's own detector counted in the same frame (a number the robot sends; the picture is not counted here). */
  people: number | null;
  brightness: Brightness;
  at: number;
  expiresAt: number;
  /** LOOK-01: what the Stack's Look found in the latest picture, kept in this process's memory only and never returned by a route. */
  look?: SceneLook;
}

/** One kind of thing the robot has seen, with the details a detailed look gave it. Lives at most SCENE_TTL_MS after it was last seen. */
export interface SeenObject {
  label: string;
  count: number;
  colour?: string;
  kind?: string;
  make?: string;
  model?: string;
  uncertain: boolean;
  lastSeen: number;
}

export interface SceneLook {
  objects: SeenObject[];
  tags: string[];
  colours: string[];
  roomType?: string;
  light: Brightness;
}

const scenes = new Map<string, RobotScene>();
const lastFrameAt = new Map<string, number>();
const lastSceneFrameAt = new Map<string, number>();
/** Robots with a picture being described right now. */
const captioning = new Set<string>();


/** The Stack's Look capability, as Home calls it: a picture in, a LookResult out, null when it cannot look right now. "detailed" crops each
 * object it found (never a person) and describes it; the crops stay inside that call. The picture is not kept by the caller. */
export type LookFn = (bytes: Uint8Array, detail: "fast" | "detailed", source: string) => Promise<LookResult | null>;
let lookForTests: LookFn | null = null;
/** Test seam: a Look without a Stack. */
export function __setLookForTests(fn: LookFn | null): void {
  lookForTests = fn;
}

/** A background look is droppable: a slow Stack costs the robot this one look, not a stuck request. */
const LOOK_TIMEOUT_MS = 8_000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

/** Read the Stack's reply into a LookResult. Read, not trusted: only the fields Home keeps, bounded, and an object the Stack marks stale
 * (a track it remembered from an earlier picture) is left out, because Home keeps its own 90 seconds and must not extend the Stack's. */
export function readStackLook(raw: unknown): LookResult | null {
  if (!isRecord(raw) || !Array.isArray(raw.objects) || !isRecord(raw.scene)) return null;
  const objects: LookResult["objects"] = [];
  for (const entry of raw.objects.slice(0, 64)) {
    if (!isRecord(entry) || entry.stale === true) continue;
    const label = text(entry.label, 64);
    if (!label) continue;
    const attributes: Record<string, string> = {};
    if (isRecord(entry.attributes)) {
      for (const key of ["colour", "kind", "make", "model"] as const) {
        const value = text(entry.attributes[key], 64);
        if (value) attributes[key] = value;
      }
    }
    objects.push({
      label,
      count: typeof entry.count === "number" && entry.count >= 1 ? Math.floor(entry.count) : 1,
      score: typeof entry.score === "number" ? Math.min(1, Math.max(0, entry.score)) : 0,
      uncertain: entry.uncertain === true,
      ...(Object.keys(attributes).length ? { attributes } : {}),
    });
  }
  const light = raw.scene.light === "dark" || raw.scene.light === "dim" || raw.scene.light === "bright" ? raw.scene.light : null;
  if (light === null) return null;
  const tags = (Array.isArray(raw.scene.tags) ? raw.scene.tags : []).flatMap((tag) => {
    if (!isRecord(tag)) return [];
    const label = text(tag.label, 64);
    return label ? [{ label, score: typeof tag.score === "number" ? Math.min(1, Math.max(0, tag.score)) : 0 }] : [];
  }).slice(0, 64);
  const colours = (Array.isArray(raw.scene.colours) ? raw.scene.colours : []).flatMap((colour) => text(colour, 32) ?? []).slice(0, 8);
  const roomType = text(raw.scene.room_type, 64);
  const cost = isRecord(raw.cost) && typeof raw.cost.ms === "number" ? raw.cost.ms : 0;
  return { objects, scene: { light, tags, ...(roomType ? { room_type: roomType } : {}), colours }, cost: { ms: cost, tier: raw.cost && isRecord(raw.cost) && raw.cost.tier === "detailed" ? "detailed" : "fast" } };
}

/** Ask the Stack's Look about one picture, with no language model on the fast tier. Any refusal or failure (the Look part not installed,
 * detail not built yet, too many looks, no memory, a timeout) is a plain null: the caller falls back to the caption. Nothing is logged;
 * a failure's text is never kept because it may carry the Stack's own words about the picture. */
async function lookViaStack(bytes: Uint8Array, detail: "fast" | "detailed", source: string): Promise<LookResult | null> {
  if (lookForTests) return lookForTests(bytes, detail, source);
  try {
    const form = new FormData();
    form.set("image", new Blob([bytes], { type: "image/jpeg" }), "camera.jpg");
    form.set("source", source);
    form.set("detail", detail);
    return readStackLook(await getStackClient().look(form, { signal: AbortSignal.timeout(LOOK_TIMEOUT_MS) }));
  } catch {
    return null;
  }
}

const MAX_SEEN_OBJECTS = 24;
const PERSON_LABEL = "person";

/** Fold a new look into what the robot already knows. A kind of thing seen again is refreshed (its count follows the new picture, its
 * details are kept unless the new look brings some); a kind not in this picture stays until SCENE_TTL_MS after it was last seen. Details
 * are never kept for a person. */
export function mergeLook(previous: SceneLook | undefined, result: LookResult, now: number): SceneLook {
  const kept = new Map<string, SeenObject>();
  for (const old of previous?.objects ?? []) if (now - old.lastSeen < SCENE_TTL_MS) kept.set(old.label, old);
  for (const found of result.objects) {
    const before = kept.get(found.label);
    const details = found.label === PERSON_LABEL ? {} : (found.attributes ?? {});
    kept.set(found.label, {
      label: found.label,
      count: found.count,
      ...(details.colour ?? before?.colour ? { colour: details.colour ?? before?.colour } : {}),
      ...(details.kind ?? before?.kind ? { kind: details.kind ?? before?.kind } : {}),
      ...(details.make ?? before?.make ? { make: details.make ?? before?.make } : {}),
      ...(details.model ?? before?.model ? { model: details.model ?? before?.model } : {}),
      uncertain: found.uncertain,
      lastSeen: now,
    });
  }
  const objects = [...kept.values()].sort((a, b) => b.lastSeen - a.lastSeen || b.count - a.count).slice(0, MAX_SEEN_OBJECTS);
  return {
    objects,
    tags: result.scene.tags.slice().sort((a, b) => b.score - a.score).map((tag) => tag.label),
    colours: result.scene.colours ?? [],
    ...(result.scene.room_type ? { roomType: result.scene.room_type } : {}),
    light: result.scene.light,
  };
}

/** True when a kind of thing has not been seen for SCENE_TTL_MS or more. */
function stillSeen(object: SeenObject, now: number): boolean {
  return now - object.lastSeen < SCENE_TTL_MS;
}

/** The latest description for this robot, or null when there is none or it has expired. An expired one is deleted on the way. */
export function sceneFor(deviceId: string, now = Date.now()): RobotScene | null {
  const scene = scenes.get(deviceId);
  if (!scene) return null;
  if (scene.expiresAt <= now) {
    scenes.delete(deviceId);
    return null;
  }
  if (scene.look) scene.look = { ...scene.look, objects: scene.look.objects.filter((object) => stillSeen(object, now)) };
  return scene;
}

export function clearScene(deviceId: string): void {
  scenes.delete(deviceId);
  lastFrameAt.delete(deviceId);
  lastSceneFrameAt.delete(deviceId);
}

/** Expired descriptions leave memory on a timer even if nobody asks for them. */
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [id, scene] of scenes) if (scene.expiresAt <= now) scenes.delete(id);
  for (const [id, at] of lastFrameAt) if (now - at > 10 * 60_000) lastFrameAt.delete(id);
  for (const [id, at] of lastSceneFrameAt) if (now - at > 10 * 60_000) lastSceneFrameAt.delete(id);
}, 30_000);
(sweeper as { unref?: () => void }).unref?.();

export function __resetRobotVisionForTests(): void {
  scenes.clear();
  lastFrameAt.clear();
  lastSceneFrameAt.clear();
  captioning.clear();
}

/** The one latest description as a labelled line for that robot's turns, or null. It tells the model how old the picture is and what
 * it may and may not say about it. */
export function sceneContextLine(deviceId: string, now = Date.now()): string | null {
  if (robotVisionMode(deviceId) === "none") return null;
  const scene = sceneFor(deviceId, now);
  if (!scene) return null;
  const seconds = Math.max(0, Math.round((now - scene.at) / 1000));
  const people = scene.people === null ? "unknown" : String(scene.people);
  if (scene.look && !scene.caption) {
    const seen = scene.look.objects.map(objectPhrase);
    const parts = [`Looked ${seconds} seconds ago (it may be out of date): ${seen.length ? seen.join(", ") : "nothing it recognises"}`];
    if (scene.look.roomType) parts.push(`room: ${scene.look.roomType}`);
    if (scene.look.colours.length) parts.push(`colours: ${scene.look.colours.slice(0, 4).join(", ")}`);
    return [`${parts.join("; ")}.`, `Light: ${scene.brightness === "unknown" ? scene.look.light : scene.brightness}. People in view: ${people}.`].join("\n");
  }
  return [
    `Looked ${seconds} seconds ago (it may be out of date): ${scene.caption}`,
    `Light: ${scene.brightness}. People in view: ${people}.`,
  ].join("\n");
}

/** "a person", "3 chairs", "a blue Tesla Model 3 (a guess)". Plain words; a person is only ever counted. */
function objectPhrase(object: SeenObject): string {
  if (object.label === PERSON_LABEL) return object.count === 1 ? "a person" : `${object.count} people`;
  const named = [object.colour, object.make, object.model].filter(Boolean).join(" ");
  const base = named ? `${named} ${object.kind ?? object.label}`.trim() : object.label;
  const counted = object.count > 1 ? `${object.count} ${base}s` : `a ${base}`;
  return object.uncertain && (object.make || object.model || object.kind) ? `${counted} (a guess)` : counted;
}

const CAPTION_SYSTEM = [
  "You describe what a small home robot's camera sees, for the robot's own awareness.",
  "Write exactly one plain sentence of at most 25 words about the room, the objects, and how many people are visible and what they are doing.",
  "Never name or identify anyone, never guess who a person is, never describe anyone's body or what they are wearing in detail.",
  "If it is too dark or too blurry to see, say so in a few words.",
  "Do not use quotation marks, lists or markdown.",
].join(" ");

export type FrameOutcome =
  | { ok: true; scene: RobotScene }
  | { ok: false; status: 400 | 403 | 413 | 415 | 429 | 503; code: string; error: string };

export interface FrameInput {
  deviceId: string;
  bytes: Uint8Array;
  /** The robot's own face count for this frame, when it has one. */
  people: number | null;
  brightness: Brightness;
  /** "scene" is the robot's background refresh; "ask" is a look the person asked for (allowed in on_demand mode). */
  purpose: "scene" | "ask";
  now?: number;
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

/** Plain, short, no quotes or line breaks, no names. The caption goes into a prompt, so it is also kept to one line of ordinary text. */
export function cleanCaption(raw: string): string {
  const oneLine = raw.replace(/\s+/g, " ").replace(/["“”`*#_>\[\]{}]/g, "").trim();
  const words = oneLine.split(" ").filter(Boolean).slice(0, 30).join(" ");
  return words.slice(0, 220);
}

let captionForTests: ((bytes: Uint8Array) => Promise<string | null>) | null = null;
/** Test seam: the description of a picture, without a Stack. */
export function __setCaptionForTests(fn: ((bytes: Uint8Array) => Promise<string | null>) | null): void {
  captionForTests = fn;
}

async function captionWithChatModel(bytes: Uint8Array): Promise<string | null> {
  if (captionForTests) return captionForTests(bytes);
  const capability = await chatModelReadsPictures();
  if (!capability.imageParts || capability.pictureTokensMax === null) return null;
  const image: LlmImagePart = {
    id: "robot-camera",
    name: "camera",
    url: `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`,
    reservedTokens: capability.pictureTokensMax,
  };
  const result = await complete(
    "chat",
    [
      { role: "system", content: CAPTION_SYSTEM },
      { role: "user", content: "Describe this camera picture.", images: [image] },
    ],
    { max_tokens: 70, temperature: 0.2, thinking: false, dropReasoning: true },
  );
  if (!result.ok) return null;
  const text = cleanCaption(result.value.text);
  return text || null;
}

/** Take one picture from a robot: check the setting, the size, the type and the pace, describe it, drop it, keep the sentence. */
export async function acceptFrame(input: FrameInput): Promise<FrameOutcome> {
  const now = input.now ?? Date.now();
  const mode = robotVisionMode(input.deviceId);
  if (mode === "none") return { ok: false, status: 403, code: "vision_off", error: "This robot's camera is turned off in Settings, so Home does not take pictures from it. Turn on Robot vision for this robot to use it." };
  if (mode === "on_demand" && input.purpose !== "ask") return { ok: false, status: 403, code: "vision_on_demand", error: "This robot looks only when someone asks it to. Send a picture only for an ask, or set Robot vision to Always watching." };
  if (input.bytes.byteLength > MAX_FRAME_BYTES) return { ok: false, status: 413, code: "too_large", error: "A camera picture must be under 512 KB. Send a smaller one." };
  if (!isJpeg(input.bytes)) return { ok: false, status: 415, code: "not_jpeg", error: "A camera picture must be a JPEG." };
  const scene = input.purpose === "scene";
  const last = (scene ? lastSceneFrameAt : lastFrameAt).get(input.deviceId);
  const floor = scene ? SCENE_FRAME_INTERVAL_MS : MIN_FRAME_INTERVAL_MS;
  if (last !== undefined && now - last < floor) return { ok: false, status: 429, code: "too_fast", error: "Pictures are coming too fast. Wait a few seconds between pictures." };
  // ROBOT-VISION-BUSY-01: a look never competes with real work. Coding mode refuses every look; a background look also waits for any running
  // chat turn; and only one picture is described at a time per robot (dropped, never stacked). Nothing touches the model before these.
  const busy = chatLeaseHeld() || (scene && activeTurnCount() > 0) || captioning.has(input.deviceId);
  if (busy) return { ok: false, status: 503, code: "busy", error: "Home is busy with something else right now, so the robot skipped this look. It will try again later." };
  (scene ? lastSceneFrameAt : lastFrameAt).set(input.deviceId, now);
  captioning.add(input.deviceId);
  // LOOK-01: the Stack's Look names what is in the picture with no language model; an asked look also gets per-object details. When Look
  // cannot answer (not built on this Stack, or busy), the one-sentence caption by the chat model is the fallback, as before.
  let caption: string | null = null;
  let look: LookResult | null = null;
  try {
    look = await lookViaStack(input.bytes, scene ? "fast" : "detailed", input.deviceId);
    if (look === null) caption = await captionWithChatModel(input.bytes);
  } finally {
    captioning.delete(input.deviceId);
  }
  if (look === null && caption === null) return { ok: false, status: 503, code: "no_vision", error: "Home's chat model is not reading pictures right now. Check Settings, then Engines, and try again." };
  const brightness: Brightness = input.brightness !== "unknown" ? input.brightness : look ? look.scene.light : "unknown";
  const result: RobotScene = {
    caption: caption ?? "",
    people: input.people,
    brightness,
    at: now,
    expiresAt: now + SCENE_TTL_MS,
    ...(look ? { look: mergeLook(scenes.get(input.deviceId)?.look, look, now) } : {}),
  };
  scenes.set(input.deviceId, result);
  return { ok: true, scene: result };
}
