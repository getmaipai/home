# Companions revamp: the 2026-10-26 design handoff
> Status (2026-10-31): superseded in part by [ambient-companion-2026-10-27.md](ambient-companion-2026-10-27.md): the CompanionDock (RULES.md S2).

Status: proposed, design only; architect has not ruled. Owner row: COMPANIONS-REVAMP-01 in `docs/BACKLOG.md`.
Source: `MaiPai_Companions_Design_Handoff_2026-10-26.zip` (mockups and a handoff written for Jesse; not an audit of the code).
Jesse's answers through the wizard, 2026-10-26, are in section 6.

## 1. What the handoff is

A refinement of what exists plus a new "appearance drafts and publish" phase. Most of its phases 1 and 2 are built:

| Handoff item | State today |
|---|---|
| Stored speaker per assistant turn | Built: `answered_by {companion_id, name, look, via}` (ANSWERED-BY-01, schema 81). `look` is a 12-character hash, not a retained asset. |
| Switching in one chat | Built: `PATCH /api/conversations/:id {companion_id}` (COMP-04a), `@mention` for one turn (COMP-04b), header picker with faces. |
| Marker when the speaker changes | Built (SPEAKER-MARKER-HOME-01). Replaced by section 3. |
| Directory, profile, Activity and Tasks tabs | Built (COMPANIONS-APP-01, COMPANIONS-DETAIL-01, COMPANION-ACTIVITY-01); the layout is replaced by section 4. |
| Copy is a draft | Built (`X (copy)`, `status: draft`). Naming at publish is new. |
| State video player and Studio Look and States tabs | Built (CMEDIA-PLAYER-01, Studio). Real Wan clips in real browsers are not yet exercised (CMEDIA-BENCH-01). |
| Appearance versions, atomic Publish, "Review needed" | Not built. |
| Per-reply face, live character beside the reply, dock Review, "Try it" test chat | Not built. |

Dropped from the handoff: its hex color table (theme tokens only, owner rule 2026-10-19), and "instructions" under Advanced in Create
(a companion is not a model and grants no tools; shared-chat note section 2 and RULES.md rule 14).

## 2. Rules that do not move

Age and surface gates outrank everything: a child's picker, directory, Activity and Discover stay `companionFits`-filtered. Incognito or
temporary turns store no speaker and create no activity. A shared companion never exposes another person's chats on its profile (own rows only).
A companion grants no tools, memory access or spending. Kit Elements as shipped (rule 9): every new look below lands as a commons prop first.

## 3. The character beside the reply

Decided with Jesse, 2026-10-26.

1. Every assistant reply starts with a 28px round face and the companion's name. The face never carries a status colour.
2. For the reply being generated, that face slot is the **one live player**:
   - thinking clip while the reply is prepared, and while text streams in with no audio;
   - speaking clip only while speech audio actually plays (read aloud or voice mode); streaming text is not speaking;
   - on completion the slot freezes to the static portrait in full colour. No greyscale.
3. Every older reply is a static image. No video player is created for history.
4. The presence strip above the composer in the handoff is dropped; this slot replaces it. Reduced motion, a missing clip or a decode error show the static portrait plus the status text.
5. The speaker marker on change stays only as the divider rule: a divider appears when a turn uses a new speaker.
6. A pending switch never changes the in-flight turn's face, voice or instructions: the turn pins speaker, voice version and look version at start.
   Stream-start metadata names the pinned speaker before text arrives.

Needs a kit option on the commons `Thread` (per-reply face, live slot with clip or portrait). Rule 9c: commons first; Jesse said yes to a tag on 2026-10-26.
The option is an additive prop that replaces `speakerMarker` and draws the shipped `SpeakerIdentity` and `CompanionAvatar` Elements, no `className`.
The pinned speaker reaches the client as an additive `turn_meta` field. The corner `CompanionAvatar` (`ChatThreadExtras.tsx`) and the header idle loop
(`chatHeaderBar.tsx`) go still (static portrait, no player) so the reply slot is the only live player in the chat.

## 4. Directory, profile, tasks

Jesse: use the mockup. Left-aligned cards (64 to 72px portrait, one status, Chat and View profile), a compact profile header (96 to 112px), Activity first
grouped by date with Needs-you above routine items, and a Tasks list and detail (Needs you, Running, Completed) over existing jobs, projects and the `Ask`.
This **replaces** the round-character gallery and centered profile in [companions-dots-look-2026-10-25.md](companions-dots-look-2026-10-25.md)
(DOTS-GALLERY-01, DOTS-DETAIL-01, and DOTS-KIT-01's `CharacterHero` and `CharacterTile`; `CharacterHero` in the chat empty state goes with CHAT-WINDOWS-REVAMP-01). No new task system; Cancel and Review ride existing records. Portrait and header sizes come from kit props or variants, not `className`. "Header" here is the
profile header, not DOTS-CHAT-01's chat header. Each card's one status is the S6 Yours own-jobs line; Tasks shows each job's own card over existing records, own rows only.
"Chat" starts a new chat; "Continue" opens the existing one.

## 5. Voice and conversation mode

The conversation button opens a voice stage: the same character expands to 180 to 240px and follows real events only: idle, listening (mic accepting input),
thinking, speaking (audio playing), working (tool running), done (task completed). While the stage is open the reply-side slot is static, so there is one live player.
Waiting for approval is "Needs you", never working. Full duplex keeps mic indicators independent of the character state.
"Done" means the current turn's tool finished (turn state); a background job finishing is job status and shows on that job's own card.
Reuse check: the stage is `VoiceOrb` plus `CompanionAvatar`, with CHAR-01's `resolvePresence` and `PresenceState` as the single presence vocabulary and the `LauncherBubble` slots for the dock; nothing new is invented.

## 5a. Step 10 build (REVAMP-PRESENCE-01, design 2026-10-27, after the architect's ruling)

The architect approved step 10 with conditions. This is how each is met and where the build deliberately differs from the first sketch.

1. **One presence vocabulary, no second resolver.** Home already resolves presence on the client: `useCompanionSignals` and `useCompanionPresence` (`frontend/src/apps/chat`) turn the running turn, speech, dictation, voice and job events into the `wanted` flags and one-shot states the kit `CompanionAvatar` machine plays
   (needs_you, speaking, working, thinking, listening, sleeping), which are the shipped `PresenceState` values the avatar uses. The voice stage reuses that hook as it is. CHAR-01's core `resolvePresence()` and the backend `presence` event (the robot and Go parity work) are NOT built here;
   when CHAR-01 lands it replaces the internals of that one hook and nothing in the stage or dock changes. No second resolver is written.
2. **The stage is a kit slot, not a Home component.** Commons gets two additive pieces: `CompanionAvatar size="xl"` (about 208px, inside the 180 to 240px the mockup asks for) and an optional `stage` slot on `VoiceConversation` that replaces the orb when the host supplies the character.
   Home passes the shipped `CompanionAvatar` from `useCompanionPresence` into that slot; the stage follows real events only. While the voice stage is open the reply-side face is static (one live player).
3. **The dock is a new kit Element, `CompanionDock`, not an extended `LauncherBubble`.** `LauncherBubble` is a chat launcher that opens a panel (hard-coded message icon, 304 px panel, reply-time copy, no Escape or outside click, no phone sheet), and `assistant-modal` does not exist; the mockup's dock is a small card
   (face, name, one line, one action, minimize, close) that opens no panel. A new Element with those slots and the dismissal is the smaller, honest change, and `LauncherBubble` stays as it is. Inside it the character shows only the idle still, greeting and sleeping looks (no working or asking expression, no `AvatarBadge`, no `AgentStatus`, no count or dot: RULES.md S2).
4. **Review reads data the shell already gets, with no new poller (S6).** The dock asks for the companion's own activity rows (`GET /api/companions/{id}/activity`, own rows only, rule 6a) with a plain query that refetches on focus and navigation, never on a timer; it shows the Review button only while one of the viewer's own rows needs them (`needs_you`),
   and the button opens that task in the companion's Tasks tab. When a parent answers a child's Ask the row stops needing them, the button disappears and nothing replaces it. A child-band session shows no working or asking expression.
5. **The person can turn it off (S2): a spec person setting.** `companions.dock` (boolean, default on, person scope) in `commons/spec`, placed in the companions settings card, with the copy the settings registry requires; the dock's close button writes it. The dock is hidden on Chat routes (the character is drawn once) and when companions are off for the person.
   This needs one spec tag (`spec-v0.1.246`) and a pin.
6. The owed open part of COMPANIONS-PRESENCE-01 moves here: the shell-level mount (beside `ShellInstallStrip`, stacked clear of `InstallDock`), the hide setting, the launcher hidden on Chat routes, the corner avatar unchanged in Chat (it is the reply-side face now). The `launcher-bubble` and `assistant-modal` claim in `docs/design/ELEMENTS-DECISIONS.md` (lines 84 to 87) moves to REVAMP-PRESENCE-01 as "not needed: `CompanionDock`".
7. The thinking clip in the reply face replaces CHAR-01's "working dot at the reply tail" in the chat column (the dot is not built); the voice orb stays the only other chat-column mark and is replaced by the character only inside the voice stage.
8. Build order: spec setting and tag, kit pieces and tag (parallel), then Home (pins, adoption verdicts, shell mount, stage wiring, tests). Not shipped without Jesse's word.

## 6. Decisions (Jesse, 2026-10-26)

1. Face on every reply (reverses the marker-only choice in shared-chat section 3).
2. Gallery and profile follow the handoff mockup, not the dots look.
3. The outside-chat dock may show one Review button when a task needs the person, as in the mockup. This edits RULES.md S2 (the launcher "carries no count or status" gets this one exception) and adds one S6 table row (same job and Ask records, own rows only, no new polling). Landed with `Owner-approved: 2026-10-26`; Jesse also approved every rule change needed to match the mockup.
4. Each reply's portrait is kept permanently: a small still stored per look version, referenced by id from `answered_by`. This **reverses** shared-chat decision 13.6 (removed companion keeps a name only).
5. Streaming text keeps the thinking clip; the finished face is full colour ("whatever ChatGPT would do").
6. Companion art follows the household Quick and Detailed picture and video settings (section 7).
7. A new commons tag for the Thread option and dock slots: yes.

## 7. Companion art uses the right model

Audit, 2026-10-26: companion stills hardcode `flux2-klein-4b` (`backend/src/lib/companionLookJobs.ts:90`, `QUICK_MODEL`), ignoring `generation.picture_quick_model`,
ERNIE and Detailed. Clips (`companionTakes.ts`, `submitVideo`) send no model, so the Stack default runs and `generation.video_quality` is ignored.
No look version or take records which model made it.

Rule: companion art follows the household settings, resolved at job time through one resolver.

| Job | Model |
|---|---|
| Portrait and start-frame candidates | `chooseQuality`: Quick is ERNIE-Image-Turbo where installed, otherwise the Stack's Klein; Detailed is Z-Image-Turbo |
| Edits and sheet views | Klein (the bakeoff's edit pick) |
| State clips | `chooseVideoQuality`, restricted to models that can start from a picture. Today only Wan2.2 TI2V-5B FastWan; LTX-2.3 Detailed counts once the Stack reports `qualities.detailed.image_to_video` |

Always send `model` explicitly. If the chosen model is not installed, stop with a plain line naming what to install; no silent downgrade, no Stack default.
Write `{model, version or digest, prompt hash, seed}` on every look version and take, and read the reported model back from the Stack job and fail on a mismatch.
Tests: every companion submit path sends an explicit model; a grep test fails on `QUICK_MODEL` in `companion*.ts`; ERNIE absent means refusal; records hold the model.
Settings, AI and models shows what companion art uses. Verify ERNIE is installed on the live hub (only the Studio bakeoff install is evidenced).

## 8. Anime models and LoRAs (research, 2026-10-26, unproven until benched)

- Stills: no dedicated anime checkpoint. Illustrious, NoobAI and Animagine are SDXL based (separate runtime) and mostly poor licences (Animagine XL 4.0 OpenRAIL++-M is the one commercial-friendly option, weaker on characters). Mascots are not Danbooru anime. Use ERNIE, Z-Image and Klein with a style prompt.
- Video: no fitting anime video model. Stay on Wan2.2 5B; the approved rest picture as frame 0 limits style drift. Wan2.2 I2V-A14B is the quality fallback (slow). Wan-Alpha++ gives real alpha but is CUDA only and unproven on 2D art.
- LoRA: a shared cel-shaded style LoRA only if the bench shows drift; a per-character LoRA only as a later optional upgrade. SDXL anime LoRAs do not load into our models; train on the chosen base (Z-Image: train on Base, use on Turbo).
- Alpha: flat key colour away from the character's palette plus chroma key is the reliable path.
- Open: no independent anime comparison of ERNIE, Z-Image and Klein; Qwen-Image-Edit-2511 licence conflicts between its card and the bakeoff note; LoRA training time on our hardware unmeasured.
- Bench (COMPANIONS-ART-BENCH-01): 10 mascot prompts (5 animals, 3 anime humanoids, 2 robots) on Klein, ERNIE, Z-Image with no style prompt, a style prompt, and a style prompt plus LoRA; 3 edit views per character; 6 states by 5 characters by 3 seeds on Wan. Pass: 8 of 10 clean single characters, 80 percent same-character on edit views, palette and outline hold over the clip, loop seam under threshold, under 1 percent key fringe.

## 8a. Appearance drafts and Publish (REVAMP-APPEARANCE-01, design 2026-10-27, revised after the architect's ruling)

Research of the code (2026-10-27) found: approving a state clip copies it into the live `animation/` folder and rewrites the live manifest `companion.animation` in the same request
(`routes/companions.ts` approve route), unapprove and `clearStateApprovals` delete it, and nothing else writes the live folder. `states/<state>/<take>/` and `look/` are already the working store.
So the draft is the existing store, the published copy is the existing `animation/` plus the manifest field, and no second store is added (principles 1 and 6).

1. **Approve and unapprove touch the draft only.** They keep today's checks (take report present, quality `force`, idle first) and stop writing `animation/` and the manifest.
2. **Publish** (`POST /api/companions/{id}/appearance/publish`, author or admin, same access as the states routes): requires the sheet approved and idle approved, and refuses while `companionHasFinishingJob(id)` is true.
   It builds the whole `animation` tree (rest.png, card.json, every approved state's h264/av1/still) in a sibling temp folder, then swaps it in: the old folder is kept until the new one and the manifest write both succeed, a failure restores it, and startup recovers an interrupted swap.
   It records the `published` map (state to take id), who published and when, on the states record (provenance, principle 3).
3. **The finished-item age check runs on everything Publish makes live (rules 0 and 10).** Home already ships it: `pictures/ageCheck.ts` (`checkImages`, `decideAgeCheck`, IMGGEN-SAFE-01), used for picture jobs, video keyframes, edits, uploads and when a picture is widened to all ages.
   Companion art skips it today (the look job sends `audience: "all-ages"` straight to generation, uploads and takes are never checked after rendering). That is a gap, not a license: rule 0 names companion media, and rule 10 says a check that cannot run on a CSAM candidate fails closed.
   Publish therefore runs `checkImages` on rest.png, the sheet views, and each published state's still and clip keyframes (the same way `videos/jobs.ts` does), uploaded and generated assets alike.
   - The decision is `decideForLane` (`pictures/laneGate.ts`) with the strictest band the companion's audience reaches: `all` as child, `teen` as teen, `adult` as adult. For an `all` companion Publish also runs `checkChildSafety` (the cartoon and child-safety question) on the same images,
     so the art reaches children with the same finished-item check a child's own picture gets (rule 0: "retain their age-based content filters and finished-item checks"). `adultOnly` comes from the declared audience, not from a prompt (an uploaded clip has none).
   - A withheld or unrunnable result blocks Publish and is listed in `reasons`; the child and teen bands and adult-only jobs fail closed through `decideAgeCheck` as they already do.
   - The raw checks (the age check and the child-safety answers) are cached per take or asset hash on the draft record, keeping only checks that ran; a check that could not run is never cached, and the band decision is made fresh at each Publish and at each audience widening.
   - Widening a published companion's audience (adult to teen or all) re-checks the published set at the new band and blocks the change on a withheld or unrunnable result.
   This wires a component that already ships; it adds no new screening and needs no rule change. The backlog row VIDEO-GEN-12 (post-render check) lags the code on this point, since video keyframes are already checked; it is not edited here because it carries an open owner question.
4. **Review needed** is computed, not stored: the draft differs from the published map (a different take, a newly approved or unapproved state, a changed portrait). The appearance read returns `has_changes`, per-state `assigned`, `published` and `changed`, and `reasons` when Publish is not possible.
   It shows only in the studio and the record: no badge on directory cards or the launcher (RULES.md S2 and S6).
5. **Backfill:** a companion that has a live `animation` but no `published` map treats the current manifest as published, so no existing companion shows Review needed.
6. A change to the rest picture, card or key clears the draft approvals as today but leaves the live animation in place until the next Publish; the studio says "Changes stay in draft until published."
7. **Reuse check (principle 6):** the look store (CMEDIA-LOOK-01), the approval step (CMEDIA-STATES-03), the sheet record and `pictures/ageCheck.ts` are kept and reused. This slice absorbs CMEDIA-REVIEW-01's per-state review screen only; its package-signing half stays with package companions (unchanged, still open there).
   CMEDIA-EDITOR-05 (the audience review and the "suitable for children" checklist for the `all` audience, with who and when stored, design 12.5) is NOT absorbed: it stays open as its own row, and Publish's age check is independent of it.
8. Tests that assumed approval is live (`routes/companions.test.ts`: state upload and approval, approval requires force and idle, sheet approve/unapprove and rest change) are rewritten to assert the draft/publish split, plus: Publish blocked by a withheld or unrunnable check, atomic swap failure leaves the old animation, backfill, and audience widening re-check.
   The avatar and animation-file tests keep working because the live manifest field and folder stay the published store.
9. **Studio UI (slice 8b, after 8a)** follows `mockups/studio.png`. Reuse per region: the state list is the kit `List` (as the page uses today for About rows) with kit `Badge` status (Assigned, Selected, Optional); the stage is the kit `CompanionAvatar` player Element as shipped (not Home's temporary `StackedAlphaPreview`, CMEDIA-PLAYER-02) with the kit `Button` for Test state and Upload clip;
   "Choose a start image" candidates are the existing `CharacterTile`/picture cards of the Look tab; the right rail is kit `Card`s: character reference (the rest picture, kit `Avatar`), clip checks drawn from the take's real `report` (kit `Status`/list, never invented checks), and recent generation as that job's own card (S6, no new list or status).
   No `className` overrides and no Home wrappers (rule 9); any look the kit cannot reach becomes a commons prop first. The header carries "Publish appearance" (kit `Button`).

## 9. Build order and rows

1. COMPANION-ART-MODEL-01 (Codex): section 7. First, small, fixes a real defect.
2. COMPANIONS-REVAMP-01 design note architect ruling (2026-10-26: steps 3 to 7 and the bench approved; 8 and 9 needed the reuse checks added below; 10 needed the S2 and S6 edit), then the S2 and S6 rules commit (dock Review).
3. Spec first: retained portrait per look version; `voice_version` and `look_version_id` in `answered_by` (new row under COMP-04a).
4. Commons `Thread` option: per-reply face and live slot (REVAMP-FACE-01); then Home uses it.
5. Picker polish: search, "X will answer next", explicit standard-assistant entry, unsent text survives (REVAMP-PICKER-01).
6. Retry with the original speaker; "Retry with current companion" (REVAMP-RETRY-01; turn path, code review at medium).
7. Directory, profile and Tasks in the mockup layout (REVAMP-DIRECTORY-01, REVAMP-TASKS-01).
8. Appearance drafts, atomic Publish, "Review needed", with CMEDIA-BENCH-01 and the codec matrix (REVAMP-APPEARANCE-01). Reuse check: drafts live on the existing look store (CMEDIA-LOOK-01) and its approval step (CMEDIA-STATES-03), with the `status` and `review` fields of CMEDIA-SPEC-01;
   this slice absorbs the per-state review screen of CMEDIA-REVIEW-01 (not CMEDIA-EDITOR-05, see section 8a.7). "Review needed" stays on the draft's own record and editor. Publish runs the finished-item age check on everything it makes live and fails closed (rules 0 and 10, section 8a.3).
9. "Try it" test chat and state tester in the wizard (REVAMP-TRYIT-01). Reuse check: "Try it" is the chat Thread in temporary mode with the draft pinned (no stored speaker, no activity, author only, still `companionFits`-gated);
   the state tester is the `CompanionAvatar` Element as shipped.
10. Voice stage and dock with Review, after the commons tag (REVAMP-PRESENCE-01, supersedes the open part of COMPANIONS-PRESENCE-01).
11. COMPANIONS-ART-BENCH-01 any time on the Studio.

## 10. Open items for Jesse

Rivet is described as a small robot but the mockup portrait is human. Fix the art or the description before it ships. Everything else is decided above.

## 11. Supersedes

Shared-chat note section 3 (marker only on change) and decision 13.6; the dots-look gallery, detail and header decisions, and DOTS-KIT-01's `CharacterHero`/`CharacterTile`;
CHAR-01's clause "no separate character mark appears in the chat column"; the open part of COMPANIONS-PRESENCE-01; the per-state review screen of CMEDIA-REVIEW-01 (absorbed by REVAMP-APPEARANCE-01; its package-signing half and CMEDIA-EDITOR-05 stay open);
the presence strip idea in the handoff.
