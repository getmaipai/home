export const POSES = ["frontal", "left", "right", "up", "down"] as const;
export type Pose = (typeof POSES)[number];

export interface QualityConfig {
  minBoxFrac: number;
  minSharpness: number;
  minBrightness: number;
  maxBrightness: number;
  frontalMaxYaw: number;
  turnMinYaw: number;
  /** Degrees ABOVE or BELOW the person's own straight-ahead pitch (FACE-02K). */
  updownMinPitch: number;
  /** Before the baseline exists: the generous absolute pitch window inside
   * which a frontal-yaw frame counts as looking straight ahead. */
  frontalWindowPitch: number;
  /** A yaw or pitch beyond these is not a pose at all (a landmark glitch). */
  maxYaw: number;
  maxPitch: number;
}

// One quality bar (FACE-02J), set from a real webcam run (FACE-02K,
// docs/dev.md): a frame is green (accepted) only if it clears minBoxFrac,
// minSharpness and the brightness range. Only one camera has been
// measured; other cameras are a FACE-02K follow-up in BACKLOG.md.
//   minBoxFrac 0.08: leaning back read 0.05 to 0.06 (fails), ordinary
//     seating 0.09 to 0.12 (passes).
//   minSharpness 90: that camera reads 228 to 822, so a blurry frame stays
//     yellow and its own frames clear the bar by 2.5x.
//   updownMinPitch 11: degrees relative to the person's own straight ahead
//     (the camera height varies, so an absolute pitch cannot be right).
export const DEFAULT_QUALITY_CONFIG: Readonly<QualityConfig> = Object.freeze({
  minBoxFrac: 0.08,
  minSharpness: 90,
  minBrightness: 40,
  maxBrightness: 220,
  frontalMaxYaw: 12,
  turnMinYaw: 18,
  updownMinPitch: 11,
  frontalWindowPitch: 35,
  maxYaw: 90,
  maxPitch: 60,
});

export interface EnrollmentSpec {
  shotsPerPose: number;
  wearsGlasses: boolean;
  glassesShots: number;
  /** Frontal frames that clear the bar before the frontal shot registers,
   * so the pitch baseline is a median of several frames, not one. */
  baselineFrames: number;
  quality: QualityConfig;
}

export function createEnrollmentSpec(overrides: Partial<EnrollmentSpec> = {}): EnrollmentSpec {
  return {
    shotsPerPose: overrides.shotsPerPose ?? 2,
    wearsGlasses: overrides.wearsGlasses ?? false,
    glassesShots: overrides.glassesShots ?? 2,
    baselineFrames: overrides.baselineFrames ?? 5,
    quality: { ...DEFAULT_QUALITY_CONFIG, ...overrides.quality },
  };
}

export interface FaceSample {
  embedding: number[];
  yawDeg: number;
  pitchDeg: number;
  boxFrac: number;
  sharpness: number;
  brightness: number;
  glasses: boolean | null;
}

export function createFaceSample(
  embedding: number[],
  measurements: Partial<Omit<FaceSample, "embedding">> = {},
): FaceSample {
  return {
    embedding,
    yawDeg: measurements.yawDeg ?? 0,
    pitchDeg: measurements.pitchDeg ?? 0,
    boxFrac: measurements.boxFrac ?? 0,
    sharpness: measurements.sharpness ?? 0,
    brightness: measurements.brightness ?? 128,
    glasses: measurements.glasses ?? null,
  };
}

/** `pitchDeg` is relative to the person's own straight ahead once known. */
export function bucketPose(yawDeg: number, pitchDeg: number, cfg: QualityConfig): Pose | null {
  if (Math.abs(pitchDeg) >= cfg.updownMinPitch) return pitchDeg > 0 ? "up" : "down";
  if (Math.abs(yawDeg) <= cfg.frontalMaxYaw) return "frontal";
  if (Math.abs(yawDeg) >= cfg.turnMinYaw) return yawDeg > 0 ? "left" : "right";
  return null;
}

export interface QualityAssessment {
  ok: boolean;
  reason: "too_far" | "blurry" | "too_dark" | "too_bright" | "ok";
}

export function assessQuality(sample: FaceSample, cfg: QualityConfig): QualityAssessment {
  if (sample.boxFrac < cfg.minBoxFrac) return { ok: false, reason: "too_far" };
  if (sample.sharpness < cfg.minSharpness) return { ok: false, reason: "blurry" };
  if (sample.brightness < cfg.minBrightness) return { ok: false, reason: "too_dark" };
  if (sample.brightness > cfg.maxBrightness) return { ok: false, reason: "too_bright" };
  return { ok: true, reason: "ok" };
}

export interface OfferResult {
  accepted: boolean;
  reason: string;
  complete: boolean;
  progress: number;
  nextInstruction: string;
}

export interface BucketStatus {
  pose: Pose;
  count: number;
  needed: number;
  avgSharpness: number;
  avgBoxFrac: number;
  minSharpness: number;
  minBoxFrac: number;
}

export interface PersonStatus {
  name: string;
  source: string;
  complete: boolean;
  coveragePct: number;
  shots: number;
  buckets: BucketStatus[];
  needs: string[];
  wearsGlasses: boolean;
  glassesOn: number;
  glassesOff: number;
  /** The person's own straight-ahead pitch, fixed when the frontal step is
   * complete; null until then. For the console diagnostics. */
  pitchBaselineDeg: number | null;
}

// Exported (FACE-02) so the guided capture UI can show a pose's
// instruction before any sample has been offered yet - OfferResult's own
// nextInstruction only exists after at least one offer() call, and this
// is the same text it would eventually produce, not a second copy of it.
export const POSE_PROMPT: Record<Pose, string> = {
  frontal: "look straight at me",
  left: "slowly turn your head to your left",
  right: "slowly turn your head to your right",
  up: "tip your chin up a little",
  down: "tip your chin down a little",
};

export class EnrollmentSession {
  readonly name: string;
  readonly source: string;
  private readonly spec: EnrollmentSpec;
  private readonly poseCounts: Record<Pose, number> = { frontal: 0, left: 0, right: 0, up: 0, down: 0 };
  private readonly glassesCounts: Record<"true" | "false", number> = { true: 0, false: 0 };
  private readonly acceptedEmbeddings: number[][] = [];
  // FACE-02K: pitch of frontal frames that cleared the bar, gathered only
  // while the frontal step is open; the median becomes the fixed baseline.
  private readonly baselineSamples: number[] = [];
  private pitchBaseline: number | null = null;
  private readonly poseQuality: Record<Pose, Array<[number, number]>> = {
    frontal: [], left: [], right: [], up: [], down: [],
  };

  constructor(name: string, spec: EnrollmentSpec = createEnrollmentSpec(), source = "in_person") {
    this.name = name;
    this.spec = spec;
    this.source = source;
  }

  offer(sample: FaceSample): OfferResult {
    // An absurd yaw or pitch (a landmark glitch mid-motion) is no pose at
    // all: never bucketed, never a baseline sample, never accepted.
    if (!hasUsablePose(sample, this.spec.quality)) return this.result(false, "no_pose");
    const quality = assessQuality(sample, this.spec.quality);
    if (!quality.ok) return this.result(false, quality.reason);

    const pose = this.judgePose(sample);
    if (pose === null) return this.result(false, "between_angles");
    // FACE-02I: strict per-step capture. Only the pose being asked for
    // right now counts, so a transitional frame swinging past another
    // pose's threshold while the person moves is dropped, not banked.
    if (pose !== this.currentTarget()) return this.result(false, "off_target");
    if (!this.needs(pose, sample.glasses)) return this.result(false, "bucket_full");

    if (this.pitchBaseline === null) {
      this.baselineSamples.push(sample.pitchDeg);
      if (this.baselineSamples.length < this.spec.baselineFrames) return this.result(false, "calibrating");
    }

    this.poseCounts[pose] += 1;
    this.poseQuality[pose].push([sample.sharpness, sample.boxFrac]);
    if (this.spec.wearsGlasses && pose === "frontal" && sample.glasses !== null) {
      this.glassesCounts[String(sample.glasses) as "true" | "false"] += 1;
    }
    this.acceptedEmbeddings.push(sample.embedding);
    // No drift: the baseline is fixed the moment the frontal step is done.
    if (this.pitchBaseline === null && this.poseCounts.frontal >= this.spec.shotsPerPose) {
      this.pitchBaseline = median(this.baselineSamples);
    }
    return this.result(true, "ok");
  }

  /** Up and down are judged against the person's own straight ahead (the
   * camera is rarely at eye level). Before the baseline exists, a generous
   * absolute window lets the frontal step complete. */
  private judgePose(sample: FaceSample): Pose | null {
    const cfg = this.spec.quality;
    if (this.pitchBaseline !== null) return bucketPose(sample.yawDeg, sample.pitchDeg - this.pitchBaseline, cfg);
    if (Math.abs(sample.yawDeg) <= cfg.frontalMaxYaw && Math.abs(sample.pitchDeg) <= cfg.frontalWindowPitch) return "frontal";
    return bucketPose(sample.yawDeg, sample.pitchDeg, cfg);
  }

  embeddings(): number[][] {
    return [...this.acceptedEmbeddings];
  }

  status(): PersonStatus {
    const buckets: BucketStatus[] = [];
    const needs: string[] = [];
    for (const pose of POSES) {
      const quality = this.poseQuality[pose];
      const count = this.poseCounts[pose];
      const avgSharpness = quality.length ? quality.reduce((sum, [sharpness]) => sum + sharpness, 0) / quality.length : 0;
      const avgBoxFrac = quality.length ? quality.reduce((sum, [, box]) => sum + box, 0) / quality.length : 0;
      const minSharpness = quality.length ? Math.min(...quality.map(([sharpness]) => sharpness)) : 0;
      const minBoxFrac = quality.length ? Math.min(...quality.map(([, box]) => box)) : 0;
      buckets.push({
        pose,
        count,
        needed: this.spec.shotsPerPose,
        avgSharpness: round(avgSharpness, 1),
        avgBoxFrac: round(avgBoxFrac, 3),
        minSharpness: round(minSharpness, 1),
        minBoxFrac: round(minBoxFrac, 3),
      });
      if (count < this.spec.shotsPerPose) needs.push(POSE_PROMPT[pose]);
    }
    if (this.spec.wearsGlasses) {
      if (this.glassesCounts.false < this.spec.glassesShots) needs.push("take your glasses off and look at me");
      if (this.glassesCounts.true < this.spec.glassesShots) needs.push("put your glasses on and look at me");
    }
    const required = this.requiredTotal();
    return {
      name: this.name,
      source: this.source,
      complete: this.isComplete(),
      coveragePct: round(100 * (required === 0 ? 0 : this.collectedTotal() / required), 1),
      shots: this.acceptedEmbeddings.length,
      buckets,
      needs,
      wearsGlasses: this.spec.wearsGlasses,
      glassesOn: this.glassesCounts.true,
      glassesOff: this.glassesCounts.false,
      pitchBaselineDeg: this.pitchBaseline === null ? null : round(this.pitchBaseline, 1),
    };
  }

  /** The one pose being asked for right now, in POSES order: the first pose
   * still short of its shots, then frontal while the glasses shots are
   * owed, then null once everything is captured. The Wizard and the
   * robot's voice ceremony both read this, never their own ordering. */
  currentTarget(): Pose | null {
    for (const pose of POSES) if (this.poseCounts[pose] < this.spec.shotsPerPose) return pose;
    if (this.spec.wearsGlasses
      && (this.glassesCounts.false < this.spec.glassesShots || this.glassesCounts.true < this.spec.glassesShots)) return "frontal";
    return null;
  }

  private needs(pose: Pose, glasses: boolean | null): boolean {
    if (this.poseCounts[pose] < this.spec.shotsPerPose) return true;
    return this.spec.wearsGlasses && pose === "frontal" && glasses !== null
      && this.glassesCounts[String(glasses) as "true" | "false"] < this.spec.glassesShots;
  }

  private requiredTotal(): number {
    return this.spec.shotsPerPose * POSES.length + (this.spec.wearsGlasses ? this.spec.glassesShots * 2 : 0);
  }

  private collectedTotal(): number {
    const poses = POSES.reduce((sum, pose) => sum + Math.min(this.poseCounts[pose], this.spec.shotsPerPose), 0);
    return poses + (this.spec.wearsGlasses
      ? Math.min(this.glassesCounts.true, this.spec.glassesShots) + Math.min(this.glassesCounts.false, this.spec.glassesShots)
      : 0);
  }

  private isComplete(): boolean {
    return POSES.every((pose) => this.poseCounts[pose] >= this.spec.shotsPerPose)
      && (!this.spec.wearsGlasses || (this.glassesCounts.true >= this.spec.glassesShots && this.glassesCounts.false >= this.spec.glassesShots));
  }

  private nextInstruction(): string {
    const target = this.currentTarget();
    if (target !== null && POSES.some((pose) => this.poseCounts[pose] < this.spec.shotsPerPose)) return POSE_PROMPT[target];
    if (this.spec.wearsGlasses) {
      if (this.glassesCounts.false < this.spec.glassesShots) return "take your glasses off and look at me";
      if (this.glassesCounts.true < this.spec.glassesShots) return "put your glasses on and look at me";
    }
    return "all set, thanks";
  }

  private result(accepted: boolean, reason: string): OfferResult {
    const required = this.requiredTotal();
    const progress = required === 0 ? 0 : Math.min(1, this.collectedTotal() / required);
    const complete = this.isComplete();
    return {
      accepted,
      reason,
      complete,
      progress: round(progress, 3),
      nextInstruction: complete ? "all set, thanks" : this.nextInstruction(),
    };
  }
}

function hasUsablePose(sample: FaceSample, cfg: QualityConfig): boolean {
  return Number.isFinite(sample.yawDeg) && Number.isFinite(sample.pitchDeg)
    && Math.abs(sample.yawDeg) <= cfg.maxYaw && Math.abs(sample.pitchDeg) <= cfg.maxPitch;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("embedding dimensions must match");
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface Match {
  name: string | null;
  score: number;
  margin: number;
}

export class FaceGallery {
  private readonly threshold: number;
  private readonly people = new Map<string, number[][]>();
  private readonly personStatuses = new Map<string, PersonStatus>();

  constructor(threshold = 0.36) {
    this.threshold = threshold;
  }

  enroll(name: string, embeddings: number[][], status?: PersonStatus): void {
    if (embeddings.length === 0) throw new Error("cannot enroll with no embeddings");
    const saved = this.people.get(name) ?? [];
    saved.push(...embeddings);
    this.people.set(name, saved);
    if (status !== undefined) this.personStatuses.set(name, status);
  }

  names(): string[] {
    return [...this.people.keys()].sort();
  }

  status(name: string): PersonStatus | undefined {
    return this.personStatuses.get(name);
  }

  statuses(): PersonStatus[] {
    return this.names().map((name) => this.personStatuses.get(name) ?? {
      name,
      source: "imported",
      complete: true,
      coveragePct: 100,
      shots: this.people.get(name)!.length,
      buckets: [],
      needs: [],
      wearsGlasses: false,
      glassesOn: 0,
      glassesOff: 0,
      pitchBaselineDeg: null,
    });
  }

  remove(name: string): boolean {
    this.personStatuses.delete(name);
    return this.people.delete(name);
  }

  identify(embedding: number[], threshold?: number): Match {
    const actualThreshold = threshold ?? this.threshold;
    const perPerson = new Map<string, number>();
    for (const [name, embeddings] of this.people) {
      for (const enrolled of embeddings) {
        const score = cosine(embedding, enrolled);
        if (score > (perPerson.get(name) ?? -1)) perPerson.set(name, score);
      }
    }
    if (perPerson.size === 0) return { name: null, score: 0, margin: 0 };
    const ranked = [...perPerson].sort((a, b) => b[1] - a[1]);
    const [bestName, bestScore] = ranked[0]!;
    const runnerUp = ranked[1]?.[1] ?? 0;
    const margin = round(Math.max(bestScore - runnerUp, 0), 4);
    if (bestScore < actualThreshold) return { name: null, score: round(Math.max(bestScore, 0), 4), margin };
    return { name: bestName, score: round(bestScore, 4), margin };
  }
}
