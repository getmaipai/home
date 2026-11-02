# Adult-facing content refusals: audit (2026-11-01)

Owner ruling, 2026-11-01 (Jesse): the models do the censoring, the app only filters. Rule 0 of
[RULES.md](../design/RULES.md) already limits Home to the CSAM line for an adult. This audit lists every place Home can refuse
or rewrite adult content and says what stays.

| Path | What it blocks | Applies to | Verdict | Why |
|---|---|---|---|---|
| `backend/src/lib/pictures/policy.ts` `promptViolatesMinorLine` | `detectCsam`; the wide minor-word plus sexual-word rule only when the lane is not adult | all lanes (wide rule: child, teen) | keep | CSAM line; the adult path is the direct detector only |
| `pictures/policy.ts` `refusePrompt`, `childPromptUnsafe`, `teenPromptUnsafe`, `asksToUndress` | topic and undress filters | child, teen | keep | minor lanes unchanged |
| `videos/policy.ts`, `music/policy.ts` | same minor line; no real-person or real-voice refusal | all lanes | keep | already CSAM-only for adults |
| `pictures/ageCheck.ts` `decideAgeCheck`, `isAdultOnlyJob` | a possible minor with nudity or sexualization in generated media; unrun check fails closed | adult-only jobs | keep | rule 0 CSAM candidate |
| `pictures/ageCheck.ts` `screenInputImage` (unrun-check branch) | refuses when a sexual ask and a minor cue appear together | adult | keep, owner to confirm | it only runs when the age check could not; a narrow CSAM guard, not a topic filter |
| `lib/safety.ts` `evaluateSafety` with `direction` | adult keeps csam, self_harm, pii_extraction, prompt_injection, jailbreak | adult | keep | non-content protections |
| `lib/codeSafety.ts` `ADULT_CATEGORIES` | was self_harm, harmful_request, credible_threat, csam, grooming | adult | remove two dead entries | `harmful_request` and `credible_threat` are never returned for an adult; self_harm, csam and grooming stay (MODELS-CENSOR-04 names grooming) |
| `lib/contentPolicy.ts` | adult default is `minor_line`; other filters are opt-in | adult | keep | already default-off |
| `lib/contentCeiling.ts` FLOOR | documentation constant bound to the spec | none | keep | not a gate |
| `lib/media/band.ts` | floors for minors | child, teen | keep | minors only |
| `lib/askNames.ts`, `unknownNames.ts` | household-name privacy gate | all | keep | privacy, not content |
| `routes/safety.ts` `/check` | diagnostics, no direction | none | keep | not a gate |
| Design notes (image editing, generation, engine, video, music, likeness, companion video, content policy) | retired per-person agreement, real-person and real-voice text | docs | cut (DOCS-RETIRE-01) | contradicted rule 0 |

## Done in this change

- DOCS-RETIRE-01: the eight notes no longer describe the agreement, signed proof, real-person or real-voice refusals as current.
- Dead adult categories removed from `codeSafety.ts`; stale "absolute lines" comments fixed.
- `backend/tests/censorRemoval.test.ts`: an adult is not refused for a real-person, undress or real-voice prompt; a child and a teen still are;
  minor sexual stays refused in every lane.

## Still open (not done here)

- MODELS-CENSOR-04: the chat classifier's spec change needs a new `commons` tag; Jesse approves tags.
- MODELS-CENSOR-05: the Stack's LoRA word list and signed-proof gates live in the `stack` repo and need Jesse's decision.
- `screenInputImage` unrun-check rule above: confirm keep or remove.
- CONTENT-POLICY-02 and -03: consumer rewiring of the opt-in filters (child and teen focus), not adult censorship.
