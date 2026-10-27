# The finished-image check

Every picture, clip frame or upload that Home makes or accepts goes through one check before anyone sees it (RULES.md rule 0). There is one decision and
two doors into it. Never write a third.

| What you are checking | Call | Where |
|---|---|---|
| A picture, clip or described edit made by a job | `gateFinished` | `backend/src/lib/pictures/laneGate.ts` |
| Any other image: companion art, an upload, a new place that makes pictures | `checkFinishedAssets` | `backend/src/lib/pictures/finishedCheck.ts` |
| A companion's own art | `checkCompanionArt` (wraps the one above) | `backend/src/lib/companionArtCheck.ts` |

## What the decision is

- Apparent age is checked for everyone (`ageCheck.checkImages`). An adult-oriented item that may show a minor in a sexual picture is withheld.
- A teen's or a child's item is withheld if anything in it is nude or sexual, and the child lane adds the cartoon and child-safety question (`decideForLane`).
- A check that cannot run withholds (it fails closed) for a teen, a child and any adult-only item. Companion art is always held to this.
- The stricter of the audience the item is for and the person who asked decides the lane (`stricterLane`).
- A withheld item is reported to the admins without the image, at most once in ten minutes per person (`ageCheck.recordWithheld`).

## Verdict cache

`checkFinishedAssets` keeps verdicts by the file's sha256 in the cache the caller passes in, so a file is looked at once. A failed check is never cached.
A companion keeps its cache in its `states.json` `checks`.

## Companion art

- Look pictures and character sheet views are checked when they are generated (a failed candidate is dropped and the job says why) and when a picture is uploaded (HTTP 422).
- A finished clip's still and keyframes are checked when it finishes. A clip that fails has its files removed and its take says why; it cannot be approved.
- Publish and an audience change check again (`checkAssets` in `routes/companions.ts`), because the audience may have moved since.
- Art that was live before art was checked is checked once at start (`sweepLiveCompanionArt`): art that fails is narrowed to the audience it passes (all ages, then teen, then
  adult-only), or the companion becomes a draft. A companion whose art cannot be checked is left alone and tried again at the next start. The marker is
  `companions/.art-checked.json` in the data folder.

## Adding a new place

Call `checkFinishedAssets` with the lane, `adultOnly`, the kind and your cache, show the `reasons` as they stand (each already says what to do), and add a test that
a flagged image and a check that cannot run are both refused.
