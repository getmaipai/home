// LIVE-VIEW-01: a live view of the robot through the hub only (Reachy design v2 section 10.4, OWNER-ANSWERS 9).
//
// An admin, or an adult named in `robot.live_view.who`, opens the robot's live view. A child or a teen never can,
// whoever names them. It is off until an admin turns `robot.live_view.enabled` on. The hub tells the robot
// `live_view_start {view_id, fps: 5, size: 640x360}`, the robot posts JPEG frames to
// /api/devices/me/stream/{view_id}, and the hub re-serves the latest frame to the one viewer on its own route.
// Frames live in memory only: nothing is written to disk or to any store. No STUN, TURN or third-party service.
// The view stops on the browser closing, on the 10 minute cap, or when no viewer has attached for a short grace.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { devices } from "@/db/schema";
import type { PersonRow } from "@/types";
import { speakerAgeBand } from "@/lib/ageBand";
import { issueDeviceCommand } from "@/lib/deviceCommands";
import { getHouseholdSettingValue } from "@/lib/settings";

export const LIVE_VIEW_MAX_MS = 10 * 60_000;
/** A viewer has this long after the start to attach before the view is dropped. */
export const LIVE_VIEW_ATTACH_GRACE_MS = 30_000;
export const LIVE_VIEW_MAX_FRAME_BYTES = 512 * 1024;

export interface LiveView {
  viewId: string;
  deviceId: string;
  personId: string;
  startedAt: number;
  viewerAttached: boolean;
  frame: Uint8Array | null;
  listeners: Set<(frame: Uint8Array) => void>;
  timer: ReturnType<typeof setTimeout> | null;
}

const views = new Map<string, LiveView>();

export type LiveViewRefusal = { ok: false; status: 403 | 404 | 400; error: string };

/** Who may watch: live view switched on, an adult by age band (a child or teen never, even when named), and
 * an owner, an admin, or an adult named in `robot.live_view.who`. */
export function liveViewAdmits(person: PersonRow, now: Date = new Date()): { ok: true } | LiveViewRefusal {
  if (getHouseholdSettingValue("robot.live_view.enabled") !== true) {
    return { ok: false, status: 403, error: "Live view is off. An admin can turn it on in the robot settings." };
  }
  if (speakerAgeBand(person, now) !== "adult") {
    return { ok: false, status: 403, error: "Live view is for adults only. Ask an adult to watch it for you." };
  }
  if (person.role === "owner" || person.role === "admin") return { ok: true };
  const who = getHouseholdSettingValue("robot.live_view.who");
  if (Array.isArray(who) && who.includes(person.id)) return { ok: true };
  return { ok: false, status: 403, error: "You are not on the live view list. Ask an admin to add you in the robot settings." };
}

export function getLiveView(viewId: string): LiveView | undefined {
  return views.get(viewId);
}

/** Starts a view on one robot. The robot must be the caller's own or the caller must be an owner or admin,
 * the same reach as the other robot commands. One view per robot: a new start replaces the old one. */
export function startLiveView(person: PersonRow, deviceId: string, now: Date = new Date()): { ok: true; viewId: string } | LiveViewRefusal {
  const admitted = liveViewAdmits(person, now);
  if (!admitted.ok) return admitted;
  const device = db.select().from(devices).where(eq(devices.id, deviceId)).get();
  if (!device || (device.personId !== person.id && person.role !== "owner" && person.role !== "admin")) {
    return { ok: false, status: 404, error: "No such robot. Pick one of the robots on the Devices page." };
  }
  if (device.kind !== "robot") return { ok: false, status: 400, error: "That device is not a robot, so it has no camera to show." };
  for (const view of views.values()) if (view.deviceId === deviceId) stopLiveView(view.viewId);
  const viewId = `view-${crypto.randomUUID()}`;
  const view: LiveView = { viewId, deviceId, personId: person.id, startedAt: now.getTime(), viewerAttached: false, frame: null, listeners: new Set(), timer: null };
  view.timer = setTimeout(() => sweepLiveViews(), LIVE_VIEW_MAX_MS);
  (view.timer as { unref?: () => void }).unref?.();
  views.set(viewId, view);
  issueDeviceCommand(deviceId, "live_view_start", { view_id: viewId, fps: 5, size: "640x360" });
  return { ok: true, viewId };
}

export function stopLiveView(viewId: string): boolean {
  const view = views.get(viewId);
  if (!view) return false;
  views.delete(viewId);
  if (view.timer) clearTimeout(view.timer);
  view.listeners.clear();
  issueDeviceCommand(view.deviceId, "live_view_stop", { view_id: viewId });
  return true;
}

/** Stops every view past the 10 minute cap or never watched within the grace. Called by the cap timer and the scheduler tick. */
export function sweepLiveViews(now: Date = new Date()): string[] {
  const stopped: string[] = [];
  for (const view of [...views.values()]) {
    const age = now.getTime() - view.startedAt;
    if (age >= LIVE_VIEW_MAX_MS || (!view.viewerAttached && age >= LIVE_VIEW_ATTACH_GRACE_MS)) {
      stopLiveView(view.viewId);
      stopped.push(view.viewId);
    }
  }
  return stopped;
}

/** One JPEG from the robot. Only the robot that was told to stream may post, and only a JPEG of sane size is kept. */
export function pushLiveFrame(deviceId: string, viewId: string, bytes: Uint8Array): "ok" | "unknown_view" | "bad_frame" {
  const view = views.get(viewId);
  if (!view || view.deviceId !== deviceId) return "unknown_view";
  if (bytes.byteLength < 4 || bytes.byteLength > LIVE_VIEW_MAX_FRAME_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8) return "bad_frame";
  view.frame = bytes;
  for (const listener of view.listeners) listener(bytes);
  return "ok";
}

const BOUNDARY = "maipaiframe";
export const LIVE_VIEW_CONTENT_TYPE = `multipart/x-mixed-replace; boundary=${BOUNDARY}`;

/** The viewer's response body: every frame the robot posts, until the browser closes, which stops the view. */
export function liveViewStream(view: LiveView): ReadableStream<Uint8Array> {
  view.viewerAttached = true;
  const encoder = new TextEncoder();
  let listener: ((frame: Uint8Array) => void) | null = null;
  const part = (frame: Uint8Array) => {
    const head = encoder.encode(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.byteLength}\r\n\r\n`);
    const out = new Uint8Array(head.byteLength + frame.byteLength + 2);
    out.set(head, 0); out.set(frame, head.byteLength); out.set(encoder.encode("\r\n"), head.byteLength + frame.byteLength);
    return out;
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (view.frame) controller.enqueue(part(view.frame));
      listener = (frame) => { try { controller.enqueue(part(frame)); } catch { /* closed */ } };
      view.listeners.add(listener);
    },
    cancel() {
      if (listener) view.listeners.delete(listener);
      stopLiveView(view.viewId);
    },
  });
}

export function resetLiveViewsForTests(): void {
  for (const view of views.values()) if (view.timer) clearTimeout(view.timer);
  views.clear();
}
