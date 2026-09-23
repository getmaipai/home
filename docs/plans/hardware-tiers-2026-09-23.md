# The hub's hardware tiers: voice, photos and pictures on what a family has (2026-09-23)

For Jesse. The product installs on the hardware a family already owns;
the Studio is the top of the range, not the baseline. So this page is
not "before the Studio". It names three supported tiers, tier 1 a 24 GB
Apple silicon laptop (this Mac), tier 2 a 16 GB CUDA laptop (the model
host's class: two 8 GB cards, 31 GB of RAM), tier 3 a 128 GB Studio and
up, and states for each capability (the chat model, voice, photo
understanding, picture creation) what runs at each tier under the one
pipeline. Only the model's budget record and the deployment limits vary
between tiers; there is no tier branch in the turn code. The acceptance
workload runs on tier 1 first. You decide the order of the three
capabilities.

## The tiers at a glance

| Capability | Tier 1: 24 GB Apple silicon laptop | Tier 2: 16 GB CUDA laptop (two 8 GB cards) | Tier 3: 128 GB Studio and up |
|---|---|---|---|
| Chat model | the 8B at Q4 on Metal, resident (about 7.7 GB measured with its cache); its budget record as measured | the 8B at Q4 on one card (about 6 GB with a smaller cache), the CUDA llama-server build; the same budget record once ENGINE-CONTRACT-01 runs on that build | the Studio's model, resident, its own budget record (MEASURE-02's candidates) |
| Judge, embeddings | the CPU 4B and the embedder, resident | the 4B on the second card or the CPU, the embedder on the CPU | resident |
| Voice (stt, tts) | sherpa-onnx in process, resident, under 1 GB | the same, on the CPU | the same |
| Photo understanding (`vision` role) | a small vision model on demand (Qwen3-VL-4B at Q4, about 3.5 GB while a photo turn runs), evicted when idle | the same model on demand on the second card | resident |
| Picture creation (`image` role) | on demand on a second in-house machine when one exists (a URL-tier engine); otherwise on this machine's MPS with the chat engine paused for about a minute per picture | on demand on the second card (FLUX.2 Klein 4B at fp8 or 4-bit, the text encoder in RAM), chat unaffected; when both cards are needed, the judge yields first | on the Studio itself, admitted by the governor beside a resident chat model |
| Deployment limits | one conversation with speech plus one photo or picture job at a time | the same, with the image job on its own card | two conversations with speech, a photo and a picture job at once (STUDIO-ACCEPT-01's original workload) |

What the tiers share: the roles (`chat`, `judge`, `embed`, `stt`, `tts`,
`vision`, `image`), the on-demand admission and eviction, the machine
and its budget, the chat Elements and the composer. What they never
share: a code path chosen by the tier. A tier is a set of measured
budget records and deployment limits, nothing more.

## The short version

1. **Voice conversation needs no new model, on any tier.** The hub already listens
   (dictation) and speaks (read aloud). The live session is those two
   pieces joined into one loop, on the chat library's own voice screen.
   Three small steps; the first is a one-line slot in the chat kit.
2. **Photos: a small vision model on the Mac, loaded only when a photo
   arrives.** It fits beside the chat model with room to spare, answers
   from the photo, and hands its reading to the chat model so every rule
   about children and privacy applies unchanged. Recommended over
   swapping the chat model for a "sees pictures" version (that would
   throw away every number measured yesterday) and over the laptop
   (whose external card drops off the bus).
3. **Pictures: draw where a card is free.** On tier 1 the Mac cannot
   draw and chat at once, so it draws on a second in-house machine when
   the house has one (today the laptop's card, idle while the coding
   lane is paused), else on its own MPS with chat paused for about a
   minute per picture. On tier 2 the second card draws while chat runs
   on the first. The Stack already has the picture job queue and the
   drawing engine; it gains one address for a drawing engine on another
   machine in the house.
4. **Order.** Voice first (no model, the biggest daily change), photos
   second, pictures third; or pictures second if you want them sooner,
   since they touch only the laptop. Each is one to two weeks.

Child rules are unchanged and not optional: a child profile cannot make
pictures until an adult unlocks it, every picture is checked before it
is shown or saved, and nothing is ever built to draw a real person.

## The detail

### 1. Voice conversation (HANDSFREE-01 b), every tier

**No new model.** The `stt` role is sherpa-onnx with Moonshine and the
Silero voice detector in process (`backend/src/lib/stt.ts`,
`sttSession.ts`); the `tts` role is the hub's speech supervisor
(`tts.ts`, `ttsSupervisor.ts`); dictation and read-aloud already run on
them. Memory: both under 1 GB together, already resident.

**Composes from:** the kit's shipped `voice-conversation.tsx` and
`voice.tsx` Elements (ui-v0.5.8 and later) on the assistant-ui runtime;
the built but unmounted waveform button and chevron
(`frontend/src/apps/chat/composerVoiceControls.tsx`, gated on stt and
tts ready); the turn request's `spoken` flag (RESP-01 and U4) so the
reply takes the spoken register; RESP-02's `reply.speech`; the spec's
sentence chunker for per-sentence speech as the reply streams; the
read-aloud Element's own stop control.

**Items, in order:** (1) `VOICE-01` (S, kit, upstream-bound): the
right-side composer slot (`ComposerExtraEnd`, the same recipe as the
left slot, onto assistant-ui/assistant-ui#8003 or its successor) so the
waveform mounts. (2) `VOICE-02` (M, Sonnet): the live session: press the
waveform, the Element shows listening, the voice detector ends the
utterance, the stt role transcribes, the turn runs with `spoken: true`,
`reply.speech` is spoken sentence by sentence as it streams, the Element
shows speaking, the transcript lands in the thread as text; stop from the
Element at any point; a child's turn keeps the child rules and no
reasoning. (3) `VOICE-03` (S): the chevron carries voice selection from
the tts role's voice catalog and, only when a wakeword package is
installed, the shortcut to that device's wake-word setting (the one
declared key, HANDSFREE-01 c's invariants). Out of scope: barge-in
(needs the robot's echo cancellation) and the wake word itself.

**Needs from ENGINE-CONTRACT-01:** cancellation reaching the engine
(stop mid-reply stops the decode). **Acceptance on the 24 GB Mac:** a
spoken turn end to end, first spoken word under 3 seconds after the
utterance ends beside the resident 8B, measured and recorded; part of
the acceptance workload in section 4.

### 2. Photos the model understands (ATT-01, the photo half)

Tier 1 is worked through here because it is the tightest; tier 2 runs
the same model on its second card, tier 3 keeps it resident. The record and the shape exist (`spec/schemas/attachment.schema.json`,
the ATT-01 design in dev.md); the vision engine was left open. Three
ways to close it, with the Mac's memory as it stands today: the chat
engine holds about 7.7 GB measured (the 8B at Q4 with its cache), the
CPU judge 2.5 GB, embeddings 0.1 GB, the hub and the OS roughly 6 to 8
GB, leaving about 5 to 7 GB free.

| Option | What runs | Memory | Verdict |
|---|---|---|---|
| A. A small vision model on the Mac, on demand | The `vision` role as a second llama-server with a multimodal projector, loaded when a photo turn starts and evicted when idle (the on-demand admission STACK-16 designed; the hub's supervisors stand in until Home runs on the Stack). Candidate: Qwen3-VL-4B-Instruct at Q4 (Apache-2.0, about 3 GB plus a 0.5 GB projector `(?)`); Gemma 3 4B is the fallback (its own licence, not Apache). | about 3.5 GB while a photo turn runs, 0 otherwise | **Recommended.** Fits in today's headroom; every chat number measured yesterday stays valid; the same role and admission serve the Studio, where the model simply stays resident |
| B. Swap the chat role to a vision-capable 8B | One model does both (Qwen3-VL-8B at Q4, about the 8B's size plus a 0.6 GB projector `(?)`) | about the same as today | Not recommended now: the tool-calling, inverse-miss and rewrite numbers, the budget record and ENGINE-CONTRACT-01's checks all reset to a new model, and vision variants usually call tools worse; kept as the reserve if A fails the photo bench |
| C. The `vision` role on a second machine (tier 1 only) | Qwen3-VL-8B on the RTX 3070 with the coding model unloaded; photos travel over the LAN to the laptop | 0 on the Mac | Privacy unchanged (in-house), but the external card drops off its bus, the laptop leaves after the Studio, and it adds the one dependency the hub's own machine should not have for a photo |

**How it enters the pipeline (one pipeline):** the context node calls
the `vision` role with the photo and the person's question and adds the
result as a `ContextItem` of source `document` (dated, subject-tagged,
disclosure filtered like any item); the chat model answers from it.
No second path, no branch: a photo is context. **Role contract per
STACK.md:** OpenAI-compatible image input on the `vision` role, timing
fields, cancellation, the pinned set recorded (ENGINE-CONTRACT-01's
checks run for this engine too). **Item:** `VISION-01` (M, Sonnet; the
engine on a side port first, a ten-photo bench with the roster's demo
photos judged for "answers the question about the photo", the child
rules asserted: child-derived content stays out of the judge as ATT-01
already rules).

### 3. Picture creation (MEDIA-HOST-01 and CHAT-MEDIA-01's first slice)

**Where it runs, by tier:** tier 2 draws on its second card while chat
runs on the first; tier 3 on the Studio itself under the governor. Tier
1, today, draws on the model host's RTX 3070 (8 GB, CUDA) on demand,
with the coding model unloaded while a picture draws (the lane is
paused), because the Mac cannot draw and chat at once: a picture
model needs 8 to 12 GB on MPS `(?)`, which means unloading the chat
engine, so MPS on the Mac is the fallback when the laptop is off, with
chat paused for about a minute per picture (the governor's admission
does the unload and reload; STACK-13a's queue and 13b's ComfyUI engine
exist).

**Candidate:** FLUX.2 Klein 4B distilled, Apache-2.0, already in the
catalog (`flux2-klein-4b`): about 4 billion parameters, fits an 8 GB
card at fp8 or 4-bit with the text encoder in the laptop's RAM `(?)`,
seconds per picture on the 3070 `(?)`. Juggernaut XL (OpenRAIL++-M) is
the second candidate on the same engine. Both measured, not assumed,
before the pin.

**What the Stack gains:** one URL-tier engine address for the `image`
role on another machine in the house (the same tier the chat and embed
roles already accept for an already-running server), health-checked
like every engine, the job API unchanged (`/v1/images/generations`,
queue, cancel, 202 past the deadline). Nothing leaves the house: the
laptop is on the household LAN, and the picture and its prompt never
touch a MaiPai or third-party service.

**Items:** `IMAGE-01` (M, Sonnet): the laptop's ComfyUI with Klein
pinned by revision and hash as a systemd service, the Stack's `image`
role pointed at it, one picture rendered through the job API with time
and footprint recorded. `IMAGE-02` (S): the chat side, the first slice
of CHAT-MEDIA-01: "draw me a ..." runs as a job through the executor
(a side effect: consent per person, progress in the thread, the picture
in the thread through the shipped image Element), undo and variations
later.

**The generation invariants (SAFETY.md), applied:** child profiles are
restricted by default and cannot invoke picture generation until an
adult unlocks it per person, never inherited; the adult unlock is the
one-time acknowledgment; child-safety checks on generation are
non-removable (every picture passes image safety before display or
persistence, as MEDIA-HOST-01 already states); no feature exists whose
purpose is imagery of identifiable real people (CHAT-MEDIA-01's people
path is adult-only and consent-shaped); no "uncensored" framing
anywhere in copy.

### 4. Order, sizes, and what moves between tiers

| Order | Item | Size | Needs from ENGINE-CONTRACT-01 | Needs from the acceptance workload |
|---|---|---|---|---|
| 1 | Voice: VOICE-01, VOICE-02, VOICE-03 | S, M, S | cancellation reaching the engine | a voice turn beside a typed one on the 24 GB Mac: first spoken word, peak memory, stop |
| 2 | Photos: VISION-01 | M | the vision engine's checks (image input, timing, cancellation, the pinned set) | a photo turn while a typed conversation runs: first useful answer, peak memory with the vision model loaded |
| 3 | Pictures: IMAGE-01, IMAGE-02 | M, S | none on the Mac (the engine is remote); the URL-tier health check | a picture job while a conversation runs: chat unaffected with the laptop, chat paused and resumed cleanly without it |

STUDIO-ACCEPT-01 becomes **the tier acceptance workload, run on tier 1
first**:
one voice conversation and one typed conversation at once, plus one
photo turn and one picture job in the same run, measuring first useful
answer, first spoken word, peak memory and cancellation, and setting the
concurrency and residency limits for that tier. Tier 2 and tier 3 rerun
the same workload and set their own limits; nothing else changes.

**What moves between tiers without redesign:** the role contract (`stt`, `tts`,
`vision`, `image` by role, never a model name), the on-demand admission
and eviction, the machine's budget and deployment limits, the chat
Elements and the composer slot. **What a bigger tier changes:** the vision
model stays resident, pictures draw on the hub itself and a second
machine's URL-tier address retires, and the chat role's budget is that
tier's model's own measured record.
