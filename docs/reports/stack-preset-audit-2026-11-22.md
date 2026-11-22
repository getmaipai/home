# Stack model preset audit for a 128 GB Mac (2026-11-22)

Scope: what the Stack ships as its model preset on a 128 GB computer (profile p128), and whether Home shows that preset as the Stack
sends it. This is the shipped preset only. Jesse's own lineup stays in his hub's Settings (rule E5) and is not in any repo default.

## Short answer

1. Settings, Coding listing one model is what the Stack sends. Home is not hiding anything. The Stack's Coding category has one model on
   purpose: Qwen3.8 27B, 19 GB. Coding has no levels of its own. Its Max level uses the Max chat model, which is Qwen3.8 Flash Next 177B
   on a 128 GB computer (Splash starts it in coding mode). The coding description now says so.
2. Home keeps no copy of model facts on the AI and models page. Two leftovers were found and removed (below). Everything else on that page
   is the Stack's answer.

## How the page was checked

A scratch Stack built from the current Stack `main` ran on its own port with an empty data folder (profile p128). Its `GET /stack/v1/choices`
answer was read for every category, and Home's dev hub was pointed at it. Home's Settings, AI and models was opened at desktop and phone width.

## Audit table (shipped preset, p128)

Order is the Stack's own order. "Recommended" is what the Stack picks when nobody has chosen.

| Category | Models offered, in order | Recommended | Finding |
|---|---|---|---|
| Chat | Qwen3 4B, Qwen3.8 27B, Qwen3 8B, Qwen3.6 35B A3B, Qwen3.8 27B (Huihui), Qwen3.6 35B A3B (Huihui), Qwen3.8 Flash Next 177B (Huihui) | Reduced: Qwen3 4B. Standard: Qwen3 8B. Boost: Qwen3.8 27B. Max: Flash Next 177B | The uncensored 27B was a part (and the model Splash serves for chat) with no row in the list, so no picker could offer it. Added as a Standard pick, never recommended. Its label also matched the plain 27B, so it is now "Qwen3.8 27B (Huihui)". Ornith 122B is gone from the Stack and from Home. Flash Next 177B is offered and is the Max pick. |
| Coding | Qwen3.8 27B (19 GB) | Qwen3.8 27B | Correct as one model. Description now says Max follows Max chat (Flash Next on 128 GB). No separate Max coding row, because a second place to choose the same model would break one definition. |
| Pictures | FLUX 3 Image Klein, MiniMax H3-Image, ERNIE-Image-Turbo, FLUX.2 Klein 4B, Z-Image-Turbo, Qwen-Image 20B | Standard: FLUX 3 (was MiniMax H3-Image). Boost: MiniMax H3-Image. Max: Qwen-Image 20B | Jesse's 2026-11-17 rule is FLUX 3 for the Stack and new installs. The part table already ranked FLUX 3 first, but the level table (written 2026-11-16) put MiniMax first, so the two disagreed. Level table fixed. MiniMax stays one choice away and stays the Boost pick. |
| Video | LTX-2.5 with sound (hidden), MiniMax H3, LTX-2.5 Max with sound, SAM 2.1 masks | Standard: MiniMax H3. Boost: none. Max: LTX-2.5 Max | Not changed. Rule says LTX-2.5 is the default for new installs, but the Stack holds plain LTX-2.5 off every level behind MODEL-VET-01. Lifting that gate is a quality decision (see open items). |
| Music | ACE-Step 1.5 | ACE-Step 1.5 | XL Turbo and XL SFT exist as parts but are not on a level. Matches the lineup note ("XL builds optional"). Not changed. |
| Voice | Chatterbox Turbo, Pocket TTS, VoxCPM2, VoxCPM2 (smaller), Chatterbox Nano | Standard: Chatterbox Turbo. Reduced: Chatterbox Nano | Correct. Fish Audio Drama 3 (kept by Jesse for Max and film work) is a part but not a voice choice, as before. |
| Speech to text | Moonshine Tiny, Parakeet TDT 0.6B v2 | Parakeet | Correct. Dropping Moonshine Tiny is a household choice, left to his Settings. |
| Embeddings | Memory and search model (Nomic) | same | Correct. |
| Vision | Qwen3-VL 4B, Qwen3-VL 8B | Qwen3-VL 4B | Correct as the shipped preset. Jesse drops the 8B on his hub only. |
| Wake word | Wake word | same | Correct. |
| Stem splitter | HTDemucs | same | Correct. |
| Safety checks | Qwen3 4B (category "checks" in the parts list, not a choice) | n/a | Correct. It is the same model as Chat Reduced. |

Retired and not listed: Ornith 1.5 122B and its draft (retired 2026-11-21), Muse Glimmer, Qwen3 1.7B.

## What changed

Stack (`getmaipai/stack`, commit 66c063a on GitHub `main`):
- Pictures: FLUX 3 is the recommended Standard model on a 64 GB computer or bigger.
- Chat: Qwen3.8 27B (Huihui) is a Standard pick on 64 and 128 GB, never recommended, never planned automatically.
- Coding description says its Max level uses the Max chat model.
- Tests for each, and the generated disk plan updated.

Home (this worktree, see "Where it is"):
- Removed the Voice engine card from Settings, AI and models, Advanced. It was a hand-kept list of three voice engines with Home's own
  names and sentences, and a Home route behind it (`/api/voice/engine`). The Stack's Voice category already lists VoxCPM2 and picking one
  sets the same Stack setting, so the card was a second copy.
- Install strip (`installWords.ts`): removed the product names it kept by hand. It named any FLUX model "FLUX.2 Klein", any Wan model
  "Wan2.2", and still had lines for Muse Glimmer and Qwen3 1.7B. It now says what a part does and never which product.
- New tests: a model the Stack starts listing appears on the page with no Home change; no Settings source names a model family; no
  install line carries a product name.

## Home reads model facts from the Stack: how it was checked

Names, descriptions, sizes, order, recommended flags and states on Settings, AI and models come from `GET /stack/v1/choices` through
Home's forwarder. Home adds only who may use each level, and storage and backup links. A new Stack model (Qwen3.8 27B (Huihui)) showed up in the
Chat sheet with no Home edit, which is the proof.

## Open items (not done here)

1. **Plain LTX-2.5 as the video default.** Jesse's rule says LTX-2.5 for new installs. The Stack keeps it off every level until
   MODEL-VET-01 finishes. Needs his word to lift the gate.
2. **Setup wizard plan cards** (`shared/aiChoices.ts`) still hold hand-kept names and sentences (for example "Muse Glimmer 30B picture
   reader", "Hey Jarvis wake word", "LTX 2.5 Ingredients adapter 0.9"). It is the first-run screen, not Settings, and is its own task.
3. **"Model per job" card** on Advanced shows `engines.<role>.choice` keys ("Options are not available here", always auto). It comes from
   the settings spec in `commons`, so it needs a spec change first. Home's capability code still reads those keys.
4. **Style (LoRA) pages** name the base video model a style was trained on. That is a file compatibility fact, not a choice, but the names
   are typed in Home.
5. **Two older frontend tests already fail on `main`** (child and teen "nobody gains a key" snapshots) and one lint (CompanionsPage font
   size). Not touched.
