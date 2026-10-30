# Resource tiers: Standard, Boost and Max for every generating feature (2026-10-27)

Status: decided 2026-10-27, not built. Item id RESOURCE-TIERS-2026-10-27. Jesse answered the open questions in chat the same day (names, Reduced,
no switches, teens, children in Reduced) and accepted the recommendations on the lease, idle-time and yield-point rules ("I agree with your
suggestions"). Rows are in `docs/BACKLOG.md` ("Resource tiers"). Every model row carries a confidence mark; rows marked unverified or "to verify" are
filled in by the evaluations of section 14, not by this note. Design only: no code is written.

Owner's ask (Jesse, 2026-10-27): one app-wide pattern for chat, pictures, video, music and future features such as stem splitting. Three levels
each: a day-to-day model that leaves the machine free for everything else; a stronger one that may make other work queue or pause; and a max one
that queues or disables nearly everything else. Everyone gets the first two. The third belongs to people an admin assigns, and always to admins.
It must adapt to the hardware class (start with the 128 GB M5 Max Studio), plug into the queue, the messages people see and tool disabling, and
admins must reach it from inside the tools they are already using, not from Settings.

It extends [memory-management-2026-10-25.md](memory-management-2026-10-25.md) (classes, queue rules Q1 to Q8, card copy),
[coding-mode-2026-10-22.md](coding-mode-2026-10-22.md) (the one-occupant switch), the Quick and Detailed picture, video and song pairs
([image-model-bakeoff-2026-10-25.md](image-model-bakeoff-2026-10-25.md), [video-generation-2026-10-17.md](video-generation-2026-10-17.md) section 14,
[music-generation-2026-10-17.md](music-generation-2026-10-17.md) section 16) and the grants model (`commons/spec/vocab/grant-actions.json`).

## 1. Answer

1. **A tier is a promise about the rest of the computer, not a quality label.** The three tiers are defined by what they do to everyone else, and
   each hardware class gets the best measured model that keeps that promise.
2. **The ladder: Reduced, Standard, Boost, Max (owner, 2026-10-27).** Reduced is applied by the system only. You pick Standard, Boost or Max.
   Standard runs beside everything. Boost may make other big jobs wait. Max takes the machine. (Alternatives in
   section 3.)
3. **No switches. Max is a lease, and coding mode goes away (owner, 2026-10-27).** Today `coding.home_mode` switches the whole household into one
   occupant. In this design nobody flips a mode: picking Max on a thread, a card or a coding client's request takes a lease on the machine, and the
   lease ends by itself when the work is done and nothing is in flight. `coding.home_mode` is retired once chat Max works (section 7, T6).
4. **Access is one grant, `tier.max`.** Admins always hold it, an admin can assign it to any adult (a teen's grant reaches only the teen picture lane;
   a minor's chat and video stay Standard under RULES.md rule 8), and everyone else never sees a Max control. Age and surface gates run first and are never loosened by a tier.
5. **Admins meet it inside the tool.** A Max choice sits on the control they already use: the composer's model chip, the Standard, Boost, Max
   segment on every picture, video and song card, and "Make it Max" on a finished result. Settings only holds the defaults and the assignments.
6. **No new queue.** Max adds one rule set (a window with drain, hold and release) on top of Q1 to Q8, and the same job card, busy line and Status
   row carry every state.

## 2. The three contracts (p128 numbers; section 4 derives them for other machines)

Room for jobs on the Studio, from the memory note: budget 116.8 GB, reserved about 36 GB (chat, judge, embed, voice), margin 20 GB, so about 72 GB
for jobs with nothing else loaded. The picture pool rests at 15.8 GB.

| | Standard (A) | Boost (B) | Max (C) |
|---|---|---|---|
| Promise | "Home keeps working normally while this runs." | "Home stays up, but other big jobs wait their turn." | "This takes the computer. Everything big waits." |
| Peak memory cap (p128) | up to 45 GB: fits beside chat, voice and the resting picture pool with the 20 GB margin intact | up to 60 GB: fits only after idle warm models are put away | up to 72 GB for a job (all the room); or the whole 85 to 100 GB for a chat model that replaces the resident one |
| Typical wait the person accepts | seconds to about 3 minutes | up to about 10 minutes | up to 30 minutes, with a stated estimate before it starts |
| Evicts idle warm models | never | yes, in the section 4.3 order of the memory note | yes, all warm and burst items; reserved stays unless the job is a chat occupant |
| Other heavy jobs while it runs | run if they fit (A with A) | queue (one Boost or Max at a time) | held: nothing else starts; running jobs finish first (drain) |
| Chat and voice | unaffected | unaffected (the heavy gate pauses the job while a turn is in flight) | unaffected for a generator Max (the job pauses during turns); replaced by the big model for a chat Max |
| Optional tools meanwhile | all on | image tools and vision may wait (they queue with a reason) | every generating and tool job queues with the reason "Max job"; chat, voice, lists and reminders stay on |
| Who can pick it | everyone the age and surface gates allow | everyone the gates allow | admins, and people holding `tier.max` |
| Default pick | yes, always | only when the person (or the model, for "make it great") asks | never automatic |

Why caps and not a fixed list of models: a tier is the ceiling a model must fit under on this machine. A model that fits A on a bigger machine
may only reach B on a smaller one (section 4).

## 2a. Reduced: what everything else becomes while Max runs (owner idea, 2026-10-27)

**Reduced is a fourth state that only the system applies.** Nobody picks it, no control shows it as a choice, and it is not in the tier picker. It is
what a category falls back to so a Max job can have more of the computer, and it ends when the Max job ends.

Why it matters: with the standard chat model resident (about 36 GB reserved), a Max job has 72 GB. If chat drops to a small model, the reserved
set shrinks to about 10 to 12 GB and a Max job can have about 95 GB on the Studio. That is the difference between the 60 to 72 GB Max candidates
and the 80 GB ones (Wan2.2 A14B's card asks 80 GB; a 120B chat model needs 62 to 85 GB). Without Reduced, Max is capped by chat's footprint.

| | Without Reduced | With Reduced |
|---|---|---|
| Chat during a generator Max job | the standard chat model stays (full quality, the job pauses during each turn) | a small, quick model answers (simple and limited), the job is not paused for it |
| Room for a Max job on the Studio | about 72 GB | about 95 GB |
| Cost | none | a model swap before and after (20 to 60 s), a plainer chat for the length of the job |

Rules:

1. **Engaged only when the job needs it.** Reduced is used only when the Max job's measured peak does not fit beside the standard set. A Max job
   that fits in 72 GB leaves chat alone. The confirm line on the Max control says which case it is (section 9), so an admin chooses knowingly.
2. **System-applied, never manual.** The engine is Home's, set by the Max window (T3). There is no Reduced button, no setting that turns a category to
   Reduced, and a person cannot stay in Reduced by choice. An admin can only switch the whole feature off ("Max jobs never reduce chat"), in which case a
   Max job that needs more room than the standard set leaves is not offered.
3. **What Reduced is, per category.** Each category lists an optional Reduced slot. Chat: the small model the Stack already knows as its `light` profile,
   Qwen3-4B for chat, judge and router (STACK-LIGHT-PROFILE-01), full context window so chat rule 4 holds. An adult in Reduced gets whatever the small model's catalog record proves it supports (RULES.md
   rule 8: every model gets every feature its template is proven to support); the no-tools, thinking-off fail-safe is for minors only. Voice (speech to text and text to speech) stays as it is unless a Max job still lacks the last ~6 GB; then only the speaking side
   drops to Pocket TTS between utterances (section 5.6). A spoken turn is never queued. Embeddings stay. Pictures, video, music, stems: no Reduced model; they queue with the reason `max_window`, as in section 10. A category
   with no Reduced slot simply waits.
4. **Customizable like every slot** (section 3a): the Reduced model for chat is an admin-pickable catalog candidate under the same peak rule (small),
   with `recommended` as the default. It cannot be turned on for a person, only used by the system.
5. **Children and teens.** Their band floors hold in Reduced as everywhere. A model with no measured record keeps the no-tools fail-safe for
   minors (rule 8), so for a child or teen chat on the small model runs with thinking off and no tools (owner, 2026-10-27, decision 4). Age and
   surface gates still run first. This is the only place the fail-safe cuts features.
6. **The swap is announced, not surprising.** Starting a Max job that needs Reduced: wait for any chat turn in flight to finish, then swap with the
   existing chat "starting" state (`cause: "mode_change"`), not an error. The steady state is a new reason, `tier_reduced`, fed through
   `roleHealth` and `healthSnapshot` to the composer line exactly as `mode_change` is (rule S6: no new surface, banner or poll). Every signed-in
   person sees one line under the chat input for the job's length: "Chat is simpler while a big job runs (about 12 minutes). Answers are shorter and some extras may be paused." Going back is the reverse and
   waits for in-flight turns the same way. The Max job restarts from the beginning only in the watchdog case of T5.
7. **Pressure ladder reuse.** The Stack's watchdog today restarts chat and evicts the judge at CRITICAL. Falling to Reduced is a gentler first step on the
   same ladder (a candidate, not part of this note's scope).
8. **To measure before it ships:** the swap time on the Studio (the 4B is already resident as the judge in the standard profile, so it may be
   near zero), whether the Max job needs to pause at all for Reduced chat turns (the heavy gate pauses for chat today), and how plain Qwen3-4B
   chat feels to the household. If Reduced chat is judged too poor, Reduced stays off and Max stays at 72 GB.

## 3. Names

Recommended: **Standard, Boost, Max.** They say what the machine feels like, not how good the picture is, they are one word each, and "Max" is the
word people already expect for the top setting. They replace "Quick" and "Detailed" in person-facing copy: Quick maps to Standard, Detailed to Boost
(section 5). Alternatives, if the owner prefers a different feel:

| Set | A | B | C | Note |
|---|---|---|---|---|
| Recommended | Standard | Boost | Max | Matches the resource promise |
| Plain speed | Quick | Better | Best | Keeps Quick, but "Best" invites everyone to pick it |
| Studio | Lite | Pro | Studio | Sounds like a product plan, not a machine state |
| Honest | Light | Heavy | Whole computer | Longest, clearest on the cost |

The model names stay under Details, as today (video note section 14.1).

**Borrowing the chat apps' vocabulary (owner idea, 2026-10-27).** ChatGPT's picker (GPT-5.5 help page) offers Instant, Thinking and Pro, with a
separate thinking-effort setting under Thinking and Pro; Pro is limited to higher plans, the same shape as our assigned Max. Claude's apps call
the reasoning dial "effort". Two lessons, neither read as a requirement:

1. **Keep two axes apart.** Our tier says how much of the computer a job may take. Reasoning effort says how long a chat model thinks. They are
   different dials. Each chat tier carries a default effort (Standard short, Boost longer, Max longest) but the effort stays its own per-turn
   setting, as `--reasoning-budget` already is.
2. **Use the same three words everywhere, with a one-line verb per category** so the names still read naturally outside chat. Chat: Standard
   "Fast", Boost "Thinks longer", Max "Deepest". Pictures: "Fast", "More detail", "Best quality". Video: "Quick clip", "With sound", "Best
   quality". Music: "Quick", "Full song", "Studio quality". The tier word is the control; the verb is the hint under it.

Chat-only alternative if you prefer the chat apps' own words there: Instant, Thinking, Max. It breaks the app-wide pattern ("Thinking video"
makes no sense), so it is not recommended.

## 3a. Admins customize every slot (owner, 2026-10-27)

Each category and tier is one slot (chat Standard, pictures Boost, video Max, and so on). A slot ships with a recommended model and an admin can
change it, as the Quick and Detailed rows allow today (AI & models page: a radio choice and a gear dialog per row,
[ai-models-glance-2026-10-26.md](ai-models-glance-2026-10-26.md)). One record per slot, `engines.<role>.tier.<standard|boost|max>`, with values
`recommended` (default, follows catalog updates), a catalog candidate id (pinned until the admin resets it) or `off`. The existing
`generation.picture_quick_model`, `generation.picture_detailed.enabled` and `engines.<role>.choice` map into it by migration.

Rules for a custom pick:

1. **The tier cap is the contract, so it is the only limit.** A model must have a measured peak at or under its slot's cap
   (45, 60 or 72 GB on p128). The gear dialog lists only candidates that fit, and a bigger one is refused in plain words: "This needs 62 GB.
   Standard keeps Home free, so it can't hold it. Use Boost or Max." The Max slot accepts anything the machine can ever fit (`fits_ever`).
   Nothing stops an admin putting a small model in Boost or Max; the dialog notes it ("Same as Standard, so Boost will be hidden").
2. **The governor still enforces behaviour from the model's measured peak,** never from the label, so a custom pick cannot make an Standard job
   take the machine. The dialog shows the consequence before saving: memory, typical time, and "Behaves like: runs beside everything".
3. **Only catalog candidates.** "Any model" means any model the Stack has pinned, hashed and tested (RULES.md rule 11), including ones an admin
   chooses to download from the catalog (size, licence accept and the memory bar are shown, as in AI & models). Bringing a model from outside
   the catalog is a separate vetting path and is out of this note.
4. **Per slot switches.** Each slot can be turned `off` (the model stays installed, requests fall back one tier with a note, as `detailed_off`
   does today) and has a "Who can use it" choice: everyone the age gates allow (Standard and Boost default), assigned people only, or admins
   only (Max default; it is the `tier.max` grant). An admin may narrow Boost to assigned people; nobody may widen Max past the grant.
5. **Reset.** "Use the recommended model" returns the slot to `recommended`. After a catalog update, a pinned custom pick is kept and the page
   says a newer recommendation exists.
6. **Per machine class.** The record is per hub, and the offered candidates come from the resolver for this hardware class (section 4).
7. **An on/off switch for every mode in every category (owner, 2026-10-27).** The AI & models page shows, per category, one switch per slot:
   Reduced, Standard, Boost, Max. A slot's `off` value (section 11) is the switch, so there is one definition. Examples: turn off Max video; turn
   off Reduced chat. What each switch does:

   | Switch | When it is off |
   |---|---|
   | Standard | Cannot be off while the category is on (it is the floor). Turning it off is the existing whole-category switch (for example video off) |
   | Boost | The control is hidden. A request for Boost is made at Standard with a note, as `detailed_off` does today. Queued Boost jobs not yet started are converted the same way; a running job finishes |
   | Max | The control is hidden for everyone including admins, and no lease or window can start for this category. A Max job already running finishes; queued ones not yet started are made at Boost with a note. Re-enabling restores it. The `tier.max` grants stay recorded |
   | Reduced | The system never lowers this category for a Max job. Labelled in plain words for the admin: "Let big jobs simplify chat". Effect: a Max job that needs more room than the rest leaves is not offered, so the Max cap in section 4 falls back to the figure without Reduced (about 72 GB). A Max slot whose pick no longer fits is hidden with the reason ("Max video needs 80 GB; with chat unchanged this computer has 72 GB") |

   The dialog shows these consequences before a change is saved. Disabling a slot never deletes a model or a person's grant, and never cancels work
   in progress (T4 to T7).
   Defaults on p128: Standard on; Boost on; Max on for categories with a proven Max; Reduced on for chat once its bench passes (2a rule 8), off for
   voice and for every category without a Reduced model.

## 4. Dynamic per hardware class

Each tier's cap is a fraction of the governor's own room figure, not a fixed GB, so it follows the machine the Stack already measures
(`GovernorRules`, profiles `p16`, `p32`, `p64`, `p128`; hardware-tiers plan "proposed, never fixed").

- Let R = the room for jobs (the smaller of budget minus reserved, and total minus reserved minus margin). On p128 R is about 72 GB.
- Standard cap = R minus the resting warm pool minus a margin for one more small job: about 0.6 R (45 GB).
- Boost cap = 0.85 R (60 GB). Max cap = R (72 GB), or R plus what Reduced frees (about 95 GB on the Studio) when Reduced is allowed (section 2a).
- Per category and hardware profile, the catalog lists measured candidates in order. A tier resolves to the best candidate whose measured peak is
  at or under that tier's cap. If none fits, the tier is not offered on that machine and the control hides it (never greys it with a number).
- Tiers collapse downward. A tier that resolves to the same model as the one below it is hidden, so a family never sees Boost and Standard that do
  the same thing.

| Class | R (approx) | What resolves |
|---|---|---|
| p16 | 4 GB | Standard chat only; no video or music; pictures off or smallest model. No Boost, no Max |
| p32 | 12 GB | Standard for chat, pictures, voice; Boost only for pictures (single smaller upgrade); no video |
| p64 | 24 GB | Standard and Boost for chat and pictures; music Standard only (quick, 120 s); video off (owner, 2026-10-17); Max for chat only if a model fits |
| p128 (Studio) | 72 GB | All three tiers for every category in section 5 |
| p256 and up (future) | about 190 GB | Max candidates grow (bigger chat, A14B video); Standard and Boost caps may move up so Boost no longer needs eviction |

The resolution is a pure function of the catalog and the probe, evaluated at boot and when the allocation changes. Nothing branches on a tier in
turn code (hardware-tiers plan principle).

## 5. Proposals per category (p128)

Confidence: **measured** (our numbers in a repo note), **claimed** (a model card or vendor number, not run here), **to verify** (not yet checked).
Every pick must also pass the model vetting and licence read before it ships (RULES.md rule 11, org licensing doc).

### 5.1 Chat

Chat is the reserved class: the resident model never leaves for a job and its context never breaks (RULES.md chat rule 4). So chat tiers are
chosen per conversation, and only Standard is resident.

| Tier | Proposal | Memory | Speed | Confidence |
|---|---|---|---|---|
| Standard | Muse Glimmer 30B Q4 (resident today, dense; measured 22 tok/s, 19 GB). **Replacement candidate (owner, 2026-10-30): Qwen3.6-35B-A3B Q4, measured 70 tok/s, 21 GB, first word 0.1 s, 9 of 9 tool searches, goes to MODEL-VET-01 with CHAT-AB-01 and KS-BENCH-01 before it replaces Muse** ([results](tier-evaluations-2026-10-30.md)). Faster alternative to bench through the normal vetting: Qwen3.6-35B-A3B (Apache-2.0, about 20 GB at 4-bit, 85 to 105 tok/s at 8-bit on this chip, stared benchmark) | 21 GB | 26 tok/s today | measured (Muse), verified benchmark (Qwen3.6) |
| Boost | A stronger model loaded on demand for a conversation the person marks "think harder". Measured 2026-10-30 (reduced probe, no MTP): Qwen3.8-27B 23.5 tok/s, 16.6 GB, 3.4 s first word on a 4k-token history; Gemma 4 26B-A4B MLX 4-bit 42 tok/s, 13.7 GB. Candidates: Qwen3.8-27B dense (Apache-2.0, about 16 GB; its 3.6 sibling does 17 to 18 tok/s, 30 to 32 with MTP; vendor card Terminal-Bench 2.1 73.0), or a mid-size MoE such as Gemma 4 26B-A4B or Nemotron-3 Nano (licences unchecked). Evicts the idle picture pool | 16 to 50 GB | 17 to 32 (27B) | verified speed for 3.6, card claims for 3.8 |
| Max | The largest local model for the whole family's conversation, replacing the resident one. Candidates: Ornith-1.5-122B (MIT, 68.7 GB, 34 to 41 tok/s mlx_lm, measured by us, coding-tuned); gpt-oss-120b (Apache-2.0, 62 GB MXFP4, about 53 to 64 tok/s on M4 Max in oMLX numbers, native function calling needs the harmony format); Qwen3.5-122B-A10B (Apache-2.0, about 70 GB, unmeasured); Mistral Small 4 119B (Apache-2.0, unmeasured). The general-chat winner is chosen by our own bench, not by cards. **Measured 2026-10-30 (reduced probe, beside the live chat): Mistral Small 4 119B 49 tok/s, 65 GB, 9 of 9 tool searches; gpt-oss-120b 47 tok/s, 55 GB (tools not testable on the server used); Qwen3.5-122B-A10B 33 tok/s, 66 GB, 6 of 9; Ornith 122B 34 tok/s, 69 GB, 6 of 9. None showed a clear gain over Qwen3.6-35B-A3B; Max chat is undecided until CHAT-AB-01 and KS-BENCH-01 run** | 62 to 85 GB, about 91 GB with voice and embed | see names | Ornith measured; others claimed |

Research caveats: the stared benchmark covers this exact chip but only Qwen3.6 (35B and 27B) and DeepSeek-V4-Flash, which needs about 103 GB and is out. MTP speculative decoding is reported at +13 percent (MoE) and +78 percent (dense 27B) on llama.cpp, so a 27B with MTP at about 32 tok/s would beat today's Muse; Muse's licence was not checked. Tool-calling scores are vendor cards. Dense 120B-class models (Mistral Medium 3.5) would run near 8 tok/s and are rejected.

Notes: Max chat reuses coding mode's swap transaction (unload residents, load the big model, post-load check, return on failure) but as a lease
with no household switch (section 7, T6 and T7). The 122B was not shown smarter than the 27B on four coding tasks (coding note), so Max chat
must earn its place by a measured general-chat bench before it is offered.

### 5.2 Pictures (create)

| Tier | Proposal | Peak | Time | Confidence |
|---|---|---|---|---|
| Standard | ERNIE-Image-Turbo 8B, Klein 4B fallback (as today's Quick) | 18.8 GB (Klein 10.2) | 33 to 44 s (Klein 17 s) | measured |
| Boost | Z-Image-Turbo, most photoreal (as today's Detailed) | 25.8 GB | 46 s | measured |
| Max | **Qwen-Image 20B (Apache-2.0, mflux Q8, 30 steps; owner's decision 2026-10-30: the Max picture slot, Max only), measured 181 to 212 s per 1024 picture, 37.4 GB peak at load 35 to 55, every text string right, the character prompt drawn correctly where Z-Image and ERNIE base missed.** ERNIE-Image base was dropped as a Max candidate (272 to 305 s, 18.8 GB, no margin over Z-Image-Turbo). Superseded text: two real candidates to bench on our 22 prompts: ERNIE-Image base 8B (Apache-2.0, 50 steps with guidance, mflux Base variant, self-reported OneIG 0.575 and GenEval 0.886) and Qwen-Image 20B (Apache-2.0, mflux, about 40 GB at bf16, about 20 at 8-bit by estimate). Time per picture is unmeasured (estimate 3 minutes at 1024 px for ERNIE base) | 37.4 GB (Qwen-Image) | 3 to 4 minutes | measured on 9 of 22 prompts; licence verified |

Research reconciliation (2026-10-27): Qwen-Image 2.1 is research-licence on its card, matching our bakeoff; Qwen-Image 2.0 is API-only (the "Apache" claim in a search was wrong); the older Qwen-Image 20B and Qwen-Image-Edit-2511 are Apache-2.0. HiDream-O1-Image is MIT but its card documents CUDA only, so it does not qualify until a Mac path exists. Z-Image base is rated lower in look than Turbo on its own card (more diverse, not prettier), so it is not a Max. Honest read: undistilled models are not clearly better than our Turbo picks, so Max image is only offered if a bench shows a gain (rule in section 12, item 5). Max image may legitimately be "same model, 2K, more steps".

Edit stays on Klein for Standard and Boost (20 s, bf16 as the owner decided). Max edit candidate: Qwen-Image-Edit-2511 20B (Apache-2.0) via mflux; mflux's README does not name that exact checkpoint, so verify.

### 5.3 Video

The two pins we have do not differ in memory (44 GB and 46 GB), so today's pair cannot be Standard and Boost by footprint alone.

| Tier | Proposal | Peak | Time (5 s) | Confidence |
|---|---|---|---|---|
| Standard | Wan2.2 TI2V-5B FastWan, silent, 480p (today's Quick, 44 GB, fits beside the resting pool). A lighter variant (q8 weights, 61 frames, tiny decoder) is the way to make it truly "beside everything" | 44 GB (lighter: to measure) | 130 s | measured; lighter is to verify |
| Boost | LTX-2.3 distilled with sound and spoken words, up to 10 s (today's Detailed), 768x448 | 46 GB | 42 to 49 s (10 s: 80 s) | measured |
| Max | LTX-2.3 dev two-stage (non-distilled, with guidance) at higher resolution and longer clips on mlx-video. Memory and time unmeasured; Wan2.2 A14B (Apache-2.0) has no Mac path found and its card asks 80 GB, so it is out for now. LTX-2.5 (released 2026-08-11) has no MLX port found | 60 to 72 GB (guess) | 10 to 30 min (guess) | not measured; **Max video stays empty for now (owner, 2026-10-30)**. Reference numbers measured 2026-10-30 at load 33 to 40: Standard Wan 5B 25.4 GB and 75 to 88 s per 2 s clip (known Wan 5B artifact, seen by Jesse: a head appearing behind the umbrella in the street clip); Boost LTX-2.3 distilled 39.9 GB and 41 to 46 s with sound |

Research (2026-10-27): a community 4-bit LTX-2.3 distilled build (`gajesh/ltx-2.3-mlx-q4`) claims 29.9 GB peak against 34.2 GB at FP16 for
video only, which would make a sound-capable clip an Standard candidate; one author, one machine, and a user reported the package it names was not
findable, so it is a vendor claim to reproduce, not a pick. Not checked: the dev two-stage memory, the tiny Wan decoder (VIDEO-GEN-11).

Licence note: LTX is free under $10M yearly revenue and the admin accepts once (video note section 14.2). The 2.x text also has a
no-competing-product clause (item 20) and a same-terms rule for derivatives such as quantised builds and LoRAs. Read 2026-10-30 ([results](tier-evaluations-2026-10-30.md)); the owner ruled item 20 is fine and no question goes to Lightricks. Derivative builds still ship with the licence text.
Max video stays admin-gated because it is the one job that can hold the machine for tens of minutes.

### 5.4 Music

| Tier | Proposal | Peak | Time | Confidence |
|---|---|---|---|---|
| Standard | ACE-Step 1.5 turbo 2B DiT with the 1.7B planner, as shipped on p128 (both Quick and Full songs use it, music note section 18.1a) | 33 GB admission, about 21 GB resting | 31 to 90 s for a full song | measured |
| Boost | ACE-Step 1.5 XL turbo (4B DiT, 8 steps, MIT): **no slot** (measured 2026-10-30: 26.7 GB, the same time as the shipped turbo, sung words no better) | 26.7 GB | 13 to 14 s per 40 s song | measured |
| Max | ACE-Step 1.5 XL base or sft (50 steps with guidance; XL released 2026-04-02). Card: 18.8 GB bf16 weights, 20 GB recommended, 24 GB for full quality with the 4B planner; its README does not say XL runs on MLX, and a community 8-bit MLX turbo build exists | 26.7 to 27.0 GB | 26 to 35 s per 40 s song (50 steps, guidance 7) | measured on the Stack's MLX worker: XL runs as shipped; XL SFT sang the folk lyric with 3% word errors against 19% for the shipped model, but Jesse found the songs too close to call by ear (2026-10-30): **no Max slot, Max music stays empty** |

Quick and Full songs (how much of the lyric is sung, `generation.music.length`) are not tiers: they stay as the music note defines them, on whatever
model the music slot holds. Stable Audio 3 Medium (open weights, up to 6:20) is rejected as a music tier slot: its community licence caps revenue at $1M and no Apple path was found. MUSIC-GEN-11 (beds and effects behind a licence gate) stays an open row of its own.

### 5.5 Stem splitting (new)

| Tier | Proposal | Confidence |
|---|---|---|
| Standard | Demucs htdemucs, 4 stems (MIT code and weights; official `demucs` package on torch with MPS works: 1.2 GB, 2 to 5 s per 40 s song, measured 2026-10-30) | measured; stays Standard after Jesse's listen (2026-10-30) |
| Boost | Demucs htdemucs_ft (1.75 GB, 7 to 8 s, only if a listen finds it cleaner) or htdemucs_6s (1.4 GB, adds guitar and piano; Jesse heard the guitar stem is real but the piano stem on the pop song is near silent, so it helps only on songs with piano) | measured; ft and 6s unverified by ear beyond that |
| Max | BS-RoFormer SW (6 stems) scores highest on MVSEP's own table (vocals 11.3 dB against about 8.3 for htdemucs_ft, vendor numbers), but its checkpoint licence is "unknown", the code README warns the MIT code is not a grant for the weights, and it has no Mac path (CPU and CUDA only). Not shippable until a permissive weights licence and an MLX or MPS path exist | vendor-claim; blocked |

Until a RoFormer-class model clears licence and Apple path, stems have Standard and Boost only; the tier collapse rule (section 4) hides Max. ACE-Step
`extract` (xl-base only) is a later alternative that avoids a separate separator.

Stems are an edit of a song Home made or a file the person owns; music note MUSIC-GEN-14 (uploaded audio, voice) still applies and is
Jesse's decision, not part of this note.

### 5.6 Voice and vision

Yes, there is a lighter voice, and voice fits the ladder as a Standard and a Reduced slot only. Voice is reserved class (a spoken turn must never
queue), so it has no Boost or Max: no stronger voice model is worth taking the machine for, and the tier collapse rule hides slots that do not
differ.

| Slot | Speaks (tts) | Listens (stt) | Memory | Speed | Confidence |
|---|---|---|---|---|---|
| Standard | Chatterbox Turbo on MLX (MIT; Jesse's pick by ear, default on p64 and p128): expressive, three nonverbal tags, cloning | Parakeet v2 int8 (1.5% word errors clean, 3.7% noisy) | about 4.8 GB (2.8 GB resident, 4.3 GB peak in the live Stack) plus 1.8 GB | tts 0.27x real time, first audio 0.45 s; stt 150 to 520 ms | measured |
| Reduced | Pocket TTS on CPU (CC-BY-4.0 weights; today's fallback and default on p16 and p32): plainer, no nonverbal tags, small. Better candidate to bench: Chatterbox Nano, see below | Moonshine tiny int8 (4.4% clean, 13.2% noisy) | small; stt 0.3 to 0.6 GB | tts 0.1x real time, streams; stt 48 to 190 ms | measured (stt, tts speed), memory of Pocket not re-measured |
| Boost, Max | none | none | | | collapsed |

What this buys and costs: Reduced voice frees only about 6 GB (Chatterbox 4.8 plus Parakeet 1.8, less the small replacements). That is a
modest gain next to chat's 20 GB, and it has real costs: the voice itself changes (a family and the companions know it), Pocket cannot render
the nonverbal tags, and household or cloned voices (Chatterbox cloning) may not exist in Pocket (to verify). The listening side is the bigger
risk: a Moonshine error rate of 13% in a noisy kitchen would make hands-free voice feel broken.

Recommendation: **voice stays at Standard when Reduced is engaged for chat.** Voice joins Reduced only for a Max job that still lacks the last
~6 GB after chat is reduced, only between utterances (never in the middle of a spoken turn or a live session), and only for the speaking side
first; listening stays on Parakeet unless memory demands it. The admin's confirm line names it ("Voices will sound plainer for about N
minutes"). The slots are customizable like the rest (section 3a), so an admin can turn voice-in-Reduced off or pick a different light voice.
**Owner ruling 2026-10-30: Chatterbox Nano is adopted as the recommended Reduced voice on p64 and p128, switchable in AI and models; Pocket TTS stays the p16 and p32 default and the fallback. Jesse listened: close enough to Turbo that users will not tell.** **Measured 2026-10-30 ([tier-evaluations-2026-10-30.md](tier-evaluations-2026-10-30.md)):** Chatterbox Nano runs on MLX (after a three-line size fix to `mlx-audio` 0.6.3), peaks at 2.8 GB against Turbo's 4.6 GB, reads the same words and clones about as close by proxy; the ear check is Jesse's. Reduced chat on Qwen3-4B passes the measured parts (swap near zero because the judge model is resident). The next paragraph is the question as asked before the bench.

**Why not Chatterbox Nano?** It was never evaluated for the Studio. The only repo mention (docs/dev.md, 2026-09-04) is a robot-side note: researched,
not adopted, because it has no Hailo-10H path and no Pi-class benchmark. For a Reduced voice on the Mac it is the best idea on the table:
same family as the Turbo voice we chose by ear, 110M parameters against Turbo's 350M, MIT, zero-shot cloning from a reference clip of about
10 seconds, and the same nonverbal tags (`[laugh]`, `[sigh]`, `[cough]`, `[chuckle]`), so a Reduced voice could stay close to the Standard voice
and keep household cloned voices, which Pocket probably cannot (official model card and product page, 2026-10-27). Facts that stop us calling it a
pick yet: English only; Resemble's own speed is "3x real time on 8 CPU cores" and "10x on GPU", which is about Turbo-on-MLX speed (0.27x real time
= 3.7x), slower than Pocket's 10x; no memory figure is published; no MLX or Apple-silicon notes (community Core ML, ONNX and GGUF conversions
exist, one ONNX build is non-streaming); streaming for the self-hosted model is not stated; every clip carries the PerTh watermark, as Turbo's
already does. Bench before deciding: resident memory and time to first audio through a Stack worker, streaming yes or no, how close its voice is
to Turbo with the same reference clip, and whether it runs on MLX, MPS or CPU. If it passes, it replaces Pocket as the Reduced voice slot's
recommendation on p64 and p128 (and is worth a look as the p16 and p32 default); Pocket stays the fallback.

Parakeet as the larger-tier stt pin ([parakeet-stt-tier-2026-10-25.md](parakeet-stt-tier-2026-10-25.md)) stays a hardware-class choice (p64 and
p128), and the existing Standard voice and Better voice rows on the AI & models page map to the Reduced and Standard slots.

Vision (photo understanding) is a warm item at Standard; a bigger vision model could be Boost later.

## 6. Who gets what (access)

- **Standard and Boost: every person the existing gates allow.** Child and teen rules do not change: video and music stay adult-only where they are
  today, the kids picture lane stays Standard on its own lane model, and a tier never loosens an age or surface gate (RULES.md rule 0).
- **Max: one grant, `tier.max`.** Admins hold it by role and it cannot be removed from an admin. Any admin can assign it to an adult in People, as
  with every other grant (`requireRoleOrGrant`, the grants table, the approver cells). An optional parameterized form `tier.max:<category>` (for
  example `tier.max:video`) lets an admin give one person Max video but not Max chat. Default for a new person: no.
- **Minors (architect ruling 2026-10-27, RULES.md rule 8 and rule 0).** Jesse answered "adults and teens" for who an admin may assign Max to. Rule 8
  says a minor never gets model choice or thinking, the people-roles note bars teens from model and mode controls, and the video note keeps teens
  Quick-only. So a minor's chat and video tier clamp to Standard whatever the grant says. An admin may record the grant on a teen, and it takes
  effect only in the teen picture lane, and only where that lane's own rules already allow a bigger picture model; it never reaches chat, video,
  music or stems for a minor. A child's cell stays `never`. Widening this needs a RULES.md change, which only Jesse makes; it is reported in the
  final summary as a deviation from the chat answer.
- **Per-category on/off.** An admin can turn a mode off for a category household-wide (for example "no Max video") through the slot record's `off`
  value (section 3a, section 11), the one definition that absorbs `engines.<role>.choice`.
- **Spec first.** The grant id, copy and the settings keys land in `commons/spec` before Home reads them.

## 7. Queue integration

Everything below rides the job record and queue that exist. A tier adds a `tier` field and a `window` state to a job; it adds no table or surface.

1. **Tier is part of admission.** The Stack governor receives the candidate's measured peak and a `tier` class tag (Standard, Boost, Max). `fits_ever`
   and `room_after_eviction` (memory note 4.2) answer for the tier's cap. A Max request that can never fit is refused at submit with numbers; one
   that fits waits without a deadline.
2. **Order: Q2 stands.** Category order (chat, pictures, video, the rest) still decides who is next among Standard and Boost jobs. A Max job is
   not a new class above them. It enters the order at its category's class but cannot start until the window opens (rule T3).
3. **T1. One heavy slot.** One Boost or Max burst job at a time household-wide, as one burst job today. Standard jobs of different categories may
   run together if the governor says they fit.
4. **T2. Boost may evict, Max must drain.** A Boost job evicts idle warm items in the memory note's order and then runs. A Max job waits for the
   running jobs to finish (drain), never cancels them, and holds new admissions while it waits.
5. **T3. The Max window.** When a Max job is next and nothing is running: the governor evicts every warm and burst item, sets watchdog
   level to normal-only, and marks the window open. While open, no other job is admitted except chat, voice and the reserved set. The job runs,
   pauses for chat turns (heavy gate), and ends. The window closes and the held queue restarts in Q2 and Q3 order.
6. **T4. Fairness without ever taking work away.** Max cannot starve the household, and a limit never destroys work in progress.
   (a) A Max job waits behind any job that arrived before it in the same category class (no jumping). (b) After a Max job ends, the queue must start
   at least one waiting job from every other person before another Max job opens a window; a person's own back-to-back Max jobs count as one wait
   for them. (c) Q5 aging applies: a Max job waiting 10 minutes moves up one class, once. (d) **Time limits are yield points, not kill points.** A
   running Max job is never cancelled because a clock ran out. The category "ceiling" (a planning figure: video 30 minutes, others 10) only decides
   what happens next: nobody new is held beyond it for a job that has not started, and the card tells the admin the estimate before it starts. If a
   job runs past its estimate, others keep waiting with the honest line "Still running, about N minutes more".
7. **T5. What can lose work, and what happens.** The only forced stop is the watchdog at CRITICAL (the computer is about to fall over). A video,
   song or picture then restarts from the beginning at the head of its class (up to two re-queues, then the existing low-memory failure line);
   this is the one case where minutes of generation are lost, and the card says so in plain words. A pause for chat is not a loss: the job holds its
   memory and resumes (heavy gate). An admin pressing Stop on a window is a cancel the admin chose, with a confirm that names the job.
8. **T6. Chat Max, no mode switch.** Chat Max is a lease on the machine for one thread (or one coding client's session), taken when a holder picks
   Max and released when nothing is in flight. While held, it blocks Boost and Max generator jobs with the reason `max_chat`, lets Standard jobs that
   fit run, and swaps the resident chat model for the big one (the existing unload, load, post-load-check transaction from coding mode, with its
   rollback to the standard model on any failure). The household's other threads keep answering: on the big model while the lease is up, on the
   standard model after. Coding mode's readiness record (its eight items) becomes the gate for offering Max chat on this machine; `coding.home_mode`
   and its Settings switch are retired.
9. **T7. How a lease ends without losing a coding task.** A lease never ends mid-request. (a) While any request on the big model is in flight, the
   lease stays, however long the idle timer says. (b) A coding client works in files on its own computer; Home holds no work product, so a lease
   ending loses at most a reply that was still being written, and (a) prevents even that. (c) When the idle timer expires (default 30 minutes with
   no request from any lease holder, counted from the last token), the lease releases between requests: new requests wait the 20 to 60 seconds the
   swap takes, with the existing "starting" state and the cause `mode_change`, then continue on the standard model, and the coding client sees
   one slower reply, not an error. (d) A holder can renew by sending anything; an admin can pin a lease for a session ("keep until I leave Max") and
   it still releases when the pinned person goes quiet for 4 hours. (e) If the big model is evicted because of a watchdog CRITICAL, the client's
   request gets the same retryable "busy, retrying" response the Stack gives chat today, and the lease re-opens by itself when memory is fine.
   Generator windows never idle open: they end with the job.

## 8. What people see

Rule S6: the job card, the Yours line, the Status page row, the composer line and the existing admin notification. No banner, toast or dot.

| Situation | Line (adult) | Child |
|---|---|---|
| Waiting for a Boost or Max job ahead | "A bigger job is running. Yours is number 2 (about 6 minutes)." | "A big job is running. You are number 2." |
| Waiting because a Max window is open | "Home is running a Max job and will be back to normal in about 12 minutes. Yours starts after it." | "Home is busy with a big job. Yours starts after it." |
| Waiting for the Max job to start (drain) | "Max starts when the pictures ahead finish (about 1 minute). New jobs wait behind it." | n/a |
| Standard result offered a better one | "Make it Boost (about 1 minute)" or "Make it Max (about 20 minutes, Home pauses other big jobs)" | no Max button |
| A person without `tier.max` taps nothing | No Max control is shown; if a link or old chat names it: "Max needs an admin's OK. Ask an admin." | same |
| Max not available on this computer | The control is hidden. Status row for an admin: "Max video needs 60 GB of room; this computer has 24 GB." | n/a |
| Max job done | Normal finished-job notification; nothing new | |
| Reduced is engaged (everyone, under the chat input) | "Chat is simpler while a big job runs (about 12 minutes). Answers are shorter and some extras may be paused." | "Chat is a little simpler for a few minutes." |
| Max needs Reduced (the admin's confirm line) | "This needs the whole computer. Chat will switch to a simpler model for about 12 minutes. Continue?" | n/a |

The estimate before an admin starts a Max job is shown on the confirm line (section 9) so nobody starts a 30 minute window by accident.

## 9. Admins reach it where they work (no Settings trip)

Settings holds only the defaults (per category: which tiers exist, who holds `tier.max`). The use is in the tools:

| Where | Control | Behaviour |
|---|---|---|
| Chat composer | The model chip (a kit primitive) gains a three-way Standard, Boost, Max picker for the thread. Max shows only to holders | Standard is the thread default. Boost loads the stronger model on first send and says "Loading the stronger model (about 20 seconds)". Max chat shows a one-line confirm: "Max uses the big model. Big pictures, videos and songs wait while you use it, and Home goes back by itself when you stop. Continue?" and a quiet "Max" marker on the chip while the lease is held, tapped to release |
| Asking in words | "Use max quality for this video" or "use the big model" | The chat model sets the tool's `tier` argument (a typed value, never a word reading); for Max it checks the grant and either runs or says an admin must do it |
| Picture, video, song and stem cards | The Standard, Boost, Max segment beside Make another, plus "Make it Max" on a finished result | Max opens one confirm line with the time and what waits. The segment remembers the person's last pick per category |
| Job cards and the Yours line | An admin sees "Max window open, 12 minutes left" and a Stop that ends the window and re-queues what is held | The same Stop that cancels the job |
| Status page | One row per category showing the resolved model per tier and who holds Max | The existing "AI & models" page ([ai-models-glance-2026-10-26.md](ai-models-glance-2026-10-26.md)), no new page |
| Notifications | An admin who started a Max job hears when it finishes, as for any job | The existing finished-job notification |

The kit elements already shown (VideoPlayer, MusicTrack, the picture card) take the segment as a prop or variant, added in `commons` first
(RULES.md rule 9: no `className` overrides and no Home wrapper).

## 10. Tool disabling

Disabling is a queue reason, never a permanent switch and never a hidden tool.

- While a Max window is open, the conditional tools that start generating work (`generate_image`, `edit_image`, `generate_video`, `generate_music`,
  `edit_music`, stem split) stay offered; calls are accepted and queued with the reason `max_window`. The model says in its own words that the job
  is waiting (rule 6). Tools that need no big model (lists, reminders, search, read link) keep running.
- A tool whose tier is not offered (for example Max video on p64) is not offered to the model at all, as `videosAllowed` already works.
- The tool count cap of 16 per turn (music note section 13) is unchanged: tier is an argument of an existing tool, not a new tool.
- A child's or teen's tools follow their band; the tier argument is clamped to Standard for them (chat and video always; pictures only inside the teen lane's own rules, section 6).

## 11. Settings and records (declare once)

- `engines.<role>.tier.<standard|boost|max>` (section 3a): which candidate backs each slot; `recommended`, a candidate id, or `off`. It
  absorbs `engines.<role>.choice`, `generation.picture_quick_model` and `generation.picture_detailed.enabled` through a migration. A second
  record per slot, `who`, holds everyone, assigned or admins.
- `generation.picture_quality` and `generation.video_quality` today hold Quick and Detailed. They become `generation.<category>_tier` (household
  select: standard, boost; Max is never a household default). `generation.music.length` is not a tier (Quick and Full songs are how much is
  sung) and is unchanged; music gets its tier key from the slot records. Existing values map one to one and a
  migration reads the old keys. Copy comes from the spec (S5).
- Grant: `tier.max` (and `tier.max:<category>`) in `grant-actions.json`, with a policy block like its neighbours.
- Job record: `tier` (text), `window` (none, draining, open), `tier_reason` (the queue reason code). Provenance gains the tier of a generated file
  (`GenerationProvenance`, spec first).
- Log events: `queue.waited` and `memory.evicted` gain `tier` as a class label, never a person or prompt (rule 6a).

## 12. Decisions (owner, 2026-10-27, closed)

1. The ladder is Reduced (system-only), Standard, Boost, Max.
2. No household switches: coding mode goes away and Max is a lease (section 7, T6 and T7).
3. An admin may assign Max to adults. Jesse said "adults and teens"; RULES.md rule 8 limits a teen's grant to the teen picture lane and clamps a
   minor's chat and video to Standard (section 6). A child's cell stays `never`.
4. While chat is Reduced, children and teens keep chatting on the small model with thinking off and no tools (section 2a, rule 5).
5. The lease, idle-time and yield-point rules of section 7 (T4 to T7) stand as written: no limit destroys work in progress; the only forced
   loss is a watchdog CRITICAL.
6. Every mode can be turned on or off per category, and every slot's model can be changed by an admin (section 3a).
7. Chatterbox Nano goes on the evaluation list (E2). A Max or Boost model is catalogued only if a measured gain over the slot below it is shown.

## 13. Build slices (rows are in `docs/BACKLOG.md`, "Resource tiers")

| # | Repo | What |
|---|---|---|
| 1 | commons spec | `tier.max` grants and the three `generation.<category>_tier` keys with copy, the job-record `tier` field, provenance field |
| 2 | Stack | catalog candidates per tier and hardware profile, with measured peaks; the resolver (tier, profile) to a model |
| 3a | Stack | Reduced: the swap to the `light` profile model for chat, judge and router during a Max window that needs the room, the return, and the in-flight guard; measure swap time and Reduced chat quality first | 
| 3 | Stack | governor `tier` tag, `fits_ever` and `room_after_eviction` per tier; the Max window (drain, hold, release); watchdog re-queue |
| 4 | Home | household queue: T1 to T7, fairness, window state on job records, copy table entries |
| 5 | Home | `tier.max` grant check in every route and tool; tier clamp for minors; migration from Quick and Detailed |
| 6 | commons ui | the three-way segment and the composer chip variant; confirm line |
| 7 | Home | tool wiring (typed `tier` argument), cards, Yours line, Status row |
| 8 | Stack and Home | chat Max as a lease over the coding-mode swap transaction (in-flight guard, idle release, pinned lease); retire `coding.home_mode` and its Settings switch after a migration; bench for general-chat Max |
| 9 | Stack bench | the per-category Max gain benches; any Max without a measured gain is not catalogued |

Order: 1, 2, 3, 4, 5, then 6 and 7, then 8 and 9 per category as each Max model is proven.

## 14. Evaluation list (what must be measured before a slot is filled)

One shared harness per category, run one at a time on the Studio under the machine lock in the bench lane, never beside the live hub's busy hours,
each recording peak memory, wall time, a quality judgement opened and looked at (pictures, clips, songs listened to), and for swaps the time in
and out. A Max or Boost model is catalogued only if it shows a measured gain over the slot below it (decision 7 of section 12). Order is by what unblocks the
most, first.

| # | Eval | Decides | Pass means | Candidates |
|---|---|---|---|---|
| E1 | Reduced chat | Whether Reduced exists at all, and the real Max cap | Swap under 60 s (near zero if the resident judge model serves), household finds it usable, minors' floors hold | Qwen3-4B from the `light` profile; one other 4B to 8B |
| E2 | Reduced voice | The light voice slot | Streams, memory known, sounds close to Turbo with the same reference clip, cloned voices work | **Chatterbox Nano** (added 2026-10-27), Pocket TTS as the baseline, Chatterbox Turbo as the reference |
| E3 | Video Max and Standard | Max video model; whether a lighter Standard exists | Clearly better than Boost on our prompts, fits the cap (with Reduced: about 95 GB), time stated | LTX-2.3 dev two-stage; LTX-2.3 4-bit and 8-bit (reproduce the community claim); tiny Wan decoder (VIDEO-GEN-11); Wan 5B q8 61-frame (VIDEO-GEN-09); Wan2.2 A14B if an Apple path appears |
| E4 | Image Max and Max edit | Max picture and edit models | Beats Z-Image-Turbo on our 22 prompts (text, photoreal, edits) by a margin worth minutes of wait | ERNIE-Image base; Qwen-Image 20B; Qwen-Image-Edit-2511 20B for edits |
| E5 | Chat Boost and Max | Boost and Max chat models, the resident Standard model | Beats Muse on search, tool-use and household benches (CHAT-AB-01, KS-BENCH-01), speed stated, minors' floors hold | Qwen3.6-35B-A3B; Qwen3.8-27B (with MTP); Gemma 4 26B-A4B; gpt-oss-120b; Qwen3.5-122B-A10B; Mistral Small 4 119B; Ornith-1.5-122B |
| E6 | Music Boost and Max | Whether XL earns a slot | Audibly better than 1.7B turbo songs, fits the cap, MLX path works | ACE-Step 1.5 XL turbo; XL base or sft |
| E7 | Stem splitting | The new feature's Standard and Boost models | Separation quality heard, licence clean, Apple path | Demucs htdemucs, htdemucs_ft, htdemucs_6s; a RoFormer only if its weights licence clears |
| E8 | Listening side (stt) in Reduced | Whether stt ever drops | Word error acceptable in kitchen noise | Moonshine tiny against Parakeet v2 |

Results (2026-10-30): E1 passes the measured parts; E2 Nano adopted for p64 and p128 (owner); E3 Max video stays empty; E4 Qwen-Image 20B is the Max picture slot (owner); E5 Qwen3.6-35B-A3B goes to MODEL-VET-01 as the Muse replacement candidate (owner), the 120B class to be run in a quiet window with a swap; E6 XL turbo and XL SFT: no slot, Max music stays empty (owner, by ear); E7 htdemucs Standard; E8 is no. Numbers and open items: [tier-evaluations-2026-10-30.md](tier-evaluations-2026-10-30.md).

## 15. Phases

Estimates are effort in working days for one agent plus review, not calendar promises; the evals are bounded by Studio machine time (one at a time).

| Phase | What | Output | Needs | Rough size |
|---|---|---|---|---|
| 0. Decide | Owner sign-off on lease and limits (section 7); architect verdict on this note (it touches the queue, grants and settings); licence read for any new pin (LTX legal read, Qwen, Chatterbox Nano) | Approved note, rows in the backlog | Jesse's answers | 1 day |
| 1. Evaluate | E1 to E8, in that order, each producing a short decision record and the measured peak for the catalog. E1 and E2 first because they set the Max cap and the voice slot. Runs in parallel with phase 2 | One record per eval; the filled-in catalog table (slot, model, peak, time, licence) | The bench lane, the machine lock, downloads Jesse approves | 6 to 10 days of machine time in total |
| 2. Foundations | Spec first: `tier.max` grant, slot records, job `tier` field. Stack: catalog candidates per tier and hardware profile, the resolver, governor tier tags, `fits_ever` per tier (slices 1 to 3) | Resolver tested on p16 to p128 fixtures; no behaviour change yet | Phase 0 | 4 to 6 days |
| 3. Queue and windows | Home household queue rules T1 to T7, the Max window (drain, hold, release), fairness, watchdog re-queue, the copy table, the Reduced swap with its in-flight guard (slices 3a, 4) | Max job runs end to end on a scratch Stack with chat Reduced; no work lost in the four forced cases | Phase 2, E1 | 6 to 8 days |
| 4. Access and admin | Grants in every route and tool, minors' clamp, the AI & models per-slot gear dialogs and per-mode switches, kit props for the segment and chip, in-tool controls on cards and the composer (slices 5 to 7) | An admin changes a slot, switches a mode off and starts Max from a card, all previewed in the built-in browser at desktop and phone width | Phase 3, kit tag from Jesse | 6 to 8 days |
| 5. Migrate | Quick and Detailed become Standard and Boost; old settings map into the slot records; chat Max as a lease; retire `coding.home_mode` and its Settings switch (slice 8) | Migration tested on a copy of the live data; coding mode gone | Phase 4, E5 | 3 to 5 days |
| 6. Prove and ship | Isolation bench scenarios for each tier mix, the privacy check (zero new outbound), user docs at grade 6, then ship to the live hub one category at a time on Jesse's word: pictures, music, video, voice, then chat Reduced and Max, then stems | Each category verified on the Studio, then live | Phases 4 and 5 | 1 to 2 days per category |

Why this order: pictures, music and video already have two kinds, so they are the cheapest to relabel and prove first; chat is last because Reduced and
Max chat swap the model the whole household talks to and carry the age-band floors. Stems are a new feature and ship when E7 clears a licence. Nothing
is built before E1, because if Reduced chat is judged too poor the Max cap stays at 72 GB and the Max candidates change.

## Supersedes

- `coding-mode-2026-10-22.md`: the household switch `coding.home_mode` and its Settings card switch are replaced by the Max chat lease (sections 7
  T6 and T7); its readiness record, swap transaction and rollback are reused unchanged. Retired in phase 5, after E5 and the lease are proven.
- The Quick and Detailed wording for pictures and videos in `image-model-bakeoff-2026-10-25.md`, `video-generation-2026-10-17.md` section 14
  and `ai-models-glance-2026-10-26.md` (rows "Quick pictures" and "Detailed pictures"): replaced by Standard and Boost; the models in the slots do
  not change. `generation.picture_quick_model` and `generation.picture_detailed.enabled` fold into the slot records (section 11).
- `memory-management-2026-10-25.md` rule Q2 and Q8 are extended, not replaced: tiers add the Max window (section 7) on top of the class order.
- The Settings page for `engines.<role>.choice`: absorbed by the slot record (section 3a).
- `hardware-tiers-2026-09-23.md`'s "video off on every tier today" row stays for p16 to p64 (video is p128 only).

- `memory-management-2026-10-25.md` section 4.1, the reserved class "never evicted for a job": while a Max job needs the room, chat, judge and
  router may be swapped to the Reduced model (and, last, the speaking voice), with the same rollback. Chat and voice are still never queued.
- `coding-mode-2026-10-22.md` "Minors while the mode is on" (keep chatting with thinking off and no tools, or pause): decided as the small model
  with thinking off and no tools.
- Open backlog rows MUSIC-GEN-10 (ACE-Step XL as p128's detailed profile) and MUSIC-GEN-12 (stems): absorbed by TIER-EVAL-06 and the music
  Boost slot, and by TIER-EVAL-07 and TIER-STEMS-01. MUSIC-GEN-11 (Stable Audio 3.0 for beds and effects) is unchanged. MUSIC-GEN-14 stays
  Jesse's decision.
- Open backlog rows MODE-SPEC-01, MODE-ENGINE-01, MODE-STACK-01, MODE-HOME-01, MODE-WIZARD-01, MODE-BENCH-01 and MODE-DOC-01: absorbed by
  TIER-HOME-05 (the switch and wizard step are not built; the engine, model binding, readiness record and bench become the lease's parts).

Nothing else in RULES.md, the age and surface gates, the heavy gate or the reserved class is superseded.

Reuse check: slots and records extend `engines.<role>.choice`; the Max window is the memory note's governor and queue; the lease reuses coding mode's
swap transaction; Reduced chat reuses the Stack's `light` profile model; grants reuse `grant-actions.json`; controls reuse the model chip, job
cards and the AI & models page. No new queue, ledger, status surface or setting family.

## Rules check

Rule 0 (age and surface gates): untouched and first. Rule 1 (tool budget): no new tools. Rule 4: a generator tier never shrinks chat's window. Reduced swaps the chat model, keeps the full window, and a thread
that crosses a swap is re-sized by the one window builder and folded, never failed. Rule 8: no tier or model choice for a minor, an adult in Reduced
gets the features the small model's record proves, the fail-safe is for minors only. Rule 3: Reduced and every slot model run on their own
catalog settings. Rule 13: the Reduced chat evaluation runs CHAT-AB-01. Rule 6a: no person or prompt in logs. Rule 9: new kit props before Home code. Rule
11: only Stack-installed, pinned, tested models. S4, S5, S6: settings from the spec, copy from the spec, existing surfaces only. Privacy: nothing
new leaves the home; every pin downloads the way models do now.
