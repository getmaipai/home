import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { FaceEnrollmentPage } from "@/apps/people/FaceEnrollmentPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { setSessionFactory, type OnnxInferenceSession, type OnnxTensor } from "@/lib/onnx/session-runtime";
import { TEMPLATE, alignCrop } from "@/lib/vision/faceAlign";
import { computeSharpness } from "@/lib/vision/faceCaptureMeasurements";
import { DEFAULT_QUALITY_CONFIG, type Pose } from "@/lib/vision/enrollmentSession";
import type { Roster } from "@/lib/api";
import { CHIME, CUES, setSoundContextFactory } from "@/lib/vision/faceCaptureSounds";
import { FakeContext } from "../../../tests/fakeSoundContext";

// FACE-02J: drives the real capture page with a scripted camera. The
// seams are the page's own: a fake ONNX session factory (session-
// runtime.ts's setSessionFactory) standing in for YuNet and SFace, a
// canvas whose pixels the test controls (soft or sharp), a fake
// getUserMedia stream and a video that reports a frame size. Everything
// downstream (decode, head pose, alignment, the measurements, the
// session's own accept/reject, the ring) is the real code.

const FRAME_W = 480;
const FRAME_H = 360;
const CX = FRAME_W / 2;
const CY = FRAME_H / 2;

let facePresent = true;
let faceSize = 190;
let pose: Pose = "frontal";
let pixels: "sharp" | "soft" = "sharp";

const POSE_OFFSET: Record<Pose, { yaw: number; pitch: number }> = {
  frontal: { yaw: 0, pitch: 0 },
  left: { yaw: 25, pitch: 0 },
  right: { yaw: -25, pitch: 0 },
  up: { yaw: 0, pitch: 25 },
  down: { yaw: 0, pitch: -25 },
};

function landmarks(): [number, number][] {
  const scale = (faceSize * 0.9) / 112;
  const mean: [number, number] = [56.0262, 71.9008];
  const points = TEMPLATE.map(([x, y]) => [CX + (x - mean[0]) * scale, CY + (y - mean[1]) * scale] as [number, number]);
  const eyeMidY = (points[0]![1] + points[1]![1]) / 2;
  const interEye = points[1]![0] - points[0]![0];
  const eyeToMouth = (points[3]![1] + points[4]![1]) / 2 - eyeMidY;
  const { yaw, pitch } = POSE_OFFSET[pose];
  points[2] = [points[2]![0] + (yaw / 70) * interEye, points[2]![1] - (pitch / 200) * eyeToMouth];
  return points;
}

function yunetOutputs(): Record<string, OnnxTensor> {
  const stride = 8;
  const cols = FRAME_W / stride;
  const rows = 384 / stride;
  const cells = cols * rows;
  const cls = new Float32Array(cells);
  const obj = new Float32Array(cells);
  const bbox = new Float32Array(cells * 4);
  const kps = new Float32Array(cells * 10);
  if (facePresent) {
    const col = Math.floor(CX / stride);
    const row = Math.floor(CY / stride);
    const idx = row * cols + col;
    cls[idx] = 1;
    obj[idx] = 1;
    bbox.set([CX / stride - col, CY / stride - row, Math.log(faceSize / stride), Math.log(faceSize / stride)], idx * 4);
    landmarks().forEach(([x, y], i) => {
      kps[idx * 10 + i * 2] = x / stride - col;
      kps[idx * 10 + i * 2 + 1] = y / stride - row;
    });
  }
  const t = (data: Float32Array): OnnxTensor => ({ data, dims: [data.length] });
  return {
    cls_8: t(cls), obj_8: t(obj), bbox_8: t(bbox), kps_8: t(kps),
    cls_16: t(new Float32Array(1)), obj_16: t(new Float32Array(1)), bbox_16: t(new Float32Array(4)), kps_16: t(new Float32Array(10)),
    cls_32: t(new Float32Array(1)), obj_32: t(new Float32Array(1)), bbox_32: t(new Float32Array(4)), kps_32: t(new Float32Array(10)),
  };
}

function framePixels(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = pixels === "soft" ? 128 : ((x >> 1) + (y >> 1)) % 2 === 0 ? 40 : 216;
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  return data;
}

function installFakeSessions(): void {
  setSessionFactory({
    tensor: (data, dims) => ({ data, dims }),
    create: async (path: string): Promise<OnnxInferenceSession> => ({
      run: async () => (path.includes("yunet") ? yunetOutputs() : { fc1: { data: new Float32Array(128).fill(0.1), dims: [1, 128] } }),
    }),
  });
}

const originals: { getContext?: unknown; readyState?: PropertyDescriptor; videoWidth?: PropertyDescriptor; videoHeight?: PropertyDescriptor; fetch?: typeof fetch; matchMedia?: typeof window.matchMedia; debug?: typeof console.debug; info?: typeof console.info; srcObject?: PropertyDescriptor; media?: PropertyDescriptor } = {};
let debugSpy: ReturnType<typeof mock>;
let infoSpy: ReturnType<typeof mock>;
let posts = 0;
let postedBodies: Array<{ person_id: string; samples: unknown[] }> = [];
let failNextPost = false;
// The operator's stored `ui.enrollment_sounds` (FACE-02N); undefined = never set.
let soundsSetting: boolean | undefined;

beforeEach(() => {
  postedBodies = [];
  failNextPost = false;
  soundsSetting = undefined;
  facePresent = true;
  faceSize = 190;
  pose = "frontal";
  pixels = "sharp";
  posts = 0;
  installFakeSessions();

  originals.getContext = HTMLCanvasElement.prototype.getContext;
  (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = function (this: HTMLCanvasElement) {
    return { drawImage: () => {}, getImageData: () => ({ data: framePixels(this.width, this.height) }) };
  };
  for (const [key, value] of [["readyState", 4], ["videoWidth", 640], ["videoHeight", 480]] as const) {
    originals[key] = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, key);
    Object.defineProperty(HTMLVideoElement.prototype, key, { configurable: true, get: () => value });
  }
  // happy-dom rejects a non-MediaStream srcObject; the fake stream needs a no-op.
  originals.srcObject = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "srcObject");
  Object.defineProperty(HTMLVideoElement.prototype, "srcObject", { configurable: true, get: () => null, set: () => {} });
  originals.media =Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: () => Promise.resolve({ getTracks: () => [] }) },
  });
  originals.matchMedia = window.matchMedia;
  window.matchMedia = mock(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
  originals.fetch = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/vision/models")) {
      return Promise.resolve(Response.json({ installed: true, detectors: [{ id: "sface-test", file: "face_recognition_sface_2021dec.onnx" }] }));
    }
    if (url.includes("/api/biometric-prints/enrollments") && init?.method === "POST") {
      posts += 1;
      const sent = JSON.parse(String(init.body)) as { person_id: string; samples: unknown[] };
      postedBodies.push(sent);
      if (failNextPost) {
        failNextPost = false;
        return Promise.resolve(Response.json({ error: "boom" }, { status: 500 }));
      }
      return Promise.resolve(Response.json({ prints: sent.samples.map((_, i) => ({ id: `print-${i + 1}` })), replaced: 0 }, { status: 201 }));
    }
    if (url.includes("/api/settings")) {
      return Promise.resolve(Response.json(soundsSetting === undefined ? [] : [{ scope: "person:person-sage", key: "ui.enrollment_sounds", value: soundsSetting }]));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  originals.debug = console.debug;
  originals.info = console.info;
  debugSpy = mock(() => {});
  infoSpy = mock(() => {});
  console.debug = debugSpy as unknown as typeof console.debug;
  console.info = infoSpy as unknown as typeof console.info;
});

afterEach(() => {
  cleanup();
  setSessionFactory(null);
  setSoundContextFactory(null);
  (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = originals.getContext;
  for (const key of ["readyState", "videoWidth", "videoHeight"] as const) {
    const descriptor = originals[key];
    if (descriptor) Object.defineProperty(HTMLVideoElement.prototype, key, descriptor);
    else delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>)[key];
  }
  if (originals.srcObject) Object.defineProperty(HTMLVideoElement.prototype, "srcObject", originals.srcObject);
  else delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>).srcObject;
  if (originals.media) Object.defineProperty(navigator, "mediaDevices", originals.media);
  else delete (navigator as unknown as Record<string, unknown>).mediaDevices;
  window.matchMedia = originals.matchMedia!;
  globalThis.fetch = originals.fetch!;
  console.debug = originals.debug!;
  console.info = originals.info!;
  document.documentElement.classList.remove("dark", "light");
  document.body.className = "";
  localStorage.clear();
});

function operator(): Roster {
  return {
    id: "person-sage", display_name: "Sage", nickname: null, role: "owner", avatar_seed: "person-sage", source: "hub", local_only: false,
    created_at: "2026-09-29T00:00:00.000Z", updated_at: "2026-09-29T00:00:00.000Z", deleted_at: null, enabled: true,
    guest_expires_at: null, memorialized_at: null, hlc: "1788000000000:0:test", hasSecret: true,
  };
}

// happy-dom is registered by the preload, after @testing-library's own
// `screen` export is evaluated, so queries come from the render result.
let current: ReturnType<typeof renderWithQueryClient>;
const view = () => current;

function renderPage() {
  current = renderWithQueryClient(
    <MemoryRouter initialEntries={["/people/person-sage/enroll-face"]}>
      <Routes>
        <Route path="/people/:id/enroll-face" element={<FaceEnrollmentPage operator={operator()} />} />
        <Route path="/people/:id" element={<p>profile</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return current;
}

const ring = (container: HTMLElement) => container.querySelector("[data-capture-ring]");
const WAIT = { timeout: 4000 };

describe("the fake camera itself", () => {
  test("the sharp frame really clears the bar and the soft frame really does not (guards the seam)", () => {
    const measure = (mode: "sharp" | "soft") => {
      pixels = mode;
      return computeSharpness(alignCrop(framePixels(FRAME_W, FRAME_H), FRAME_W, FRAME_H, landmarks()));
    };
    expect(measure("sharp")).toBeGreaterThan(DEFAULT_QUALITY_CONFIG.minSharpness * 2);
    expect(measure("soft")).toBeLessThan(DEFAULT_QUALITY_CONFIG.minSharpness / 2);
  });
});

describe("FACE-02J: the capture ring", () => {
  test("a sharp frame turns the ring green, says so in words, and registers the shot", async () => {
    const { container } = renderPage();
    await waitFor(() => expect(ring(container)?.getAttribute("data-capture-ring")).toBe("green"), WAIT);
    expect(ring(container)?.className).toContain("--hue-green");
    const status = view().getByRole("status");
    expect(status.textContent).toContain("Got it");
    // Registered: the wizard moved on to the next pose.
    await waitFor(() => expect(view().getByText("slowly turn your head to your left")).toBeTruthy(), WAIT);
  });

  test("a soft frame turns the ring yellow with its reason, and does not register", async () => {
    pixels = "soft";
    const { container } = renderPage();
    await waitFor(() => expect(ring(container)?.getAttribute("data-capture-ring")).toBe("yellow"), WAIT);
    expect(ring(container)?.className).toContain("--hue-yellow");
    expect(view().getByRole("status").textContent).toContain("soft");
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(view().getByText("look straight at me")).toBeTruthy();
    expect(view().queryByText("slowly turn your head to your left")).toBeNull();
    expect(ring(container)?.getAttribute("data-capture-ring")).toBe("yellow");
    expect(infoSpy).not.toHaveBeenCalled();
  });

  test("a face that is too far away is yellow, and the reason says to move closer", async () => {
    faceSize = 90;
    const { container } = renderPage();
    await waitFor(() => expect(ring(container)?.getAttribute("data-capture-ring")).toBe("yellow"), WAIT);
    expect(view().getByRole("status").textContent).toContain("closer");
    expect(view().getByText("look straight at me")).toBeTruthy();
  });

  test("with no face in the frame the ring is neither green nor yellow", async () => {
    facePresent = false;
    const { container } = renderPage();
    await waitFor(() => expect(view().getByRole("status").textContent).toContain("can't see your face"), WAIT);
    expect(ring(container)?.getAttribute("data-capture-ring")).toBe("none");
  });

  test("the judged frame's numbers go to the console once a second, and nowhere else", async () => {
    pixels = "soft";
    renderPage();
    await waitFor(() => expect(debugSpy).toHaveBeenCalled(), WAIT);
    const [, payload] = debugSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(Object.keys(payload).sort()).toEqual(["boxFrac", "brightness", "color", "pitchBaselineDeg", "pitchDeg", "reason", "sharpness", "yawDeg"]);
    expect(payload).toMatchObject({ color: "yellow", reason: "blurry" });
    expect(posts).toBe(0);
  });

  test("a full enrollment of sharp frames saves the five prints in one replacing request, logs one summary line per pose, and never says soft or far", async () => {
    const { container } = renderPage();
    const prompts: Record<Pose, string> = {
      frontal: "look straight at me",
      left: "slowly turn your head to your left",
      right: "slowly turn your head to your right",
      up: "tip your chin up a little",
      down: "tip your chin down a little",
    };
    const order: Pose[] = ["frontal", "left", "right", "up", "down"];
    for (const [index, next] of order.entries()) {
      pose = next;
      await waitFor(() => expect(view().getByText(index + 1 < order.length ? prompts[order[index + 1]!] : "5 face samples saved.")).toBeTruthy(), WAIT);
    }
    // FACE-02Q: one request carries the whole set (the hub replaces the
    // previous set atomically), never one POST per sample.
    expect(posts).toBe(1);
    expect(postedBodies[0]!.samples).toHaveLength(5);
    expect(document.body.textContent).not.toContain("soft or far");
    expect(infoSpy).toHaveBeenCalledTimes(5);
    const lines = infoSpy.mock.calls.map((call) => (call as [string, { pose: string }])[1]);
    expect(lines.map((line) => line.pose)).toEqual(order);
    for (const line of lines as unknown as Array<{ minSharpness: number; minBoxFrac: number }>) {
      expect(line.minSharpness).toBeGreaterThanOrEqual(DEFAULT_QUALITY_CONFIG.minSharpness);
      expect(line.minBoxFrac).toBeGreaterThanOrEqual(DEFAULT_QUALITY_CONFIG.minBoxFrac);
    }
    void container;
  }, 40000);

  test("a failed save says nothing was changed, and Try saving again resends the whole set", async () => {
    failNextPost = true;
    renderPage();
    const prompts: Record<Pose, string> = {
      frontal: "look straight at me",
      left: "slowly turn your head to your left",
      right: "slowly turn your head to your right",
      up: "tip your chin up a little",
      down: "tip your chin down a little",
    };
    const order: Pose[] = ["frontal", "left", "right", "up", "down"];
    for (const [index, next] of order.entries()) {
      pose = next;
      if (index + 1 < order.length) await waitFor(() => expect(view().getByText(prompts[order[index + 1]!])).toBeTruthy(), WAIT);
    }
    await waitFor(() => expect(view().getByText("The face samples could not be saved.")).toBeTruthy(), WAIT);
    expect(document.body.textContent).toContain("Nothing was changed");
    expect(postedBodies).toHaveLength(1);

    fireEvent.click(view().getByRole("button", { name: "Try saving again" }));
    await waitFor(() => expect(view().getByText("5 face samples saved.")).toBeTruthy(), WAIT);
    expect(postedBodies).toHaveLength(2);
    expect(postedBodies[1]!.samples).toHaveLength(5);
  }, 40000);
});

// FACE-02M: the sounds ride the same ring and the same offer() verdict.
// The AudioContext is a recording fake (setSoundContextFactory); what
// the cues sound like is not testable here, only which ones started.
describe("FACE-02M: ring motion", () => {
  test("scanning shows the pulsing band, yellow none, green the glow and the check pop, all motion-safe", async () => {
    facePresent = false;
    const first = renderPage();
    await waitFor(() => expect(first.container.querySelector('[data-capture-motion="none"]')).not.toBeNull(), WAIT);
    expect(first.container.querySelector('[data-capture-motion="none"]')!.className).toContain("motion-safe:animate-pulse");
    first.unmount();

    facePresent = true;
    pixels = "soft";
    const second = renderPage();
    await waitFor(() => expect(ring(second.container)?.getAttribute("data-capture-ring")).toBe("yellow"), WAIT);
    expect(second.container.querySelector("[data-capture-motion]")).toBeNull();
    second.unmount();

    pixels = "sharp";
    const third = renderPage();
    await waitFor(() => expect(ring(third.container)?.getAttribute("data-capture-ring")).toBe("green"), WAIT);
    expect(third.container.querySelector('[data-capture-motion="green"]')!.className).toContain("motion-safe:animate-pulse");
    expect(third.getByRole("status").querySelector("svg")!.getAttribute("class")).toContain("motion-safe:zoom-in-50");
    // the words are still there
    expect(third.getByRole("status").textContent).toContain("Got it");
  });
});

describe("FACE-02M: enrollment sounds", () => {
  let audio: FakeContext;
  let contexts: number;
  const started = (freq: number) => audio.started.filter((s) => s.freq === freq).length;
  const chimes = () => started(CHIME.partials[0]!.freq);

  beforeEach(() => {
    contexts = 0;
    audio = new FakeContext("running");
    setSoundContextFactory(() => {
      contexts += 1;
      return audio;
    });
  });

  test("no face yet: the scanning tick plays, and no chime", async () => {
    facePresent = false;
    renderPage();
    await waitFor(() => expect(started(CUES.scanning.freq)).toBeGreaterThan(0), WAIT);
    expect(chimes()).toBe(0);
  });

  test("a soft frame plays the soft cue, never the ready tone or the chime, and registers nothing", async () => {
    pixels = "soft";
    renderPage();
    await waitFor(() => expect(started(CUES.soft.freq)).toBeGreaterThan(0), WAIT);
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(started(CUES.ready.freq)).toBe(0);
    expect(chimes()).toBe(0);
  });

  test("a registered shot chimes exactly once, and the ready tone plays with the green ring", async () => {
    const { container } = renderPage();
    await waitFor(() => expect(view().getByText("slowly turn your head to your left")).toBeTruthy(), WAIT);
    expect(chimes()).toBe(1);
    await waitFor(() => expect(started(CUES.ready.freq)).toBe(1), WAIT);
    void container;
  });

  test("leaving the page stops the sound and closes the context", async () => {
    facePresent = false;
    const view2 = renderPage();
    await waitFor(() => expect(started(CUES.scanning.freq)).toBeGreaterThan(0), WAIT);
    view2.unmount();
    expect(audio.closed).toBe(true);
    const n = audio.started.length;
    await new Promise((resolve) => setTimeout(resolve, 1600));
    expect(audio.started.length).toBe(n);
  });

  test("a hidden tab goes quiet", async () => {
    facePresent = false;
    renderPage();
    await waitFor(() => expect(started(CUES.scanning.freq)).toBeGreaterThan(0), WAIT);
    const hidden = Object.getOwnPropertyDescriptor(document, "hidden");
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    const n = audio.started.length;
    await new Promise((resolve) => setTimeout(resolve, 1600));
    expect(audio.started.length).toBe(n);
    if (hidden) Object.defineProperty(document, "hidden", hidden);
    else delete (document as unknown as Record<string, unknown>).hidden;
  });

  test("with enrollment sounds stored on the cues play as they do when it is unset", async () => {
    soundsSetting = true;
    facePresent = false;
    renderPage();
    await waitFor(() => expect(started(CUES.scanning.freq)).toBeGreaterThan(0), WAIT);
  });

  test("with enrollment sounds off no audio context or node is ever created, and the ring still works", async () => {
    soundsSetting = false;
    const { container } = renderPage();
    await waitFor(() => expect(ring(container)?.getAttribute("data-capture-ring")).toBe("green"), WAIT);
    await waitFor(() => expect(view().getByText("slowly turn your head to your left")).toBeTruthy(), WAIT);
    expect(contexts).toBe(0);
    expect(audio.created).toBe(0);
  });
});
