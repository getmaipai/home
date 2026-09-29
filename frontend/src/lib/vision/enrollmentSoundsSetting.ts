// FACE-02M: whether the face-capture sounds are on. ONE seam, so wiring
// the real setting is a one-line change here and nowhere else.
//
// PENDING (FACE-02N, docs/BACKLOG.md): the person-scoped key
// `ui.enrollment_sounds` (boolean, default true, level basic, lives_in
// "profile.appearance", honoured_by ["home"], label "Enrollment sounds",
// mirroring `ui.appearance`) has to be declared in getmaipai/commons's
// spec/settings/keys.json first (a key declared only in this repo's
// backend fails scripts/check.sh's registry drift check against the pinned
// spec). Until then this returns true, and the capture flow is proven
// against both values through the override below.
let override: boolean | null = null;

/** Test seam: force the answer; null restores the default. */
export function setEnrollmentSoundsEnabledForTest(value: boolean | null): void {
  override = value;
}

export function enrollmentSoundsEnabled(): boolean {
  if (override !== null) return override;
  return true;
}
