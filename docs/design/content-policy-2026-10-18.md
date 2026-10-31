# One content-protection definition per person
> Status (2026-10-31): superseded in part by [adult-content-model-decides-2026-10-26.md](adult-content-model-decides-2026-10-26.md): the adult path; child and teen protections stand.

> **Superseded in part (Owner-approved: 2026-10-25):** [models-censor-app-protects-kids-2026-10-25.md](models-censor-app-protects-kids-2026-10-25.md) retires the adult-side limits described here: the adult absolute lines for real people and the real-voice song limit; the child and teen floors stand.

Design only, 2026-10-18. Owner goal: set protections once for chat, search, pictures, videos and songs.
Architect verdict: proposed: APPROVED-WITH-CONDITIONS; architect agent has not ruled.
All six slices require independent review because they touch minors. No lane opens on this note alone.

## Supersedes

Owner ruling 2026-10-25 (Jesse, chat): RULES.md rule 0's absolute line "no real person outside the household, no public figure" no longer binds an adult for non-sexual pictures and videos (and, where the `real_person` content check runs, writing); it still binds teens and children, and sexual content that shows a real person outside the household or a public or historical figure stays blocked for everyone. The `real_person` row below is read that way.

[RULES.md rule 0](RULES.md), owner-approved 2026-10-18 in `9ae5698a`, wins. Rule 6 keeps fixed policy lines;
rule 6a limits logs; rules 9 and S4 require shipped kit parts and the Settings shell.

This proposal supersedes feature-local protection lists, the unused ceiling dial source, and the per-person agreement,
notices and use history in [likeness consent](likeness-consent-2026-10-17.md). It replaces the temporary protection seam
signature in [music section 18.7](music-generation-2026-10-17.md#187-teens-and-children-make-songs-a-childs-request-is-rewritten-not-refused-owner-2026-10-18-music-gen-22)
with the interface below. It preserves section 18's finished-song checks and closed lanes until their dependencies ship.

The sibling `.github/docs/SAFETY.md` was read from its checkout. Its older household likeness agreement and adult-only
subject limits conflict with the newer Home rule 0. Home's rule wins here; LIKENESS-SIMPLIFY-01 needs a coordinated
standards update before release, without changing that file in this docs task. No other safety invariant is relaxed.

## Today: evidence inventory

Code references below are relative to the repo root at `origin/main` = `ff9aa485d23735bea61334b500a1c23ee752ab93`,
also this worktree's HEAD when inspected. Each named symbol/key was searched with `git grep origin/main`.
Commons references explicitly name the installed package, which differs from the sibling commons checkout.

| Current source and code location | What it does today | Destination |
|---|---|---|
| `backend/src/settings/searchKeys.ts:60`, `:129`, `:176`, `:222`; `backend/src/lib/blocklists/policy.ts:17`, `:48`; `backend/src/lib/settingsLayers.ts:137` | `search.safe_search`, `search.blocklists.child`, `.teen`, `.adult`, and layered `search.blocklists`; host lists from spec, with locked minor hosts | Policy resolves protections once; search keeps its transport and host enforcement |
| `backend/src/lib/packageHost.ts:727`, `:2365`, `:2421`; `backend/src/lib/answerImages/select.ts:137` | Search provider SafeSearch, fetched document floor and answer-image text checks | Same policy snapshot, including answer images |
| `backend/src/lib/topicStances.ts:25`, `:31`, `:37`, `:45`; `backend/src/lib/topicPrompt.ts:18`, `:35` | `topics.bodies`, `.health`, `.risk`, `.violence`, `.teen.bodies`, `.teen.risk`, `.family_stories`, `.family_story_names`; model guidance from band records | Policy snapshot supplies resolved topic guidance, never a word classifier for subject understanding |
| `backend/src/settings/aiKeys.ts:123`; `backend/src/lib/turnMachine/nodes/outputGate.ts:192` | `chat.teen_gate_grain` chooses sentence or arrival checking, not filter strength | Keep grain separate and unchanged |
| `backend/src/settings/pictureKeys.ts:9`, `:21`, `:42`, `:65`, `:80`, `:92`, `:104`, `:116`; `backend/src/settings/videoKeys.ts:9`, `:21`, `:42`; `backend/src/settings/musicKeys.ts:9`, `:21` | `generation.adults`, `.adult_adapters`, `.picture_quality`, `.people_prompts`, `.kids`, `.kids_daily_pictures`, `.kids_daily_videos`, `.kid_enabled`, `.video.enabled`, `.video.adult_adapters`, `.video_quality`, `.music.enabled`, `.music.length` | Keep availability, quality, quotas and surface gates; they cannot weaken policy |
| `backend/src/lib/pictures/lane.ts:27`, `:38`, `:62`, `:71`, `:93`, `:100`, `:109`, `:118` | Stricter actor/turn band; quota constants; child redirects; `CHILD_UNSAFE_TERMS` has drugs, gore and gambling terms; `CHILD_IP_NAMES`; `childPromptUnsafe`; `teenPromptUnsafe` checks adult terms but lacks gore and strong profanity; forced cartoon and negative prompt | Lists and thresholds become reviewed policy data; lane keeps cartoon, quota and source restrictions |
| `backend/src/lib/pictures/policy.ts:132`, `:138`; `backend/src/lib/pictures/minorLine.ts:45`; `backend/src/lib/videos/policy.ts:96` | `promptViolatesMinorLine` calls `detectCsam` then the wider picture floor; `refusePrompt` has child, teen and adult paths; video delegates | Shared absolute checks and kind results, with compatibility adapters while migrating |
| `backend/node_modules/@maipai/spec/safety/ts/signals.ts:306`; `backend/node_modules/@maipai/spec/safety/ts/fold.ts:184` | Installed commons `detectCsam` and `foldForSafety`; sibling commons `signals.ts:381` is a different revision | Reuse installed shared detectors and fold; do not copy them |
| `backend/src/lib/contentCeiling.ts:51`, `:54`, `:82`, `:109`, `:143` | Eight dials: profanity, sexual, violence, substances, crime, hate, self_harm, privacy. Band records are frozen; topics are read, dial values have no enforcement reader | Derive ceiling projection from policy; keep existing classifier floors |
| `backend/src/lib/safety.ts:33`; `backend/src/lib/turnMachine/nodes/outputGate.ts:109`, `:310`, `:327`, `:596`, `:641` | Safety evaluation takes speaker band, not person's filters; whole answer, stream and reasoning use it | Thread resolved person/audience policy through every output path |
| `backend/src/lib/news/childGate.ts:37`; `backend/src/lib/newsMinorFloor.ts:29`; `backend/src/lib/retrieval/minorFloor.ts:28`; `backend/src/lib/retrieval/minorRowFloor.ts:11`; `backend/src/lib/packageHost.ts:2421` | News sentence gate and fetched-page, row and package text floors use band/minor checks | News and retrieval must consume the same resolved policy as chat/search |
| `backend/src/lib/music/policy.ts:25`, `:40`, `:45`; music design section 18.7 | Music view blocks minors; prompt checks reuse minor line and real-voice flag. Planned seam covers prompt, lyrics, title, transcript | CONTENT-POLICY-04 wires that seam, with no song word list |
| `backend/src/lib/pictures/lane.ts:62`, `:63`, `:66`; `backend/src/lib/pictures/policy.ts:138`; `backend/src/lib/turnMachine/nodes/outputGate.ts:79` | Fixed teen/child redirect and no-photo lines, plus absolute refusal lines recognized by output gate | Policy owns reviewed fixed lines; preserve safe handling of those lines |

There is no swearing setting or deterministic swearing filter today. The profanity dial is guidance data, not enforcement.
The search blocklists are host lists, not the missing text filters. A search of runtime dial references found no reader.

## Contract and one data table

Proposed module: `backend/src/lib/contentPolicy.ts`. This is the interface the music work targets:

```ts
export type ProtectionKind = "swearing" | "drugs" | "gambling" | "gore"
  | "sexual" | "minor_line" | "real_person"; // open union, extend through review
export interface ContentPolicy {
  readonly filters: ReadonlySet<ProtectionKind>;
  check(text: string, field: "prompt" | "lyrics" | "title" | "transcript"):
    null | { kind: ProtectionKind; line: string };
}
export function contentPolicyFor(subject: Person | Audience): ContentPolicy;
export function filtersFor(person: Person): ReadonlySet<ProtectionKind>;
```

`Person` and `Audience` above name existing shared person and resolved audience shapes, not new stored records.
An audience carries actor, effective band, surface and resolved household subject context. Resolve the stricter actor/turn band;
a shared audience unions all present people's filters and takes the youngest band. Unknown identity or role uses the child floor. Age band comes from role; birthdate is optional and may only tighten it.
`filtersFor` is exactly the person form's set. Resolution reads a validated in-memory settings snapshot; `check` does no I/O.
Freeze policy data and expose a set that cannot be mutated at runtime, not merely a TypeScript readonly annotation.

| Kind | Child | Teen | Adult | Data and implementation |
|---|---|---|---|---|
| `swearing` | All listed profanity | Strong profanity; mild remains allowed | Own opt-in | One data list with severity metadata, not two lists |
| `drugs` | On | Own/guardian added filter | Own opt-in | Data terms, safe-context fixtures |
| `gambling` | On | Own/guardian added filter | Own opt-in | Data terms, boundary fixtures |
| `gore` | On | On | Own opt-in | Data terms and finished-item checks |
| `sexual` | On, fixed | On, fixed | Own opt-in; adult lane only | Shared adult-content detection and generation checks |
| `minor_line` | Always | Always | Always | Commons detector plus existing wider minor floor |
| `real_person` | Outside-household/public figure line always | Same | Adults: only sexual content that shows a real person is blocked (owner, 2026-10-25); non-sexual pictures, videos and writing about public, historical and outside people are allowed | Trusted household identity context, not a names word list |

Adult defaults are only the absolute lines. Adult acknowledgment, crisis resources, privacy floors and other existing safety
architecture still apply. Teen defaults also keep every teen protection, not just these seven labels. An optional filter's
absence is never permission to cross a hard line. Real-voice imitation remains independently gated until its existing safety
contract permits a use; family songs about people do not automatically authorize voice cloning.

Store terms as versioned, schema-checked data under `backend/src/lib/contentPolicy/data/`, with kinds, severity, fixed lines,
and reviewed boundary exceptions. Move child terms and teen terms there; move the wider minor-line data only where it is
Home-owned. Commons owns its own detector data. Keep one source for each list, with tests beside the module. No explicit
term examples belong in this note; fixtures use neutral IDs such as `[KIND_A]` in reports. Actual test corpus stays in tests.
The deterministic floor catches listed patterns; it cannot prove that arbitrary language or an image is safe. Existing model
instructions, source controls and fail-closed finished-media inspectors remain required.

`check` is synchronous and deterministic, with no model call. Validate input/field, fold once with commons `foldForSafety`,
then evaluate bounded matchers in stable order: absolute lines first, then adult-content floor, then optional kinds in table
order. Return the first fixed line. An internal error returns `{ kind: "minor_line", line: "I couldn't check that safely. Try something different." }`,
never `null`; kind is a conservative contract fallback, not a claim about the text. Unknown kinds, invalid policy data or a
failed settings read invalidate the snapshot and block. Do not truncate text to meet the time target. Streaming callers retain
cross-chunk context so split terms and cross-sentence combinations cannot bypass the existing gate.

Chat and search use `transcript` for ordinary prose until spec adds another field; this is text to check, not an instruction
to transcribe chat. Fixed policy lines are tested through the output gate and do not become model-written tool failure copy.

## Settings and ceiling projection

Use the existing settings store and resolver (`backend/src/lib/settings.ts`, `settingsLayers.ts`), not a new person table.
Proposed keys, all **ahead-of-spec**, require commons schema, registry, copy, areas and permission definitions before Home:

| Proposed key | Scope and write authority | Meaning |
|---|---|---|
| `content.filters` | Person; adult self, minor self may only add, assigned guardian may tighten their minor; admin may tighten minors | Added kinds, default empty; union with immutable band defaults |
| `generation.household_likeness` | Household; owner/admin | On by default; enables permitted household subjects |
| `content.policy.chat_output`, `.search`, `.pictures`, `.videos`, `.songs` | Household rollout flags; owner/admin | Consumer migration only, never disable a floor |

No adult, guardian or admin can remove a minor's band minimum. A guardian can remove a prior added restriction only down to
that minimum. An admin cannot set another adult's own filters. Server validation enforces writes and resets, imports and old
clients included. Do not infer guardian rights merely from adult status. Settings uses the existing SettingsShell and spec copy;
no new wrapper, override or settings store. Minor UI shows fixed defaults as read-only and explains who added a restriction.

SafeSearch and topic overrides retain rule 0's existing admin authority and precedence: person > household > band.
`search.web_sources` stays household-only. Those fetch/guidance choices cannot weaken the fixed host list, output gate or
content filters. Map drugs/gambling/gore search categories into `content.filters` once, while retaining unrelated host categories,
custom hosts and adult-site locks. Do not claim host categories and text terms are equivalent or delete the host lists.

Make `contentCeiling` a projection of the same resolved policy. Profanity maps all/strong/none to off/mild/band baseline;
sexual maps a filter to off; gore caps violence below graphic; drugs caps substances; gambling tightens the risk/crime guidance.
The existing band values remain upper bounds for minors. Crime, hate, self_harm and privacy retain their existing band guidance
and shared floors, with no invented one-to-one mapping. Topic rendering reads this projection. Dials guide the model and never
replace deterministic checks. Tests pin all eight dial results and keep crisis help available even when a harmful output blocks.

## Child rewrite and hard lines

Add an async `rewriteForChild` helper beside policy, separate from the synchronous `check`. First check original words for
hard lines, then use the household model to soften a request, then run every floor again on the rewrite and finished output.
No word rule decides whether a tool or search is needed. The helper runs only after the existing generation path is selected.

| Child request, neutral wording | Action |
|---|---|
| Heavy rock about scary Halloween | Happy light rock about Halloween, gentle and not too scary |
| Heavy rock about friendly animals | Keep animals and rock style, soften the sound and mood |
| A gun fight, with no injury detail or instructions | A friendly pretend adventure with no weapons, injury or fighting |
| `[ADULT_STYLE_REQUEST]` | Fixed child-safe redirect, no generation; this stands for the brief's adult-style example |
| A graphic attack or self-harm request | Fixed child-safe redirect; keep crisis support when applicable |
| A real person's name | Resolve household identity; household cartoon/song subject may pass when option is on; outside household, public figure or unresolved identity redirects |

Hard lines are never laundered through a rewrite: adult-content requests, the absolute minor line, graphic violence, harmful
self-harm content, real people outside the rules, prohibited instructions and other existing child floors keep their safe redirect.
Distinguish a non-graphic pretend fight from graphic harm. A health or crisis question still gets care and help, not a generated
item or a refusal of support. A household subject is drawn as a child-safe cartoon for a child: the family exception never
allows photos/references in that lane or adult content involving a minor, whoever requested it.

The rewrite preserves safe topic and intent, uses fixed bounded instructions and a schema response, and treats supplied text
as data. For songs it returns description, lyrics, title and changed. At 10 seconds, invalid JSON, unavailable model or a failed
rewrite check, use only the reviewed gentle template from music section 18.7 for an instrumental song; no original words go to
the engine. Pictures/videos may use a reviewed safe cartoon template only after their inspectors pass, otherwise redirect.
A model rewrite need not be deterministic; every acceptance check is. One gentle child message: "I made it a happy, not-too-scary Halloween song."
Other media use the same plain account of what was made. Never repeat blocked wording in that message.

Keep original words only in existing authorized chat storage. Store the checked rewrite as the job request. Check prompts,
lyrics, titles, actual sung transcript, final images and video frames before release. Failed or unreadable inspectors withhold.
A text matcher cannot inspect pixels. Minor songs remain off until transcription, child cartoon covers, quota and ownership
checks from music section 18 are complete. An adult with a chosen text filter also needs the as-sung check to uphold that filter;
this extends section 18.7's no-adult-transcription default only for filtered adults.

## LIKENESS-SIMPLIFY-01: remove the per-person agreement

This is its own migration slice, not an implication of adding the module. Current storage is in
`backend/src/db/schema.ts:1868`, `:1886`, `:1907`, created by `backend/src/db/migrations/0106_likeness.sql:1`, `:19`, `:33`.

| Remove or neutralize | Exact scope |
|---|---|
| Keys and setting side effects | Retire `likeness.adults`, `likeness.adult_content` in commons and `backend/src/settings/likenessKeys.ts`; remove write/reset hooks in `backend/src/lib/settings.ts:648`, `:751`, `:985`. Old writes return retired-key errors; old values cannot grant or deny access |
| Agreement records and revocation | Stop `LikenessConsent` writes/reads; remove `backend/src/lib/likeness/consent.ts`, `history.ts`, agreement-only `revoke.ts` behavior. Add a forward migration deleting settings values and dropping `likeness_consent_events` and `likeness_uses`; do not edit migration 0106 or retain hidden history |
| Notices and activity log | Remove `backend/src/lib/likeness/uses.ts` use recording, `likeness.used` in `backend/src/lib/notificationTypes.ts:69` and pending notices; remove consent/use payloads in `backend/src/routes/likeness.ts:32` |
| UI and API | Remove agreement switches, history, use log and polling in `frontend/src/apps/settings/LikenessSettings.tsx:12`, its tests, and obsolete calls/types in `frontend/src/lib/likenessApi.ts`; update `frontend/src/shell/pages/settings/settingsViews.tsx:92`. Keep family subject picker in `LooksLikePicker.tsx`, expand eligible household subjects; move the child limits group out of `person.likeness` (`personLimits.ts:4`) before retiring the group |
| Decision and queued work | Replace adult-requester, adult-subject and consent branches in `backend/src/lib/likeness/decide.ts:53`, `apply.ts`, `guard.ts`, `resolve.ts`, `importStyle.ts`; remove agreement wording and consent-dependent negative prompt logic. Jobs recheck household membership, option, requester policy and subject age at run/release; household option off withholds waiting jobs |
| Saved styles | Keep `likeness_adapters` subject binding as safety metadata, not agreement history. Remove agreement-only revocation state and deletion triggers in `adapters.ts`/`revoke.ts`; do not revive already deleted assets. Revalidate remaining styles against household identity and policy |

Keep `inspector.ts`, real-photo adult-content prohibition (`apply.ts`'s `PHOTO_ADULT_LINE`), absolute lines, surface limits,
finished-item checks, and subject identity binding. Adult content about a real person stays adults-only and may never involve
a minor. Household family content does not authorize outside people or public figures. Remove the old one-person-only restriction
where it exists only for agreement bookkeeping; every depicted household subject must still be resolved and checked.

Keep `backend/src/lib/likeness/proof.ts:37` signed proofs only if the Stack still needs a signed authorization boundary for
photo/style use. If retained, version the proof as household/policy authorization bound to subject, requester, asset and expiry,
not evidence of an agreement. Coordinate Stack validation before issuing it; old proofs cannot bypass new checks. If no consumer
needs it, remove proof minting and validation together. Unknown Stack support fails closed. Do not remove proof checks first.
Replace agreement tests in `likenessConsent.test.ts`, `likenessUse.test.ts`, `peoplePrompts.test.ts` and lane tests with household
on/off, minor-subject safety, queued-job, multiple-subject, unknown-identity and old-client cases. Shared record retirement is
spec-first; no imported backup or stale client may restore agreement-based permissions.

## Rollout, failures and verification

Resolve one policy snapshot per request, with its data version held through a streaming check. Recheck current settings and
membership at media job execution and release. A stricter change while waiting must apply. Flags above start off: run old and
new checks together without logging text; enforce the stricter result. Flip each consumer only after fixture parity and review.
Rollback keeps the new floors or closes the affected lane; it never restores weaker defaults. Delete old lists only after all
callers use the shared source and their regression tests pass. No shadow result can authorize release.

Order: 01, 02, 03, LIKENESS-SIMPLIFY-01, 04, 05. Work on the settings schema can start with 01; UI waits for consumers.
Songs depend on 01 and 03 plus MUSIC-GEN-22's as-sung path, and on likeness simplification for family subjects. Feature-specific
surface, quota, ownership, fetch, crisis and finished-output gates remain in their existing owners.

Required tests: fixed pass/block fixtures for every kind, field and band; teen mild/strong boundaries; adult opt-ins; minor
add-only changes; youngest shared audience; unknown identity or role; optional birthdates that only tighten; immutable snapshots; fixed line precedence; error injection
in resolution, fold and matchers. Include safe substrings and safe context. Exercise chunk splits, reasoning, speech, whole
answers, News sentences, retrieved rows/pages, answer images, route/tool/edit/regenerate paths, video frames, covers and sung transcripts.
Use the shared fold obfuscation corpus: case, accents, width, confusables, zero-width characters, spaced/punctuated forms,
masking, repeated letters, mixed scripts and age forms. Report only neutral fixture IDs and kind, never specimen words.

Performance acceptance: offline bench on the target runtime, fixed 4,000-character fixtures per kind/band, adversarial misses
included, both cold construction plus first check and warm checks under 50 ms each. Record machine class, runtime and data
version, worst time and distribution, with repeated runs. Unit tests assert deterministic identical results across repeated
calls and equivalent snapshots; timing stays in the bench lane. No claim that this target has been measured yet.

Audit only a registered typed event with `kind`, never prompt, lyric, title, transcript, URL, subject, person/record ID, hash,
match or policy line. No activity-to-person linkage in logs. Aggregate counts and timings carry no identity. Setting provenance
uses the existing protected settings store, not a new activity log. Storage or inspector errors block/withhold with a fixed safe
line; policy failure does not break the rest of the chat answer. Existing Repairs/readiness mechanisms report component failures.

All implementation slices need full `bash scripts/check.sh`, focused offline tests and independent minor-safety review; the
architect must rule before implementation. This docs-only change uses `bash scripts/check.sh --docs` and leaves code untouched.


## Slice 01 as built, 2026-10-18

`contentPolicy.ts` resolves immutable person filters and audience unions. The stricter actor or turn band wins.
Unknown identity or role uses the child floor. Known roles set the band; an optional birthdate may only tighten it. Teen defaults block strong profanity; adding that filter blocks
all listed profanity. Settings errors, invalid snapshots, bad policy data and invalid check inputs return the fixed fallback.
Checks use one folded copy with the commons detector and the existing wider minor floor. No input is cut short.

Version 1 JSON files own kinds, fixed lines, severity, terms, reviewed boundary exceptions and the existing lane and
Home-owned floor lists. The lane imports its lists from the module; its checks, cartoon rules, limits and results stay the same.
The shared floor gains an adapter for folded input; its existing entry points keep their behavior.

`createContentPolicyResolver` accepts a synchronous reader for an in-memory `content.filters` snapshot. The default resolver
has no added filters. The key is declared in `settings/contentKeys.ts` and listed ahead of spec, but is not in the live registry.
No new write path is enabled. Spec permissions, guardian writes, resets, imports and the Settings flow stay in slice 05.
The existing settings permission checks were read; this slice does not bypass them or grant rights based on adult status.
The injected reader validates and copies the added filters before any check runs.

The current picture audience has no present-person list or resolved subject context. The module accepts that audience with
an optional `present` list for union resolution. Its optional trusted subject-context reader captures a resolved household,
outside, public or unresolved subject decision; outside, public and unresolved subjects block before optional filters.
This reader must receive the existing identity decision and household option when consumers are wired. Text alone does not
identify real people, and the default reader makes no identity claim. No likeness code changed.

Offline tests cover every field and band, defaults, added filters, failure paths, runtime mutation, repeated calls, boundaries,
folding and a 4,000-character timing check. The timing check includes a match at the end of the input. Child and teen lane tests
and minor-line tests pass one file at a time without the standard port-opening preload. The picture safety file uses a stub
server and was not run under the no-port constraint. The full gate cannot take its lock outside this worktree in the current
sandbox. Independent safety review and the full gate remain release checks. Slices 02 to 05 remain open.


Changed files in slice 01:

- `.gitignore`, `CHANGELOG.md`, `docs/BACKLOG.md`, `docs/design/content-policy-2026-10-18.md`
- `backend/src/lib/contentPolicy.ts`, `backend/src/lib/pictures/lane.ts`, `backend/src/lib/pictures/minorLine.ts`
- `backend/src/lib/contentPolicy/data/kinds.v1.json`, `backend/src/lib/contentPolicy/data/terms.v1.json`,
  `backend/src/lib/contentPolicy/data/lanes.v1.json`, `backend/src/lib/contentPolicy/data/floors.v1.json`
- `backend/src/settings/contentKeys.ts`, `scripts/settings-ahead-of-spec.json`
- `backend/tests/contentPolicy.test.ts`, `backend/tests/fixtures/contentPolicy/corpus.json`,
  `backend/tests/fixtures/contentPolicy/boundaries.json`
