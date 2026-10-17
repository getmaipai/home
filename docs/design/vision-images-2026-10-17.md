# Image understanding in chat: the pictures a person sends (2026-10-17)

Status: slice 1 built and proven on the Studio 2026-10-17. VISION-03a (Stack: the projector loads beside Muse), VISION-03b (Home: Muse records declare their projector, so image attach is on at p32, p64 and p128), VISION-03f (an installed record takes on its pin's projector declaration) and VISION-04 (pictures shrink to 2000 px, HEIC converts, the picture smoke script) are built. VISION-03c, 03d and 03e are open.

Jesse, live first run on the Mac Studio (M5 Max, 128 GB), 2026-10-17: the chat + menu will not let him pick image files. He chose
to design image understanding into the setup so image attach works. Design note plus the first slice; the architect verdict is at
the end.

## 1. What exists (from code, 2026-10-17)

The pipeline is built end to end and waits on one fact, whether the running chat process loaded a projector.

| Piece | Where | State |
|---|---|---|
| Attachment upload, storage, a picture part to the model | VISION-02c, `backend/src/lib/chatPictures.ts`, `chatImageNote.ts` | Landed. Sends OpenAI `image_url` parts (stored picture as a data URL) to the local engine only |
| The gate: who may send photos | `photoUploadsAllowed`: capability `upload.photo`, setting `chat.photo_uploads`, a child only after a parent turned it on | Landed |
| The capability flag | `chatModelReadsPictures()` reads the Stack's chat role row (`model.imageInput` true, `picture_tokens_max` > 0, state up); never a model id (rule 8) | Landed. This is why the + menu says pictures are off |
| Spec | `ModelCapabilities.image_input` (commons spec-v0.1.83) | Landed |
| Stack: projector launch, picture check, token bound, fit plan | `--mmproj`, `--image-max-tokens`, `supervisor.ts`, `engineArgs.ts`, `fitPlan.ts` (VISION-02b) | Landed, tested with Qwen3-VL-8B |
| A pinned model that reads pictures | Qwen3-VL-8B-Instruct (p16, selectable), Qwen3-VL-4B as a separate `vision` role (VISION-01b, measured not to fit a 24 GB Mac) | Landed, but **no tier binds a vision-capable model above 24 GB** |
| Describe-then-answer (a caption sidecar called by the context node) | VISION-01c | Retired in writing by VISION-02; never built |
| OCR (`host.ocr.read`, RapidOCR) | backlog "Vision" | Not built; not needed (see 3) |

**The gap.** Since STACK-MUSE-01 (2026-10-16) p32, p64 and p128 bind Muse Glimmer 30B as the chat model, and its pins declared no
projector. So on the Studio the chat process launches text only, `imageInput` is false, and the + menu correctly keeps pictures
off. Nothing in Home was broken. The tier plan simply never asked for a model that sees.

## 2. The options, measured on this Mac

**Finding that decides it:** the official `meta-models/Muse-Glimmer-30B-GGUF` repository, at the revision the Stack already pins
(`70bf1b61`), ships `mmproj-Muse-Glimmer-30B-Q4_K_M.gguf` (1,400,328,928 bytes, sha256 `f48b4523...f00c6`, Apache-2.0 repo). Muse
is natively multimodal (its card lists a perception encoder), and llama.cpp's multimodal path (`--mmproj`) runs it in the llama-server
build the Stack pins (b10797).

Test, 2026-10-17: a separate llama-server (port 18999, the live install untouched; the live Glimmer process kept running) with the
installed Q4_K_XL, the downloaded projector verified by sha256, `--image-max-tokens 2560`, 16k context, reasoning strength low.

| Image | Prompt tokens | Time to first text (prompt) | Whole reply | Result |
|---|---|---|---|---|
| App screenshot, 1440 x 900 PNG | 1,704 | 4.6 s cold, 0.15 s repeat | 20 s for 400 tokens at 22 to 26 tokens/s | Read the UI text accurately: brand, nav items, tabs, the chat bubbles, the times, the source line, the "Remembered" tag |
| Wallpaper art, 2000 px JPG | 2,567 | 7.0 s cold, 0.24 s repeat | 11 s for 103 tokens | Described the colour bands correctly |
| Same, asked "who is the person, give a name" | 2,570 (prefix cached) | 0.24 s | 3.7 s | Said there is no person; made up no name |
| Aerial photograph, 2000 px JPG | 2,551 | 7.4 s | 12 s for 103 tokens | Landmark, water, shoreline, light: correct |

Memory: the test process held 22.5 GB resident at 16k context (the live text-only process is 20.7 GB at 131k), so the projector and
its image buffers cost about 1.4 GB of weights plus a working buffer, in the same process. One picture is bounded at 2,560 tokens.
Generation ran at 21 to 26 tokens/s with a picture in context; a text-only comparison was not run here (slice 03c records it).

Not measured, and why: a real portrait (no licensed photo on this Mac; the bench photos in `data-scratch/vision-bench` live in the
main checkout of the machine that ran VISION-02e). Identity behaviour is covered by the acceptance bench in slice 03c, not claimed
here.

| Option | Verdict |
|---|---|
| (b) The chat model itself reads pictures through its own projector | **Chosen for p32, p64, p128.** One process, one pipeline, no branch, no second model to load, evict or keep warm; the keep-warm and the governor already account for the chat process, and the projector's bytes are already counted in the fit plan (`projectorBytes`). Cost: 1.4 GB on disk and in memory, one 2.5k-token prompt per picture |
| (a) A dedicated small vision model as its own role | **Not for these tiers.** Qwen3-VL-4B as a `jit` role exists (VISION-01b); measured not to fit beside an 8B on 24 GB, and above 24 GB it is a second model to load on a photo turn (cold load seconds) for a worse reader than the chat model. It also needs describe-then-answer, which VISION-02 retired. Kept as code, bound nowhere |
| (c) OCR or caption sidecars only | **No.** The chat model read the screenshot's text as well as an OCR pass would and described the photo. A sidecar adds a model, a branch and a second place a picture's content can leak |
| p16 (24 GB and smaller) | **Unchanged.** Qwen3-8B stays the bound chat; Qwen3-VL-8B (about 1 GB larger, Apache-2.0, already pinned with its projector) is selectable, and moving the p16 binding is the owner's go under VISION-02e. A small machine never holds a second vision process |
| Other open models (Gemma 3, SmolVLM, newer VL checkpoints) | Not re-measured. With the chat model's own projector in the repo we already pin, a third family adds a licence review, a pin and a bench for no tier that needs it |

## 3. The design

**Decision.** Muse Glimmer 30B declares its projector (`image_input`). The Stack pins the projector at the model's revision as a
`component: projector` of role `chat`; both Muse pins name it in `imageInput` and launch with `--image-max-tokens 2560`. The install
plan brings the projector with any bound model that declares one. Home's catalog mirrors the pin (same id, url, sha256, bytes). Nothing
else in the pipeline changes: when the projector file is installed, the next chat launch loads it, passes the picture check, and the
chat role row reports `imageInput: true`, so `chatModelReadsPictures()` and the + menu flip on their own (VISION-02c/02d).
Without the file the launch is text only exactly as today; no tier breaks.

**Safety and age (rule 0; SAFETY.md).**

- Age and surface gates are unchanged and still outrank this. A picture reaches the model only when `picturePartsAllowed` says so:
  the person's `upload.photo` capability, `chat.photo_uploads` on, a child only after a parent turned it on, a teen by the same
  setting, an identified speaker whose band is the account's own.
- An uploaded picture passes the same gates as text where text has them: the person's answer about it passes the output gate at their
  grain (a child's and every spoken turn per sentence, an adult's as it streams, a teen's by the admin choice). A minor's turn sends
  thinking off and drops any reasoning the engine returns (rule 2; Muse reasons every turn at strength low, so the drop is what applies).
  The band's topic block rides every minor turn. No learned image classifier decides anything (RULES-AND-LEARNED-COMPONENTS); the
  deterministic floor is unchanged.
- Residual, stated plainly: words inside a picture are read by the model, not by the typed-text floor, so for a minor the output
  gate and the topic block are the protection, as VISION-02d ruled. This note changes nothing there.
- Adult visual rules: this is understanding, not generation. No identity is claimed: the stable prefix line "You cannot tell who a
  person in a photo is." stays, FACE-02's household recognition is never called on this path, and no feature generates imagery of
  identifiable real people (SAFETY.md). The `image` role (picture creation) is untouched.
- Privacy: the picture goes only to the local chat engine through the Stack client, nothing fetches, no cloud vision API exists in this
  design. The model download follows "download, don't vendor": the Stack pulls the pinned file by url and revision and verifies
  sha256 and bytes; the record is the Stack pin plus Home's mirror.

**Memory and keep-warm.** There is no new resident or on-demand process, so there is nothing for keep-warm or the governor to
sequence: the projector's bytes are part of the chat launch estimate (`launchPlan`, `projectorBytes`), and a machine that cannot hold
Muse plus 1.4 GB gets a smaller admitted context, not a second model. p16 holds no vision process.

## 4. Slices (rows are in `docs/BACKLOG.md`)

| Row | What | State |
|---|---|---|
| VISION-03a (Stack) | Muse projector pin, `imageInput` on both Muse pins, install plan brings the projector. Tests `museVision`, `installPlan`, `chatVision`, `modelStore` | Landed, stack `6624365` |
| VISION-03b (Home) | Home's two Muse records declare `image_input`; test that they mirror the Stack pin | Landed with this note |
| VISION-03c | On the Studio: pull the projector, restart chat, confirm the role row says `imageInput: true` and `picture_tokens_max` 2560, open the + menu and attach a picture; run `backend/scripts/bench/vision-02e.ts` against Muse (ten photos, no identity claim, section 18 rows, 0 outbound requests, a child's picture turn) and record the table in `dev.md` | Open, needs the 1.4 GB pull |
| VISION-03d | First-run wizard sizing page lists "reads your pictures" for tiers that bind a projector, and says what the 1.4 GB is (SETUP-SIZE-01 owns the page; this adds one line of copy and the projector to its size total) | Open, behind SETUP-SIZE-01 |
| VISION-03e | Muse tool-calling and rewrite bench rows with a picture turn (STUDIO-EVAL-01 and the budget for the conditional tool set, rule 1) | Open, behind STUDIO-EVAL-01 |

## Supersedes

- VISION-01's "the `vision` role as a second llama-server, loaded when a photo turn starts" as the route for tiers above 24 GB.
  The role and its pin stay in the Stack, bound to no tier.
- The `vision` entry in p32, p64 and p128 `notAvailable` is left as is: it names the separate role, not picture input, which
  these tiers now have through chat.
- Nothing in `RULES.md` changes. VISION-02's ruling that chat reads pictures itself is extended from the p16 option to the
  tiers that bind Muse.

## Reuse check

Prebuilt option used: the model's own projector from its official repository and llama-server's `--mmproj` path, already wired by
VISION-02b. Considered and not used: a separate caption or OCR model (RapidOCR, Qwen3-VL-4B), because the chat model's projector
covers both jobs in the process that is already resident. No new Home code, no new component.

## Architect verdict

APPROVED, 2026-10-17 (item VISION-03b, covers 03a; rules 0, 1, 2, 4, 8 and 11 checked; opus architect, record `data-scratch/architect/VISION-03b.verdict`). Condition carried into 03c and 03e: the picture-turn rows run on the Muse record before the conditional tool set is trusted.
