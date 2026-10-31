# Models censor, the app filters only to protect kids (2026-10-25)
> Status (2026-10-31): superseded in part by [RULES.md](RULES.md): adult-side limits (rule 10).

Superseded on 2026-10-26 by [adult-content-model-decides-2026-10-26.md](adult-content-model-decides-2026-10-26.md) for adult content blocks beyond CSAM. Child and teen protections and non-content security protections remain.

Status: owner ruling, recorded; architect verdict below. Design and rules only; no code. Items: MODELS-CENSOR-01 to 05 in `docs/BACKLOG.md`.

Jesse, 2026-10-25, chat: "we will let the models do that" (on who decides what an adult may make), then: "review and update all our rules as
follows - models do censorship, our app does filtering - and the only filtering we do is for kid protection." Answers the same day: the
planned per-use Consent tap for adult content of another household adult is dropped, and the app no longer keeps a hard line on sexual
content of real people outside the household (the model decides).

Read for this note: `docs/design/RULES.md` rules 0, 1, 10; `.github/docs/SAFETY.md`; [content-policy-2026-10-18.md](content-policy-2026-10-18.md);
[likeness-consent-2026-10-17.md](likeness-consent-2026-10-17.md); the per-use consent design (removed with this note); and an
inventory of every place code restricts an adult (below).

## 1. The principle

- **Models censor.** Whether an adult's request is made, and whether a reply is given, is the model's own judgment: its training, its
  refusal, and any model-based check the household's models run. No word list, regex, classifier refusal or keyword rule in Home decides
  that for an adult. (Rule 1 already says this for search and tools; this extends it to content.)
- **The app filters only to protect kids.** Home code restricts content only where the person is a child or a teen, or where a child could
  be shown or depicted. For an adult on their own written screen the app adds no content filter, no consent step and no fail-closed
  content check.

## 2. What the app still does, and why it is not censorship

| Kept | Why |
|---|---|
| Every child and teen protection: the lanes, the finished-item check, the output gate, the locked adult-site host list, the news and page floors, the child rewrite | Kid protection. Unchanged. |
| **Nothing sexual involving a minor, anywhere, for anyone**, including an adult's request: the prompt check and the finished-item check that withholds an image or clip showing a possible minor in nude or sexual content | Kid protection. Not negotiable (rule 0). |
| Age and surface gates: a spoken turn, shared screen, TV, guest or child profile never gets adult generation | They keep adult output off screens a child may see. |
| The minor checks fail closed for everyone: `lib/pictures/ageCheck.ts` `decideAgeCheck` (an adult-only job is withheld when the check cannot run) and `screenInputImage` (a sexual edit of an uploaded photo is refused when the check cannot run) | They are the only way the minor line holds on adult-only or sexual work when the vision check is down. Not an adult filter. |
| Credential catch, prompt-injection, jailbreak and PII-extraction handling | Security of the household, not content judgment. |
| Crisis handling: offer resources, never refuse | Care, not a filter. |
| The first-run AI-outputs disclaimer and the one-time adult acknowledgment that unlocks unrestricted mode, both in `.github/docs/SAFETY.md` | Disclosures, not content filters. Both stay |
| Household switches that turn a feature on or off (pictures, videos, songs, family likeness) and quotas | An admin's choice about the household's hardware, not a content rule. |
| Subject identity binding on a saved style (a style belongs to one household member) | Data integrity, not a content rule. |

## 3. What is retired for adults

Inventory source: the 2026-10-25 read-only sweep of `backend/src` (`file:line` as of that sweep). Each row lands as code in a MODELS-CENSOR item.

| Where | Restriction retired for an adult | Item |
|---|---|---|
| `lib/pictures/policy.ts:138-151` `refusePrompt` | Refusing a sexual or undressing prompt that shows a real person | 01 |
| `lib/pictures/policy.ts:160-170` `asksToUndress`, `UNDRESSING` | Refusing an adult's edit of an uploaded photo for undressing or sexual wording ("a photo of a real person never becomes adult content") | 01 |
| `lib/videos/policy.ts:83-96` | Same real-person sexual line, inherited from pictures | 01 |
| `lib/imageEdit.ts:465-467`, `lib/pictures/editTool.ts:124` | The refusal sites for undressing an uploaded photo | 01 |
| `lib/likeness/apply.ts:117-122` `PHOTO_ADULT_LINE` | "A photo of a real person never becomes adult content" | 03 |
| `lib/likeness/importStyle.ts` | Refusing a saved style of someone outside the household or a public figure at add time (a style still binds to one household member; this refusal is retired only for the adult-content wording, the household-member binding stays) | 03 |
| `lib/codeSafety.ts:14` `ADULT_CATEGORIES` | The coding door refusing adults for `harmful_request` and `credible_threat` | 04 |
| Stack `backend/src/lib/media/loraLibrary.ts:76-107` | A word list refusing real-person and public-figure LoRAs for everyone. Not retired by Home; it is the Stack's own check on what a saved style may be. A Stack follow-up item (MODELS-CENSOR-05) decides whether it stays | 05 |
| Stale comments stating the old limits: `settings/pictureKeys.ts:4,61-62`, `pictures/policy.ts:147-148`, `pictures/stack.ts:214` | Reworded with the code that lands | 01 |
| `lib/music/policy.ts:45-47` | Refusing an adult a song that imitates a real person's voice | 02 |
| `lib/likeness/decide.ts`, `guard.ts`, `apply.ts` | Refusing adult content of another household adult, and the "no nudity" negative prompt for non-minor subjects. The negative prompt for a minor subject stays | 03 |
| The per-use consent design, slices 5b to 9 | The Consent tap, `likeness_asks`, the held-job flow: cancelled, never built | 03 |
| `lib/turnMachine/nodes/safety.ts:25-44`, `lib/safety.ts:65-67`, `lib/contentCeiling.ts:41-48`, `lib/turnMachine/nodes/outputGate.ts` | The classifier refusing an adult for `harmful_request` and `credible_threat`. `csam`, `grooming`, `pii_extraction`, `prompt_injection` and `jailbreak` stay (kid protection and security). Rule 13 applies: measure the model's own handling before the switch | 04 |
| `lib/contentPolicy.ts`, `contentCeiling.ts` adult dials | The app's adult defaults and unwired adult dials are removed. A person's own opt-in filter for themselves (swearing, drugs, gambling, gore), if they turn one on, stays: the app imposes nothing, the person chose it. CONTENT-POLICY-04 and 05 keep building only that opt-in; the sentence about an admin or the app filtering an adult by default is dropped from them | 04 |

## 4. Rule text changes (Owner-approved: 2026-10-25)

Applied to `docs/design/RULES.md`: a new principle paragraph in rule 0; rule 0's list of absolute lines reduced to the minor line and the
teen and child real-person block; the 2026-10-25 real-person sentence extended from "any non-sexual" to "any"; rule 10's "every generation
prompt and finished picture or clip keeps the absolute check" narrowed to "keeps the minor check". `.github/docs/SAFETY.md` changes in a separate `.github` commit (section 5). Superseded markers are added to nine older design notes (section 5).

## 5. Supersedes

- `likeness-consent-2026-10-17.md`: its per-person agreement (already retired by LIKENESS-SIMPLIFY-01) and its public-figure and outside-person
  bars.
- The per-use consent design (deleted with this note): the whole approval flow (slices 5b to 9, the `LikenessAsk` record, `likeness.per_use`). Its slices 1 to 5
  (LIKENESS-SIMPLIFY-01) stand. Rule 0's "household adult's adult content only through their own style and that adult's consent" is removed.
- `content-policy-2026-10-18.md`: the adult "absolute lines" for real people and the real-voice clause; the child and teen floors stand.
- RULES.md rule 0 (absolute lines, family clause), rule 10 (absolute check on every generation), as in section 4. Nothing else in RULES.md.
- `.github/docs/SAFETY.md`: lands in its own `.github` change (section 4). It must add a principle bullet (models decide for adults; the app filters only to protect kids), rewrite the real-people bullet (drop "a photo of a real person is never turned into adult content" and "public figures and anyone outside the household stay refused"; keep nothing sexual involving a minor and the no-real-people rule for teens and children), change "the same absolute lines" to "the minor line", and keep the sentence that no setting disables the generation checks (they include the minor check failing closed).
- Design notes that still state a retired adult line get a Superseded marker in this change: `image-generation-2026-10-17.md`, `image-editing-2026-10-17.md`, `image-engine-2026-10-17.md`, `video-generation-2026-10-17.md`, `music-generation-2026-10-17.md` (the real-voice clause), `companion-video-characters-2026-10-21.md`.
- User docs change in the same commit as the code that lands, so each item names its docs: MODELS-CENSOR-01 `docs/user/pictures.md`, `docs/user/videos.md` and the fumadocs `make-and-edit-pictures.mdx` and `make-short-videos.mdx`; MODELS-CENSOR-02 `docs/user/songs.md` and `make-songs.mdx`; MODELS-CENSOR-03 `docs/user/pictures.md` likeness lines.

## 6. Risks named once, owner decided

- **Real people.** A realistic sexual image of a real person who did not agree is illegal intimate imagery in many places (for example the US
  federal Take It Down Act). With no app line, whether that is made rests on the model's refusal. Jesse's ruling accepts that; this note
  records the exposure so it is a decision, not a surprise.
- **A household member's likeness.** An adult can now make adult content with another household adult's saved style with no consent step.
  A style is made only by an admin from that person's photos, which is the remaining control.
- **The classifier.** Dropping `harmful_request` and `credible_threat` refusals for adults moves that judgment to the model; rule 13's measured
  bench is required before the switch, hence item 04.

## 7. Architect verdict

Pending.
