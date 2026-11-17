import type { SubjectWithRefs } from "@/lib/mediaSubjects";

/** Stored order is intentional: first photo is the face. A generated sheet is never a face reference. */
export function swapReferencePhotos(cast: SubjectWithRefs): SubjectWithRefs["references"] {
  return cast.references.slice(0, 3);
}
