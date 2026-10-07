import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Wizard, type WizardStep } from "@maipai/ui/src/primitives/Wizard";
import { Button } from "@maipai/ui/src/ui/button";
import { Card, CardContent } from "@maipai/ui/src/ui/card";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { getIcon, type IconName } from "@maipai/ui/src/icons";
import { api, type PersonRosterEntry, type Roster } from "@/lib/api";
import { canEnrollFace } from "@/apps/people/faceEnrollmentGate";
import { submitEnrollment } from "@/apps/people/submitEmbeddings";
import { useTabItem } from "@/shell/tabIdentity";
import {
  EnrollmentSession,
  POSES,
  POSE_PROMPT,
  createEnrollmentSpec,
  createFaceSample,
  type Pose,
  type PersonStatus,
} from "@/lib/vision/enrollmentSession";
import { getOrLoadSession, type OnnxInferenceSession } from "@/lib/onnx/session-runtime";
import { YUNET_PATH, SFACE_PATH } from "@/lib/vision/faceModels";
import { runYunetDetection } from "@/lib/vision/faceDetectRuntime";
import { runSfaceEmbedding } from "@/lib/vision/faceEmbedRuntime";
import { alignCrop } from "@/lib/vision/faceAlign";
import { estimateHeadPose } from "@/lib/vision/headPose";
import { computeBoxFraction, computeBrightness, computeSharpness } from "@/lib/vision/faceCaptureMeasurements";
import { captureFeedbackText, captureMotion, captureRing, type CaptureRing } from "@/lib/vision/faceCaptureFeedback";
import { createFaceCaptureSounds, cueForRing, type FaceCaptureSounds } from "@/lib/vision/faceCaptureSounds";
import { useEnrollmentSoundsEnabled } from "@/lib/vision/enrollmentSoundsSetting";
import { createFrameLogger, logEnrollmentSummary } from "@/lib/vision/faceCaptureDiagnostics";
import { classifyMediaAccessError } from "@/lib/media/getUserMediaErrorState";
import { useLook } from "@/shell/useLook";
import { pickAppearance, resolveDark } from "@/shell/appearanceResolve";
import { readShellCache, writeShellCache } from "@/shell/shellCache";

type ProfileEntry = PersonRosterEntry | Roster;

// A few times a second, not every animation frame (org CLAUDE.md,
// "Verification": this runs real ONNX inference on the main thread and
// must not starve it). One in-flight tick at a time (see `runningRef`
// below) so a slow frame never queues a backlog of overlapping ones.
const CAPTURE_INTERVAL_MS = 400;
// Bounds inference cost regardless of the camera's actual resolution:
// the source frame is downscaled to this width (aspect-preserved) before
// detection ever runs.
const CAPTURE_MAX_WIDTH = 480;
// After a shot registers, the ring stays green with "Got it." this long, so
// the next frame (judged against the NEXT pose, and so not yet accepted)
// does not flash it away before anyone sees it.
const ACCEPTED_HOLD_MS = 1200;

// The kit's themed --hue-green and --hue-yellow (commons ui-v0.5.80,
// FACE-02L): a true green and a true yellow, deeper in the light theme so
// each clears 3:1 on the page. Written out whole because Tailwind only sees
// literal class names.
const RING_CLASS: Record<CaptureRing, string> = {
  green: "border-[var(--hue-green)]",
  yellow: "border-[var(--hue-yellow)]",
  none: "border-border",
};

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function CenteredPage({ children }: { children: ReactNode }) {
  // Shell-less (Wizard.tsx's own precedent, SetupWizard/`/setup`): this
  // route renders outside FullLayout entirely, so nothing upstream
  // already provides the page's one <main> landmark.
  return <main className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">{children}</main>;
}

function CenteredSpinner({ label }: { label: string }) {
  return (
    <CenteredPage>
      <Progress mode="spinner" label={label} />
    </CenteredPage>
  );
}

function CenteredMessage({
  title,
  body,
  backTo,
  backLabel = "Back",
  onRetry,
}: {
  title: string;
  body: string;
  backTo: string;
  backLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <CenteredPage>
      <p className="text-lg font-medium">{title}</p>
      <p className="max-w-md text-base text-muted-foreground">{body}</p>
      <div className="flex gap-2">
        {onRetry ? (
          <Button type="button" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
        <Button asChild variant="ghost">
          <Link to={backTo}>{backLabel}</Link>
        </Button>
      </div>
    </CenteredPage>
  );
}

function StatusCard({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: IconName;
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  const Icon = getIcon(icon);
  return (
    <Card className="mx-auto w-full max-w-md">
      <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
        <Icon className="h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="text-lg font-medium">{title}</p>
        <p className="text-base text-muted-foreground">{body}</p>
        <Button type="button" variant="outline" onClick={onAction}>
          {actionLabel}
        </Button>
      </CardContent>
    </Card>
  );
}

type CameraState = "requesting" | "denied" | "unavailable" | "ready" | "error";
type ModelsState = "loading" | "ready" | "error";
type FlowPhase = "capturing" | "submitting";
type SubmissionState = "pending" | "success" | "error";
interface SubmissionRow {
  embedding: number[];
  state: SubmissionState;
  error?: string;
}

/** Same resolved-appearance computation `useAppearance.ts`'s own
 * paint effect uses (`@/shell/appearanceResolve`'s shared `resolveDark`)
 * - not that hook itself, which also calls the vendored `useTheme()` and
 * needs a `<ThemeProvider>` ancestor this shell-less route never mounts.
 * Without this, a person who has never opened "/" in this browser (no
 * cached palette for `main.tsx` to pre-paint, and no `<ThemeProvider>`
 * here to seed one) lands on this route with neither ".dark" nor
 * ".light" on `<html>` - and found live (FACE-02J, 2026-09-29) that this
 * is worse paired with `useLook` below than alone: the kit's own
 * light-mode "style-<look>" preset rule (a higher-specificity
 * `body.style-<look>` selector, unguarded by any dark media query) then
 * wins over the kit's own unclassed dark media-query fallback, rendering
 * the page fully light even when the operator's own setting and the OS
 * both say dark.
 *
 * Also writes the resolved `dark` into the same per-browser cache
 * `useAppearance.ts` writes (HOME-UI-04g's own "paint before React
 * mounts" cache) - a review on this item caught the first version
 * skipping this: `useLook`'s own effect (called after this one,
 * matching `RoutesInner`'s real order) preserves whatever `dark` is
 * already cached rather than computing it itself, so leaving this
 * unwritten let a stale or default-`false` value sit in the cache after
 * every visit here, flashing the wrong theme on the NEXT page's reload
 * anywhere in the app, not just this route.
 *
 * A failed settings-values fetch leaves `appearance` (and so `<html>`'s
 * class) exactly as `useAppearance.ts`'s own identical `appearance
 * === undefined` guard does - no retry UI, matching that hook's
 * accepted behavior rather than inventing a new resilience pattern this
 * one route alone would carry. */
function usePaintAppearanceForShellLessRoute(personId: string): void {
  const query = useQuery({
    queryKey: ["settings-values", `person:${personId}`],
    queryFn: () => api.settingsValues(`person:${personId}`),
  });
  const cachedLook = readShellCache()?.look;
  const appearance = pickAppearance(query.data);
  useEffect(() => {
    if (appearance === undefined) return;
    const dark = resolveDark(appearance, window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("light", !dark);
    writeShellCache({ look: cachedLook ?? "neutral", dark });
  }, [appearance, cachedLook]);
}

/** The entry point (FACE-02): `/people/:id/enroll-face`, reached from
 * that person's profile. Resolves the target (self, or a roster lookup
 * for someone else), gates on `canEnrollFace` (the same authority
 * `POST /api/biometric-prints` itself enforces - a wrong answer here
 * only ever hides the button, never lets an unauthorized POST through),
 * then hands off to the real camera flow. */
export function FaceEnrollmentPage({ operator }: { operator: Roster }) {
  // This route renders outside Routes/FullLayout (CenteredPage's own
  // comment above: shell-less, Wizard.tsx's SetupWizard precedent), so
  // nothing here already keeps `useLook`'s "style-<look>" class alive
  // on <body>. That hook's own cleanup strips the class on unmount, so
  // the moment a person clicks "Enroll" from their profile page (a plain
  // client-side navigate(), no reload), RoutesInner unmounts and
  // takes the class with it - found live (FACE-02J, 2026-09-29): the
  // page's background silently dropped from the household's actual
  // dark look (#0a0a0a for "neutral") to the kit's own generic dark
  // default (#07111f), a real color mismatch against every other page,
  // not just the (intentionally black) camera preview box. Re-running
  // the same hook here for as long as this route is mounted keeps the
  // body in sync with the signed-in operator's own look, and its own
  // cleanup hands the class back once RoutesInner remounts.
  //
  // Called in the same order `RoutesInner` (Routes.tsx) calls
  // its own pair (appearance, then look) - not incidental: the
  // appearance hook's own comment explains why it must run first, and
  // reversing this order is exactly the bug a review caught before this
  // item shipped.
  usePaintAppearanceForShellLessRoute(operator.id);
  useLook(operator.id);

  const { id } = useParams<{ id: string }>();
  const viewingSelf = id === operator.id;
  const rosterQuery = useQuery<PersonRosterEntry[]>({
    queryKey: ["people"],
    queryFn: () => api.people(),
    enabled: !viewingSelf,
  });

  if (!id) {
    return <CenteredMessage title="No one to enroll" body="That link is missing a person to enroll." backTo="/people" backLabel="Back to Family" />;
  }
  if (viewingSelf) {
    return <FaceEnrollmentGate operator={operator} target={operator} />;
  }
  if (rosterQuery.isLoading) return <CenteredSpinner label="Loading profile…" />;
  if (rosterQuery.isError) {
    return (
      <CenteredMessage
        title="Could not load the household"
        body="Try again, or go back and start from their profile."
        backTo={`/people/${id}`}
        onRetry={() => rosterQuery.refetch()}
      />
    );
  }
  const target = rosterQuery.data?.find((person) => person.id === id);
  if (!target) {
    return <CenteredMessage title="No one in this household has that profile" body="" backTo="/people" backLabel="Back to Family" />;
  }
  return <FaceEnrollmentGate operator={operator} target={target} />;
}

function FaceEnrollmentGate({ operator, target }: { operator: Roster; target: ProfileEntry }) {
  const navigate = useNavigate();
  if (!canEnrollFace(operator, target)) {
    const body =
      target.role === "child" && operator.id === target.id
        ? "A child can't enroll themself for face recognition. Ask an owner or admin to run this for you."
        : `Only an owner or admin can enroll ${target.display_name} for face recognition.`;
    return <CenteredMessage title="Not allowed" body={body} backTo={`/people/${target.id}`} />;
  }
  return <FaceEnrollmentFlow operator={operator} target={target} onDone={() => navigate(`/people/${target.id}`)} />;
}

function FaceEnrollmentFlow({ operator, target, onDone }: { operator: Roster; target: ProfileEntry; onDone: () => void }) {
  useTabItem("Enroll person");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sfaceModelIdRef = useRef<string | null>(null);
  const yunetSessionRef = useRef<OnnxInferenceSession | null>(null);
  const sfaceSessionRef = useRef<OnnxInferenceSession | null>(null);
  const runningRef = useRef(false);
  const heldUntilRef = useRef(0);
  const logFrame = useMemo(() => createFrameLogger(), []);
  // The in-flight submission's real AbortController (a second code
  // review, 2026-09-29, on the first fix: a plain `cancelledRef` boolean
  // checked only between loop iterations stopped the NEXT POST but not
  // one already mid-flight - the person clicks "Cancel enrollment" while
  // `fetch` is in the air, and it completes and saves a print anyway,
  // exactly the consent scenario the button exists to prevent). Created
  // fresh each time submission starts, `.abort()`ed from
  // cancelEnrollment(), and its `.signal` threaded all the way through
  // `api.createBiometricPrint` to `fetch` itself
  // (`submitEmbeddings.ts`, unit-tested for exactly this race).
  const submitAbortRef = useRef<AbortController | null>(null);
  // Guards against two overlapping submitSamples() runs (the initial
  // auto-submit and a double-clicked "Retry the ones that failed" - a
  // code review on this item, 2026-09-29). Both would otherwise read the
  // same stale "error" rows and double-POST one embedding.
  const submittingRef = useRef(false);
  // FACE-02M: sound cues for the ring, null when the person turned them
  // off (no audio context is ever created then).
  const soundsRef = useRef<FaceCaptureSounds | null>(null);
  const tabHiddenRef = useRef(false);
  const soundsRunningRef = useRef(false);

  // shotsPerPose: 1, no glasses steps - the backlog's own acceptance
  // criterion for this item is "a full five-pose enrollment... produce
  // five biometric_prints rows", so the UI asks the pure session for
  // exactly one accepted sample per pose rather than the module's own
  // generic default (2 shots/pose) meant for a from-scratch enrollment
  // with retake headroom.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- target.display_name only ever changes together with target.id.
  const session = useMemo(() => new EnrollmentSession(target.display_name, createEnrollmentSpec({ shotsPerPose: 1 })), [target.id]);

  const [cameraState, setCameraState] = useState<CameraState>("requesting");
  const [modelsState, setModelsState] = useState<ModelsState>("loading");
  const [phase, setPhase] = useState<FlowPhase>("capturing");
  const [lastReason, setLastReason] = useState("no_face");
  const [status, setStatus] = useState<PersonStatus>(() => session.status());
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  // Separate retry keys (a code review on this item, 2026-09-29): a
  // single shared key meant "Try again" on a models-only failure also
  // tore down and re-requested an already-working camera stream.
  const [cameraRetryKey, setCameraRetryKey] = useState(0);
  const [modelsRetryKey, setModelsRetryKey] = useState(0);

  // Camera access. getUserMedia video-only, per the brief: the one
  // genuinely new piece of browser-API code here, everything downstream
  // is a pure, already-tested function.
  useEffect(() => {
    let cancelled = false;
    setCameraState("requesting");
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraState("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCameraState(classifyMediaAccessError(err));
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [cameraRetryKey]);

  // Model loading: the two ONNX sessions (shared/cached by session-
  // runtime.ts, the same pattern the wake-word pipeline already uses),
  // cached in refs so the capture loop below never re-awaits a lookup
  // whose answer can't change once resolved (a code review on this
  // item, 2026-09-29), plus resolving SFace's real model id from
  // /api/vision/models rather than hardcoding a second copy of
  // faceModelPins.ts's SFACE_MODEL_ID.
  useEffect(() => {
    let cancelled = false;
    setModelsState("loading");
    Promise.all([getOrLoadSession(YUNET_PATH), getOrLoadSession(SFACE_PATH), api.visionModels()])
      .then(([yunet, sface, models]) => {
        if (cancelled) return;
        const sfaceFile = SFACE_PATH.split("/").pop();
        const found = models.detectors.find((detector) => detector.file === sfaceFile)?.id;
        if (!found) throw new Error("SFace model id not found in /api/vision/models");
        yunetSessionRef.current = yunet;
        sfaceSessionRef.current = sface;
        sfaceModelIdRef.current = found;
        setModelsState("ready");
      })
      .catch(() => {
        if (!cancelled) setModelsState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [modelsRetryKey]);

  // FACE-02M: the capture sounds. The AudioContext is created and resumed
  // here (the click that opened this page counts as the gesture in the
  // same document) and again on the first click or key press on the page,
  // for a cold direct link where the browser keeps it suspended. Sound
  // adds to the ring and the status line, it never replaces them.
  // FACE-02N: the operator's own `ui.enrollment_sounds` (the person at the
  // screen hears them, even when enrolling someone else). Not on until
  // their settings have answered, so no audio is created before we know.
  const soundsOn = useEnrollmentSoundsEnabled(operator.id) === true;
  useEffect(() => {
    if (!soundsOn) return;
    const sounds = createFaceCaptureSounds();
    soundsRef.current = sounds;
    const unlock = () => void sounds.unlock();
    const applyMute = () => sounds.setMuted(tabHiddenRef.current || !soundsRunningRef.current);
    const onVisibility = () => {
      tabHiddenRef.current = document.hidden;
      applyMute();
    };
    tabHiddenRef.current = document.hidden;
    applyMute();
    unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      document.removeEventListener("visibilitychange", onVisibility);
      sounds.stop();
      soundsRef.current = null;
    };
  }, [soundsOn]);

  // The cue follows the ring the person is looking at (held green
  // included), and only while capture is actually running: not while the
  // camera or models are still loading, and not once the shots are saved.
  const soundsRunning = phase === "capturing" && cameraState === "ready" && modelsState === "ready";
  useEffect(() => {
    soundsRunningRef.current = soundsRunning;
    const sounds = soundsRef.current;
    if (!sounds) return;
    sounds.setMuted(tabHiddenRef.current || !soundsRunning);
    if (soundsRunning) sounds.setCue(cueForRing(captureRing(lastReason)));
  }, [soundsRunning, lastReason, soundsOn]);

  // Skipped while a just-registered shot's green is still on show.
  const showReason = useCallback((reason: string) => {
    if (reason !== "ok" && Date.now() < heldUntilRef.current) return;
    setLastReason(reason);
  }, []);

  const tick = useCallback(async () => {
    if (runningRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return;
    runningRef.current = true;
    try {
      const scale = Math.min(1, CAPTURE_MAX_WIDTH / video.videoWidth);
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, width, height);
      const frameRgba = ctx.getImageData(0, 0, width, height).data;

      const yunet = yunetSessionRef.current;
      if (!yunet) return;
      const faces = await runYunetDetection(yunet, frameRgba, width, height, 0.6, 0.3);
      const face = faces[0];
      if (!face) {
        showReason("no_face");
        return;
      }

      let pose: { yawDeg: number; pitchDeg: number };
      try {
        pose = estimateHeadPose(face);
      } catch {
        // Degenerate landmarks (eyes too close together, near-zero
        // eye-to-mouth span) - treat the same as "no usable face this
        // frame" rather than surfacing headPose.ts's own internal error.
        showReason("no_face");
        return;
      }

      // SFace's embedding is the most expensive step in the loop (a
      // second ONNX inference), so it only runs once a face and a usable
      // pose are already confirmed - never spent on a frame that's
      // about to be rejected as "no_face" anyway (a code review on this
      // item, 2026-09-29).
      const sface = sfaceSessionRef.current;
      if (!sface) return;
      const points: [number, number][] = [face.rightEye, face.leftEye, face.nose, face.rightMouth, face.leftMouth];
      const aligned = alignCrop(frameRgba, width, height, points);
      const embedding = await runSfaceEmbedding(sface, aligned);
      const sample = createFaceSample(Array.from(embedding), {
        yawDeg: pose.yawDeg,
        pitchDeg: pose.pitchDeg,
        boxFrac: computeBoxFraction(face.bbox, width, height),
        sharpness: computeSharpness(aligned),
        brightness: computeBrightness(aligned),
        glasses: null,
      });

      const result = session.offer(sample);
      // The ring is the offer's own verdict: green exactly when the shot
      // registered (FACE-02J, one definition of green).
      logFrame({ ...sample, color: captureRing(result.reason), reason: result.reason, pitchBaselineDeg: session.status().pitchBaselineDeg });
      if (result.accepted) {
        heldUntilRef.current = Date.now() + ACCEPTED_HOLD_MS;
        soundsRef.current?.captured();
      }
      showReason(result.reason);
      const nextStatus = session.status();
      setStatus(nextStatus);
      if (result.complete) {
        logEnrollmentSummary(nextStatus.buckets);
        setPhase("submitting");
      }
    } catch (err) {
      // One bad frame (a mid-motion inference hiccup) doesn't end the
      // flow - the next tick just tries again with a fresh frame.
      console.error("face capture: one frame failed to process", err);
    } finally {
      runningRef.current = false;
    }
  }, [session, showReason, logFrame]);

  useEffect(() => {
    if (phase !== "capturing" || cameraState !== "ready" || modelsState !== "ready") return;
    const interval = setInterval(() => void tick(), CAPTURE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [phase, cameraState, modelsState, tick]);

  const submitSamples = useCallback(
    async (embeddings: number[][]) => {
      // Guards against two overlapping runs (a double-clicked retry
      // racing the initial auto-submit, or racing another retry click) -
      // a code review on this item, 2026-09-29. Both would otherwise
      // read the same stale "error" rows and double-POST one embedding.
      if (submittingRef.current) return;
      submittingRef.current = true;
      const controller = new AbortController();
      submitAbortRef.current = controller;
      try {
        await submitEnrollment(
          embeddings,
          controller.signal,
          (all, signal) => {
            const modelId = sfaceModelIdRef.current;
            if (!modelId) return Promise.reject(new Error("Face model id not resolved yet."));
            // FACE-02Q (#201): the whole set in ONE request. The hub
            // saves every sample and replaces this person's previous face
            // set in the same transaction, so the outcome is all or
            // nothing: a failure means nothing was saved and the old set
            // is untouched. Discards the response: only whether it
            // resolved or rejected (including via `signal`'s own abort)
            // matters here, submitEmbeddings.ts turns that into a result.
            return api
              .enrollBiometricPrints(
                { person_id: target.id, model_id: modelId, samples: all.map((embedding) => ({ embedding, captured_by: operator.id })) },
                signal,
              )
              .then(() => undefined);
          },
          (all) => {
            setSubmissions(all.map((embedding) => ({ embedding, state: "pending" as const })));
          },
          (result) => {
            setSubmissions((rows) =>
              rows.map((row) => (result.status === "success" ? { ...row, state: "success" as const } : { ...row, state: "error" as const, error: result.message })),
            );
          },
        );
      } finally {
        submittingRef.current = false;
      }
    },
    [operator.id, target.id],
  );

  useEffect(() => {
    if (phase !== "submitting") return;
    // The session's own accepted embeddings, read once on entering this
    // phase, rather than a second, manually-synced list kept alongside
    // it (a code review on this item, 2026-09-29: the parallel list
    // could silently drift from what the session actually accepted).
    void submitSamples(session.embeddings());
    // Runs exactly once per entry into "submitting" - re-running this on
    // every `submitSamples` identity change would re-POST already-
    // succeeded samples the moment operator/target changed for any
    // reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const retryCamera = () => setCameraRetryKey((key) => key + 1);
  const retryModels = () => setModelsRetryKey((key) => key + 1);
  // A failed save saved nothing (all or nothing, FACE-02Q), so a retry
  // resends the whole set.
  const retryFailedSubmissions = () => void submitSamples(submissions.map((row) => row.embedding));
  function cancelEnrollment() {
    // Aborts whichever sample is actually in flight right now, not just
    // the ones still queued - see submitAbortRef's own comment.
    submitAbortRef.current?.abort();
    soundsRef.current?.stop();
    onDone();
  }

  const steps: WizardStep[] = useMemo(
    () => [...POSES.map((pose) => ({ id: pose, title: capitalize(pose) })), { id: "done", title: "Done" }],
    [],
  );

  const bucketFor = (pose: Pose) => status.buckets.find((b) => b.pose === pose)!;
  const currentPose = status.complete ? null : session.currentTarget();
  const currentStepId = currentPose ?? "done";
  let completedCount = 0;
  for (const pose of POSES) {
    if (bucketFor(pose).count >= bucketFor(pose).needed) completedCount += 1;
    else break;
  }

  const allSaved = submissions.length > 0 && submissions.every((row) => row.state === "success");
  const doneAndSaved = currentStepId === "done" && allSaved;

  return (
    <Wizard
      steps={steps}
      currentStepId={currentStepId}
      completedCount={completedCount}
      // Nothing here is user-reorderable: a pose's bucket is captured
      // for real from a live frame, not typed into a form, so there is
      // no earlier answer to jump back and change - a no-op rather than
      // a fake affordance.
      onJumpTo={() => {}}
      onNext={doneAndSaved ? onDone : () => {}}
      nextDisabled={!doneAndSaved}
      nextLabel={doneAndSaved ? "Back to profile" : currentStepId === "done" ? "Saving…" : "Advances automatically"}
      skipLabel={doneAndSaved ? undefined : "Cancel enrollment"}
      onSkip={doneAndSaved ? undefined : cancelEnrollment}
    >
      {currentStepId === "done" ? (
        <CompletionContent target={target} submissions={submissions} onRetryFailed={retryFailedSubmissions} />
      ) : (
        <CaptureContent
          pose={currentStepId}
          cameraState={cameraState}
          modelsState={modelsState}
          videoRef={videoRef}
          canvasRef={canvasRef}
          lastReason={lastReason}
          coveragePct={status.coveragePct}
          onRetryCamera={retryCamera}
          onRetryModels={retryModels}
        />
      )}
    </Wizard>
  );
}

function CaptureContent({
  pose,
  cameraState,
  modelsState,
  videoRef,
  canvasRef,
  lastReason,
  coveragePct,
  onRetryCamera,
  onRetryModels,
}: {
  pose: Pose;
  cameraState: CameraState;
  modelsState: ModelsState;
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  lastReason: string;
  coveragePct: number;
  onRetryCamera: () => void;
  onRetryModels: () => void;
}) {
  if (cameraState === "denied") {
    return (
      <StatusCard
        icon="camera"
        title="Camera access is off"
        body="MaiPai needs your camera to guide face enrollment. Turn on camera access for this site in your browser's settings, then try again."
        actionLabel="Try again"
        onAction={onRetryCamera}
      />
    );
  }
  if (cameraState === "unavailable") {
    return (
      <StatusCard
        icon="camera"
        title="No camera found"
        body="Plug in a camera, or try this from a device that has one."
        actionLabel="Try again"
        onAction={onRetryCamera}
      />
    );
  }
  if (cameraState === "error") {
    return (
      <StatusCard
        icon="alert-triangle"
        title="Could not start the camera"
        body="Something went wrong opening the camera. Try again."
        actionLabel="Try again"
        onAction={onRetryCamera}
      />
    );
  }
  if (modelsState === "error") {
    return (
      <StatusCard
        icon="alert-triangle"
        title="Could not load the face models"
        body="MaiPai couldn't get what it needs for face recognition. Check the connection and try again."
        actionLabel="Try again"
        onAction={onRetryModels}
      />
    );
  }

  const settingUp = cameraState === "requesting" || modelsState === "loading";
  const ring = settingUp ? "none" : captureRing(lastReason);
  const StatusIcon = ring === "green" ? getIcon("check") : ring === "yellow" ? getIcon("alert-triangle") : null;
  const motion = captureMotion(ring);
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4">
      {/* The capture ring (FACE-02J). The kit has no camera-frame or ring
          component (gap named in docs/dev.md), so this is the smallest
          composition of shipped parts: the existing preview box with a
          border colored from the kit's --hue-green and --hue-yellow
          (added to the kit for this ring, FACE-02L), plus the
          status line below, which carries the same verdict in words and an
          icon so color is never the only signal. */}
      <div
        data-capture-ring={ring}
        className={`relative aspect-[4/3] w-full overflow-hidden rounded-[var(--radius)] border-4 bg-black transition-colors duration-300 ${RING_CLASS[ring]}`}
      >
        {/* Mirrored, so turning your head left/right on screen matches
            your own real movement, the way a selfie camera always does. */}
        <video ref={videoRef} autoPlay muted playsInline className="h-full w-full -scale-x-100 object-cover" />
        {/* FACE-02M motion: a decorative layer, never the signal (the ring
            colour, icon and status line are). Every animated class is
            motion-safe:, so reduced motion keeps the colour change only. */}
        {!settingUp && motion.overlay ? (
          <div aria-hidden data-capture-motion={ring} className={`pointer-events-none absolute inset-0 ${motion.overlay}`} />
        ) : null}
        {settingUp ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <Progress mode="spinner" label="Getting the camera and face models ready…" />
          </div>
        ) : null}
      </div>
      <canvas ref={canvasRef} className="hidden" aria-hidden />
      {!settingUp ? (
        <>
          <p className="text-center text-lg font-medium">{POSE_PROMPT[pose]}</p>
          <p className="flex items-center justify-center gap-2 text-center text-base text-muted-foreground" role="status">
            {StatusIcon ? <StatusIcon key={ring} className={`h-5 w-5 shrink-0 ${motion.icon}`} aria-hidden /> : null}
            {captureFeedbackText(lastReason, pose)}
          </p>
        </>
      ) : null}
      <div className="w-full">
        <Progress mode="determinate" value={coveragePct} label="Enrollment progress" />
      </div>
    </div>
  );
}

function CompletionContent({
  target,
  submissions,
  onRetryFailed,
}: {
  target: ProfileEntry;
  submissions: SubmissionRow[];
  onRetryFailed: () => void;
}) {
  const total = submissions.length;
  const failed = submissions.filter((row) => row.state === "error");
  const pending = submissions.some((row) => row.state === "pending");

  if (total === 0 || pending) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <Progress mode="spinner" label={`Saving ${total || "your"} face sample${total === 1 ? "" : "s"}…`} />
      </div>
    );
  }

  if (failed.length === 0) {
    const CheckIcon = getIcon("check");
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <CheckIcon className="h-10 w-10 text-primary" aria-hidden />
        <p className="text-lg font-medium">
          {total} face sample{total === 1 ? "" : "s"} saved.
        </p>
        <p className="text-base text-muted-foreground">{target.display_name} is now enrolled for face recognition.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <p className="text-lg font-medium">The face samples could not be saved.</p>
      <p className="text-base text-destructive">Nothing was changed: any earlier enrollment is still in place.</p>
      <Button type="button" variant="outline" onClick={onRetryFailed}>
        Try saving again
      </Button>
    </div>
  );
}
