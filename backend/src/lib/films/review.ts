// The one place a film shot's review state is read (VF-REPAIR-01 slice 1). "Reviewed" means the person marked the shot on the Film maker page (keep or skip, through
// `film-review`). Approving the storyboard approves the plan, not a take. CREATOR-30's single review state replaces this helper and nothing else.
export type ShotReview = "kept" | "skipped" | "unmarked";
export function shotReview(shot: { kept?: boolean }): ShotReview {
  return shot.kept === true ? "kept" : shot.kept === false ? "skipped" : "unmarked";
}
