// IMGSIM-01: the one place Home decides whether two pictures are the same
// photo (principle 1: one definition, one implementation). Pictures in
// answers use it today; a photo-library duplicate finder, upload duplicate
// warnings and robot captures are to use it, never a copy of it.
// fingerprint() is cheap and storable (versioned); compare() and cluster()
// add the ORB + RANSAC check only where the cheap stage cannot decide.
import { hashDistance, type ImageFingerprint } from "./fingerprint";
import { geometricFeatures, verifyPair } from "./geometry";
import { SAME_PIXELS_BITS, VERIFY_RADIUS_BITS } from "./cluster";

export { FINGERPRINT_VERSION, fingerprint, hashDistance, hamming, type HashPair, type ImageFingerprint } from "./fingerprint";
export { geometricFeatures, verifyPair, warmGeometry, MIN_AGREEMENT, MIN_INLIERS, type GeometricFeatures, type PairVerdict } from "./geometry";
export { cluster, MAX_VERIFIED_PAIRS, VERIFY_TIME_BUDGET_MS, SAME_PIXELS_BITS, VERIFY_RADIUS_BITS, type ClusterGroup, type ClusterItem, type ClusterOptions, type ClusterResult } from "./cluster";

export type CompareReason = "same_pixels" | "same_photo" | "different" | "far";
export type CompareResult = { same: boolean; reason: CompareReason; distance: number; inliers?: number; agreement?: number; overlay?: [number, number] };

/** Whether two pictures are the same photo, and why. */
export async function compare(a: { bytes: Uint8Array; fingerprint: ImageFingerprint }, b: { bytes: Uint8Array; fingerprint: ImageFingerprint }): Promise<CompareResult> {
  const distance = hashDistance(a.fingerprint, b.fingerprint);
  if (distance <= SAME_PIXELS_BITS) return { same: true, reason: "same_pixels", distance };
  if (distance > VERIFY_RADIUS_BITS) return { same: false, reason: "far", distance };
  const v = await verifyPair(await geometricFeatures(a.bytes), await geometricFeatures(b.bytes));
  return { same: v.same, reason: v.same ? "same_photo" : "different", distance, inliers: v.inliers, agreement: v.agreement, overlay: v.overlay };
}
