# IMGQ-16: the final picture and search setup (2026-10-13)

CIRCLE BACK note. This closes the search-and-pictures plan (IMGQ-09 to IMGQ-15, ROUTER-SHIP-01). The setup below is what runs now. It is
not at its bar, and the follow-ups are filed as IMGQ-17.

## What shipped, in plain words

- **The answer-picture pipeline stays as it is.** The entity resolver is unchanged. IMGQ-13a built a new resolver (pick the entity by the
  asked name and notability, kind as a hint) and it was reverted on 2026-10-13: on the sealed IMGQ-15 set it was no better than the old
  one, and after two tuning rounds it still lost on the held-out half (9.6 percent wrong against 8.5 percent). The tile ordering from
  IMGQ-08 and IMGQ-10 (Commons categories, then the subject's Wikidata depicts search) is what shows today.
- **IMGQ-09 wording shipped, with the re-ask off by default.** The stronger `show_images` description and few-shot block are live on the
  adult offer path. The after-the-answer re-ask is built and switched off (`MAIPAI_IMGQ09_REASK=1` turns it on). Whether to turn it on is
  Jesse's choice: it lifts offer recall but adds about 3.4 s after the reply and more false offers. See `docs/plans/imgq-09-2026-10-12.md`.
- **Search head arm C shipped locally** (ROUTER-SHIP-01): `SEARCH_ASSIST_PIN` names `search-assist-weights-v2`. Sealed lock-box recall is
  82.4 percent against arm A's 75.2 percent. It still misses the 0.91 bar and false searches are no better. It cannot download until Jesse
  publishes the `search-assist-weights-v2` release asset (the file is `data-scratch/chat-ab/router-build-02/dev/c-manifest.json`, uploaded
  under that name). Details: `docs/plans/router-build-02-2026-10-12.md`, section 11.

## What was tried and did not work

| Idea | Result | Note |
|---|---|---|
| Small CLIP-family tile checkers (CLIP B/32, TinyCLIP 39M/16, SigLIP 2 base) | At 2 percent right-tile false drop they catch 0 to 41 percent of bad tiles on held-out | IMGQ-12a, `imgq-12a-bench-results-2026-10-12.md` |
| Lead-image similarity (things only) | AUC 0.80, against 0.80 to 0.84 for the text score, so it adds nothing alone; the AND combination dropped 55 percent of right tiles | IMGQ-12b, `imgq-12b-lead-image-2026-10-12.md` |
| Qwen3-VL-8B yes/no tile judge | AUC 0.80 held-out (0.81 tuning), 0.81 s per tile, clean-question rate 0.65 held-out | IMGQ-12d, `imgq-12d-vl-check-2026-10-13.md`; dev data only |
| Plain Commons or SearXNG order instead of the current order | Clean-question rate 0.40 (Commons) and 0.31 (SearXNG) against 0.80 for the current order on dev; 0.34 and 0.40 against 0.76 on the sealed set | IMGQ-14, `imgq-14-plain-search-order-2026-10-12.md` |
| Commons MediaSearch ordering | Its top 5 equals plain Commons search for 56 of 70 subjects, so it is no new source | IMGQ-14 |
| Tuned entity resolver (IMGQ-13a, two tuning rounds) | 9.6 percent wrong held-out against 8.5 percent for the old one | IMGQ-15, `imgq-15-entity-sealed-2026-10-13.md`; reverted in IMGQ-13a revert |

The clean-question bar is 0.975. Every checker and every reordering above is far from it, which is why none shipped.

## Known miss (circle back)

The fresh sealed IMGQ-11 set (67 questions) is the honest measure of the shipped pipeline:

- Wrong tile on 8 of 67 questions (11.9 percent, about 1 in 8), against a bar of 1 in 40.
- Offer recall (the model offers pictures when asked) is 0.50 with the shipped wording, 0.78 with the re-ask on, against a bar of 0.80.

Neither miss has a fix that passed measurement. The open ideas are filed as IMGQ-17 in `docs/BACKLOG.md`.
