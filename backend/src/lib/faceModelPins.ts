// The one shared pin for the SFace face-recognition model, read by
// both the hub's enrollment validation (biometricPrints.ts) and the
// browser's model-serving route (visionAssets.ts) - a review
// (2026-09-28) found the same sha256 declared independently in both,
// a "one definition, one place" violation with a real drift risk if
// the model is ever re-pinned in only one location. Extracted here
// instead of one importing from the other, since neither module is
// conceptually "the owner" of the other's concern (consent
// validation vs. serving bytes to a browser) - both are equally
// callers of this shared fact about which model build is pinned.
export const SFACE_MODEL_ID = "sface-2021dec";
export const SFACE_SHA256 = "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79";
export const SFACE_DIM = 128;
