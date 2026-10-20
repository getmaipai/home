import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { devices, issues, people } from "@/db/schema";
import { publishAssetChanged } from "@/lib/deviceCommands";
import { registerFixHandler, raiseIssue, resolveIssue } from "@/lib/issues";
import { dataDir } from "@/lib/paths";
import { evaluateReply } from "@/lib/safety";
import { safetySensorMappings, type SafetyAlarmKind } from "@/lib/safetyAlarm";
import { getDeviceSettingValue } from "@/lib/settings";
import { speakerAgeBand } from "@/lib/ageBand";
import { VOICE_SETTINGS_KEYS, VOICE_ENGINE_DEFAULT, VOICE_PRESET_NAMES } from "@/settings/voiceKeys";
import { synthesizeSpeech } from "@/lib/tts";
import { voiceForSpeech } from "@/lib/voiceForSpeech";

export interface RobotClip {
  id: string;
  class: string;
  text: string;
}

export interface RobotClipEntry {
  id: string;
  text: string;
  voice_id: string;
  sha256: string;
  bytes: number;
  licence: string;
  file: string;
}

export interface RobotClipBundle {
  device_id: string;
  bundle_sha256: string;
  clips: RobotClipEntry[];
}

const ROOT = join(dataDir, "robot-clips");
const VOICE_LICENCE = "UNVERIFIED";
const renderFlights = new Map<string, Promise<RobotClipBundle | null>>();

const FIXED_CLIPS: readonly RobotClip[] = [
  { id: "unreachable-1", class: "unreachable", text: "I can't reach your Home right now." },
  { id: "unreachable-2", class: "unreachable", text: "Home isn't answering. I'll keep trying." },
  { id: "unreachable-3", class: "unreachable", text: "I'm on my own for a bit." },
  { id: "reconnect-1", class: "reconnect", text: "I'm back with Home." },
  { id: "reconnect-2", class: "reconnect", text: "Home is answering again." },
  { id: "reconnect-3", class: "reconnect", text: "I'm connected to Home again." },
  { id: "freefall", class: "freefall", text: "I fell. I've switched my motors off." },
  { id: "tipped", class: "tipped", text: "I've tipped over. My motors are off." },
  { id: "rung1-stopped-1", class: "rung1-stopped", text: "Stopped." },
  { id: "rung1-stopped-2", class: "rung1-stopped", text: "All stopped." },
  { id: "rung1-quieter-1", class: "rung1-quieter", text: "Quieter." },
  { id: "rung1-quieter-2", class: "rung1-quieter", text: "I'll be quieter." },
  { id: "alarm-generic", class: "alarm", text: "A home alarm is on." },
];

const ALARM_LABELS: Record<SafetyAlarmKind, string> = {
  smoke: "Smoke alarm",
  carbon_monoxide: "Carbon monoxide alarm",
  gas: "Gas alarm",
  water_leak: "Water leak alarm",
  alarm_panel: "Alarm panel",
};

export function buildRobotClips(): RobotClip[] {
  const alarms = safetySensorMappings().map(({ entityId, area, kind }) => {
    const id = `alarm-${kind}-${createHash("sha256").update(entityId).digest("hex").slice(0, 12)}`;
    const label = ALARM_LABELS[kind];
    const text = area ? `${label} in the ${area}.` : `${label}.`;
    return { id, class: "alarm-area", text };
  });
  return [...FIXED_CLIPS, ...alarms].sort((a, b) => a.id.localeCompare(b.id));
}

function floorReason(text: string): string | null {
  if (!text.trim()) return "the line is empty";
  if (text.length > 120) return "the line is longer than 120 characters";
  if (/(?:https?:\/\/|ftp:\/\/|www\.)\S+|\b[a-z0-9-]+\.[a-z]{2,}(?:\/\S*)?/i.test(text)) return "the line contains a web address";
  if (/[`*_~#>{}\[\]()|!\\]/.test(text)) return "the line contains markdown formatting";
  if (/\d/.test(text)) return "the line contains a digit";
  if (evaluateReply({ text }, "child").effective.action !== "allow") return "the safety check did not allow this line for a child";
  return null;
}

export function clipTextPassesFloor(text: string): boolean {
  return floorReason(text) === null;
}

function deviceFolder(deviceId: string): string {
  if (!/^[a-z0-9-]+$/.test(deviceId)) throw new Error("invalid robot device id");
  return join(ROOT, deviceId);
}

export function robotClipBundlePath(deviceId: string): string {
  return join(deviceFolder(deviceId), "bundle.json");
}

export function robotClipBundleExists(deviceId: string): boolean {
  return existsSync(robotClipBundlePath(deviceId));
}

function bundleDigestPath(deviceId: string): string {
  return join(deviceFolder(deviceId), "bundle.sha256");
}

function safeBundle(deviceId: string): RobotClipBundle | null {
  try {
    const manifestBytes = readFileSync(robotClipBundlePath(deviceId));
    const recordedDigest = readFileSync(bundleDigestPath(deviceId), "utf8").trim();
    if (createHash("sha256").update(manifestBytes).digest("hex") !== recordedDigest) return null;
    const raw = JSON.parse(manifestBytes.toString("utf8")) as RobotClipBundle;
    if (raw.device_id !== deviceId || !Array.isArray(raw.clips) || typeof raw.bundle_sha256 !== "string") return null;
    const ordered = [...raw.clips].sort((a, b) => a.id.localeCompare(b.id));
    const expected = createHash("sha256").update(ordered.map((clip) => clip.sha256).join("")).digest("hex");
    if (expected !== raw.bundle_sha256) return null;
    if (ordered.some((clip) => !/^[a-z0-9-]+$/.test(clip.id) || clip.file !== `${clip.id}.wav` || !/^[a-f0-9]{64}$/.test(clip.sha256))) return null;
    return { ...raw, clips: ordered };
  } catch {
    return null;
  }
}

export async function readRobotClipBundle(deviceId: string): Promise<RobotClipBundle | null> {
  return safeBundle(deviceId);
}

export async function robotClipAssetForDevice(deviceId: string): Promise<{
  id: string; file: string; sha256: string; bytes: number; licence: string; kind: "clip_bundle"; available: boolean;
} | null> {
  const bundle = safeBundle(deviceId);
  if (!bundle) {
    if (robotClipBundleExists(deviceId)) await integrityRepair(deviceId, "bundle", "The robot clip manifest is missing or has changed.");
    return null;
  }
  const available = await verifyBundleFiles(deviceId, bundle);
  const path = robotClipBundlePath(deviceId);
  return {
    id: "clip-bundle", file: "bundle.json", sha256: bundle.bundle_sha256,
    bytes: existsSync(path) ? statSync(path).size : 0, licence: VOICE_LICENCE, kind: "clip_bundle", available,
  };
}

async function verifyBytes(path: string, sha256: string, bytes: number): Promise<Uint8Array | null> {
  if (!existsSync(path) || statSync(path).size !== bytes) return null;
  const content = new Uint8Array(await Bun.file(path).arrayBuffer());
  return createHash("sha256").update(content).digest("hex") === sha256 ? content : null;
}

async function verifyBundleFiles(deviceId: string, bundle: RobotClipBundle): Promise<boolean> {
  for (const clip of bundle.clips) {
    if (!(await verifyBytes(join(deviceFolder(deviceId), clip.file), clip.sha256, clip.bytes))) return false;
  }
  return true;
}

async function integrityRepair(deviceId: string, clipId: string, detail: string): Promise<void> {
  const key = `clips:${deviceId}:${clipId}`;
  registerRepair(deviceId);
  await raiseIssue({
    source: "robot-clips", key, severity: "error",
    title: "A robot clip failed its integrity check",
    detail: `${detail} Render the clip bundle again from Repairs.`,
    fix: { label: "Retry robot clip bundle", action: `retry_robot_clips:${deviceId}` },
  });
}

export async function readVerifiedRobotClipAsset(deviceId: string, id: string): Promise<{
  bytes: Uint8Array; sha256: string; contentType: string;
} | null> {
  const bundle = safeBundle(deviceId);
  if (!bundle) {
    if (robotClipBundleExists(deviceId)) await integrityRepair(deviceId, "bundle", "The robot clip manifest is missing or has changed.");
    return null;
  }
  if (id === "clip-bundle") {
    if (!(await verifyBundleFiles(deviceId, bundle))) {
      await integrityRepair(deviceId, "bundle", "The robot clip bundle contains a missing or changed clip.");
      return null;
    }
    const path = robotClipBundlePath(deviceId);
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    const recordedDigest = readFileSync(bundleDigestPath(deviceId), "utf8").trim();
    if (createHash("sha256").update(bytes).digest("hex") !== recordedDigest) {
      await integrityRepair(deviceId, "bundle", "The robot clip manifest changed while it was being read.");
      return null;
    }
    return { bytes, sha256: bundle.bundle_sha256, contentType: "application/json" };
  }
  if (!id.startsWith("clip:")) return null;
  const clipId = id.slice("clip:".length);
  const clip = bundle.clips.find((entry) => entry.id === clipId);
  if (!clip) return null;
  const bytes = await verifyBytes(join(deviceFolder(deviceId), clip.file), clip.sha256, clip.bytes);
  if (!bytes) {
    await integrityRepair(deviceId, clip.id, "A robot clip file is missing or has changed.");
    return null;
  }
  return { bytes, sha256: clip.sha256, contentType: "audio/wav" };
}

function registerRepair(deviceId: string): void {
  registerFixHandler(`retry_robot_clips:${deviceId}`, async () => { await renderClipBundle(deviceId); });
}

function issueKey(deviceId: string, clipId: string): string {
  return `clips:${deviceId}:${clipId}`;
}

async function raiseClipIssue(deviceId: string, clip: RobotClip, reason: string, severity: "warning" | "error"): Promise<void> {
  registerRepair(deviceId);
  const alarm = clip.class === "alarm-area";
  await raiseIssue({
    source: "robot-clips", key: issueKey(deviceId, clip.id), severity,
    title: alarm ? "A safety alarm line was not made" : "A robot clip was not made",
    detail: alarm
      ? `The alarm line for this sensor was not made because ${reason}. Rename its area in Settings, Alarms, then retry the bundle.`
      : `The ${clip.class} clip was not made because ${reason}. Retry the bundle from Repairs.`,
    fix: { label: "Retry robot clip bundle", action: `retry_robot_clips:${deviceId}` },
  });
}

function adultVoice(deviceId: string): string {
  const robot = db.select({ personId: devices.personId }).from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.kind, "robot"))).get();
  const defaultVoice = String(VOICE_SETTINGS_KEYS.find((key) => key.key === "tts.voice_id")?.default ?? "");
  if (!robot?.personId) return defaultVoice;
  const person = db.select().from(people)
    .where(and(eq(people.id, robot.personId), eq(people.enabled, true), isNull(people.deletedAt))).get();
  if (!person) return defaultVoice;
  // A child's private tts.voice_id never reaches a robot's clips; only a preset or the engine default from the device applies.
  if (speakerAgeBand(person, new Date()) !== "adult") {
    const robotVoice = getDeviceSettingValue(deviceId, "robot.voice.id");
    return typeof robotVoice === "string" && (robotVoice === VOICE_ENGINE_DEFAULT || VOICE_PRESET_NAMES.includes(robotVoice as typeof VOICE_PRESET_NAMES[number])) ? robotVoice : defaultVoice;
  }
  return voiceForSpeech({ actor: person, deviceId });
}

function atomicWrite(path: string, bytes: Uint8Array): void {
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, bytes);
  renameSync(temp, path);
}

async function render(deviceId: string): Promise<RobotClipBundle | null> {
  const folder = deviceFolder(deviceId);
  mkdirSync(folder, { recursive: true });
  const voice = adultVoice(deviceId);
  const rendered: Array<{ clip: RobotClip; bytes: Uint8Array; sha256: string }> = [];
  let synthesisFailed = false;
  for (const clip of buildRobotClips()) {
    const reason = floorReason(clip.text);
    if (reason) {
      await raiseClipIssue(deviceId, clip, reason, "warning");
      continue;
    }
    try {
      const result = await synthesizeSpeech(clip.text, voice);
      if (!result.ok) {
        synthesisFailed = true;
        await raiseClipIssue(deviceId, clip, "the local voice engine is not available", "error");
        continue;
      }
      const bytes = new Uint8Array(await new Response(result.value.stream).arrayBuffer());
      rendered.push({ clip, bytes, sha256: createHash("sha256").update(bytes).digest("hex") });
    } catch {
      synthesisFailed = true;
      await raiseClipIssue(deviceId, clip, "the local voice engine stopped while making the line", "error");
    }
  }
  if (synthesisFailed) return safeBundle(deviceId);

  const entries: RobotClipEntry[] = rendered.map(({ clip, bytes, sha256 }) => ({
    id: clip.id, text: clip.text, voice_id: voice, sha256, bytes: bytes.byteLength,
    licence: VOICE_LICENCE, file: `${clip.id}.wav`,
  }));
  const bundleSha = createHash("sha256").update([...entries].sort((a, b) => a.id.localeCompare(b.id)).map((entry) => entry.sha256).join("")).digest("hex");
  const bundle: RobotClipBundle = { device_id: deviceId, bundle_sha256: bundleSha, clips: entries.sort((a, b) => a.id.localeCompare(b.id)) };
  const previous = safeBundle(deviceId);
  for (const { clip, bytes } of rendered) atomicWrite(join(folder, `${clip.id}.wav`), bytes);
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(bundle, null, 2)}\n`);
  atomicWrite(robotClipBundlePath(deviceId), manifestBytes);
  atomicWrite(bundleDigestPath(deviceId), new TextEncoder().encode(`${createHash("sha256").update(manifestBytes).digest("hex")}\n`));
  const currentClips = buildRobotClips();
  const currentIds = new Set(currentClips.map((clip) => clip.id));
  for (const clip of currentClips) {
    if (floorReason(clip.text) === null) await resolveIssue("robot-clips", issueKey(deviceId, clip.id));
  }
  for (const issue of db.select({ key: issues.key }).from(issues).where(eq(issues.source, "robot-clips")).all()) {
    const prefix = `clips:${deviceId}:`;
    if (issue.key.startsWith(prefix) && !currentIds.has(issue.key.slice(prefix.length))) await resolveIssue("robot-clips", issue.key);
  }
  await resolveIssue("robot-clips", issueKey(deviceId, "bundle"));
  if (previous?.bundle_sha256 !== bundleSha) publishAssetChanged(bundleSha, deviceId);
  return bundle;
}

export function renderClipBundle(deviceId: string): Promise<RobotClipBundle | null> {
  const existing = renderFlights.get(deviceId);
  if (existing) return existing;
  const flight = render(deviceId).finally(() => renderFlights.delete(deviceId));
  renderFlights.set(deviceId, flight);
  return flight;
}
