// ROBOT-VISION-01 (owner's ruling, 2026-10-21, docs/design/robot-vision-2026-10-21.md): a robot with its camera on keeps a short,
// expiring idea of what is around it. The robot posts a picture; the local chat model describes it in one plain sentence; the
// picture is dropped the moment that finishes; only the sentence is kept, in this process's memory, for a minute or two.
//
// The data rules (RULES.md, "Robot vision"): a picture and its description are never written to disk, never put in a stored turn,
// memory, the library, a backup, a log or a stat, never returned by any route, never shown to another person; there is no
// history, only the one latest description per robot, and it expires. Nothing here reads, writes or logs the picture's bytes
// beyond handing them once to the local chat engine through Home's own Stack client (docs/PRIVACY.md).
import { complete, type LlmImagePart } from "@/lib/llm";
import { chatModelReadsPictures } from "@/lib/chatPictures";
import { getDeviceSettingValue } from "@/lib/settings";
import { ROBOT_VISION_KEY } from "@/settings/robotVisionKeys";

export type RobotVisionMode = "continual" | "on_demand" | "none";
export type Brightness = "dark" | "dim" | "bright" | "unknown";

/** How long one description may be used. Continual mode refreshes it well inside this. */
export const SCENE_TTL_MS = 90_000;
/** One picture per robot at most this often; the robot's cadence is slower, this is the hub's own floor. */
export const MIN_FRAME_INTERVAL_MS = 4_000;
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
}

const scenes = new Map<string, RobotScene>();
const lastFrameAt = new Map<string, number>();

/** The latest description for this robot, or null when there is none or it has expired. An expired one is deleted on the way. */
export function sceneFor(deviceId: string, now = Date.now()): RobotScene | null {
  const scene = scenes.get(deviceId);
  if (!scene) return null;
  if (scene.expiresAt <= now) {
    scenes.delete(deviceId);
    return null;
  }
  return scene;
}

export function clearScene(deviceId: string): void {
  scenes.delete(deviceId);
  lastFrameAt.delete(deviceId);
}

/** Expired descriptions leave memory on a timer even if nobody asks for them. */
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [id, scene] of scenes) if (scene.expiresAt <= now) scenes.delete(id);
  for (const [id, at] of lastFrameAt) if (now - at > 10 * 60_000) lastFrameAt.delete(id);
}, 30_000);
(sweeper as { unref?: () => void }).unref?.();

export function __resetRobotVisionForTests(): void {
  scenes.clear();
  lastFrameAt.clear();
}

/** The one latest description as a labelled line for that robot's turns, or null. It tells the model how old the picture is and what
 * it may and may not say about it. */
export function sceneContextLine(deviceId: string, now = Date.now()): string | null {
  if (robotVisionMode(deviceId) === "none") return null;
  const scene = sceneFor(deviceId, now);
  if (!scene) return null;
  const seconds = Math.max(0, Math.round((now - scene.at) / 1000));
  const people = scene.people === null ? "unknown" : String(scene.people);
  return [
    `Looked ${seconds} seconds ago (it may be out of date): ${scene.caption}`,
    `Light: ${scene.brightness}. People in view: ${people}.`,
  ].join("\n");
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
  const last = lastFrameAt.get(input.deviceId);
  if (last !== undefined && now - last < MIN_FRAME_INTERVAL_MS) return { ok: false, status: 429, code: "too_fast", error: "Pictures are coming too fast. Wait a few seconds between pictures." };
  lastFrameAt.set(input.deviceId, now);

  const caption = await captionWithChatModel(input.bytes);
  if (caption === null) return { ok: false, status: 503, code: "no_vision", error: "Home's chat model is not reading pictures right now. Check Settings, then Engines, and try again." };
  const scene: RobotScene = { caption, people: input.people, brightness: input.brightness, at: now, expiresAt: now + SCENE_TTL_MS };
  scenes.set(input.deviceId, scene);
  return { ok: true, scene };
}
