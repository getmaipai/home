# IMGQ-15: entity resolver on the sealed set (tune half only)

Date: 2026-10-13. Status: tune half scored; the 60 held-out subjects are NOT scored, kept sealed for a later single pass.

## Setup

- Sealed set: `data-scratch/chat-ab/imgq-15-2026-10-13/subjects.json`, 120 subjects, sha256 `583988ddebb711cae26b738b45fe96ff22b0f07bb1e4060a814d94b1c8772c64` (verified before capture). Split: 60 tune, 60 held-out (`split.json`, seed 20261013).
- One paced capture: one request at a time, 1.5 s apart, the Home user agent, 906 distinct URLs, 0 errors. It covers 479 subject+kind pairs for both resolvers plus the intended-title lookups.
- Arms: `real` (the 9B's own subject and kind from `kinds.json`, 237 of 360 runs called show_images, 196 distinct pairs), and hand-written `specific`, `generic` and `blank` kinds on the clean subject.
- Old resolver: `wikimedia.ts` as of commit 460d360a. New resolver: commit 96ab2dee. Both replayed offline from the one capture (`imgq-13a/record.ts`, `replay.ts`, now argument-driven).
- Scoring: right means the resolved item is the intended title or an accepted alternate (compared by Wikidata item and by title); skipped (no picture) is counted apart from wrong. Wrong-entity rate is wrong divided by all scored, averaged per subject. Interval: paired bootstrap over subjects, 4000 resamples, difference old minus new (negative means the new one is worse).

## Tune result (60 subjects)

| Arm | n | Old wrong | New wrong | Old minus new, 95% interval | Skip old / new | Calls old / new (max) |
|---|---|---|---|---|---|---|
| real | 56 | 3.9% | 7.1% | -3.3 [-8.3, +0.6] | 8.3% / 9.5% | 2.9 / 3.0 (4) |
| specific | 60 | 1.7% | 5.0% | -3.3 [-10.0, +3.3] | 1.7% / 1.7% | 3.0 / 3.1 (4) |
| generic | 60 | 3.3% | 5.0% | -1.7 [-5.0, 0.0] | 13.3% / 11.7% | 3.0 / 3.1 (4) |
| blank | 60 | 3.3% | 3.3% | 0.0 [0.0, 0.0] | 13.3% / 13.3% | 3.0 / 2.9 (3) |

The new resolver is not better on this set: equal on blank, slightly worse on real, specific and generic. No interval excludes zero, so this is not a proven loss, but there is no gain either. Calls per subject are 3 to 4 for both.

By bucket (real arm): ambiguous 6.4% old vs 13.5% new wrong; qualified, plain, people 0 to 5% and identical; dab 0% wrong both, skipped 16.7% old vs 38.9% new. Specific arm, dab: old 0% wrong, new 33.3% wrong (one subject).

## Regressions (old right, new wrong)

- real: 4 runs over 3 subjects. q022 biscuit (Biscuit became Cookie), q035 Little Mermaid statue (statue page became the fairy tale), q043 Dune novel (twice; Dune (novel) became the page titled Dune).
- specific: 2 (q022, q043). generic and blank: 0.
- Also in the new column only: q112 Challenger with kind "space shuttle" is skipped as ambiguous where the old one was right (real and specific), and q115 Discovery with kind "space shuttle" picks the Discovery Program where the old one skipped.
- Fixes (old not right, new right): 1 in real, 1 in specific.

## Disambiguation outcomes (new, dab bucket)

real: 5 right, 2 skipped ambiguous, 1 no article. specific: 1 right, 1 wrong, 1 skipped. generic: 1 wrong, 2 skipped. blank: 3 skipped.

## Finding, not acted on

The sealed tune set shows the three weak points named in the IMGQ-13a handoff: the 40% cut and alias matching let a more notable neighbour win (Biscuit to Cookie, Little Mermaid statue to the tale), the page-title preference lost to a bare title (Dune), and a decided kind "space shuttle" now ends ambiguous for Challenger where the old kind veto got it right. No source was edited. Any change to the resolver needs a tune-set fix first (cut, tiering or kind weighting measured on these 60 ids only), then a single score of the 60 held-out.

Unscored: the held-out half, so it stays usable after a fix. `score.py heldout` produces it in one command.
