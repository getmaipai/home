# Companions revamp: the 2026-10-26 design handoff

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

## 4. Directory, profile, tasks

Jesse: use the mockup. Left-aligned cards (64 to 72px portrait, one status, Chat and View profile), a compact profile header (96 to 112px), Activity first
grouped by date with Needs-you above routine items, and a Tasks list and detail (Needs you, Running, Completed) over existing jobs, projects and the `Ask`.
This **replaces** the round-character gallery and centered profile in [companions-dots-look-2026-10-25.md](companions-dots-look-2026-10-25.md)
(DOTS-GALLERY-01, DOTS-DETAIL-01, and probably DOTS-KIT-01's `CharacterHero` and `CharacterTile`). No new task system; Cancel and Review ride existing records.
"Chat" starts a new chat; "Continue" opens the existing one.

## 5. Voice and conversation mode

The conversation button opens a voice stage: the same character expands to 180 to 240px and follows real events only: idle, listening (mic accepting input),
thinking, speaking (audio playing), working (tool running), done (task completed). While the stage is open the reply-side slot is static, so there is one live player.
Waiting for approval is "Needs you", never working. Full duplex keeps mic indicators independent of the character state.

## 6. Decisions (Jesse, 2026-10-26)

1. Face on every reply (reverses the marker-only choice in shared-chat section 3).
2. Gallery and profile follow the handoff mockup, not the dots look.
3. The outside-chat dock may show one Review button when a task needs the person, as in the mockup. This edits RULES.md S6 (S2 already allows a status-free launcher since 2026-10-24); the rules commit carries `Owner-approved: 2026-10-26`.
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

## 9. Build order and rows

1. COMPANION-ART-MODEL-01 (Codex): section 7. First, small, fixes a real defect.
2. COMPANIONS-REVAMP-01 design note architect ruling, then Jesse's S6 edit commit (dock Review).
3. Spec first: retained portrait per look version; `voice_version` and `look_version_id` in `answered_by` (new row under COMP-04a).
4. Commons `Thread` option: per-reply face and live slot (REVAMP-FACE-01); then Home uses it.
5. Picker polish: search, "X will answer next", explicit standard-assistant entry, unsent text survives (REVAMP-PICKER-01).
6. Retry with the original speaker; "Retry with current companion" (REVAMP-RETRY-01; turn path, code review at medium).
7. Directory, profile and Tasks in the mockup layout (REVAMP-DIRECTORY-01, REVAMP-TASKS-01).
8. Appearance drafts, atomic Publish, "Review needed", with CMEDIA-BENCH-01 and the codec matrix (REVAMP-APPEARANCE-01).
9. "Try it" test chat and state tester in the wizard (REVAMP-TRYIT-01).
10. Voice stage and dock with Review, after the commons tag (REVAMP-PRESENCE-01, supersedes the open part of COMPANIONS-PRESENCE-01).
11. COMPANIONS-ART-BENCH-01 any time on the Studio.

## 10. Open items for Jesse

Rivet is described as a small robot but the mockup portrait is human. Fix the art or the description before it ships. Everything else is decided above.

## 11. Supersedes

Shared-chat note section 3 (marker only on change) and decision 13.6; the dots-look gallery, detail and header decisions; the presence strip idea in the handoff.
