# Tier families and option-only tiers (2026-10-30)

Status: proposed, not decided, not built. Item id TIER-FAMILY-2026-10-30 (amends TIER-SPEC-01, TIER-STACK-01, TIER-EVAL-01 to 06, TIER-HOME-04). Owner's
ask (Jesse, 2026-10-30): keep each category's tiers in the same model family where we can (Chatterbox Nano and Chatterbox Turbo are the example), and
let one model serve more than one tier through options such as thinking on or off. Amends [resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md)
sections 3a, 4 and 5.

## 1. Answer

1. **A slot holds a model and its options, not only a model.** Today a slot is a catalog candidate id (tiers note 3a). It becomes `{ model, options }`.
   Chat Standard can be one model with thinking off and chat Boost the same weights with thinking on and a longer budget: no load and no swap, only a
   larger thinking cache (F3), so Boost starts at once.
2. **Prefer one family per category across its tiers.** Same family means the same look, voice and behaviour at every tier, and a swap that is
   probably cheaper (to be measured, F4). Family is a tie-breaker after the quality and licence gates; a clear measured quality win outranks it.
3. **The governor prices a tier by how it is reached:** an option switch (free), a same-family swap (time unverified until measured), or a
   cross-family swap (a full load). The card's time estimate and the admission figures use that cost.

## 2. Slot record

`engines.<role>.tier.<reduced|standard|boost|max>` = `{ model: <candidate id or "recommended" or "off">, options: { ... } }`. Options are typed per category
by the spec, so they are data the settings page draws as plain switches:

| Category | Options (typed in spec) | Example |
|---|---|---|
| Chat | `thinking` (off, on), `reasoningBudget` (the existing `--reasoning-budget` row, CHAT-TPS-03). A draft model is **not** an option, see F7 | Standard: Qwen3.8-27B thinking off. Boost: same weights, thinking on, longer budget. Reduced: the small Qwen3 sibling |
| Pictures | `steps`, `guidance`, `resolution` | One family: Turbo steps for Standard, more steps for Boost, base weights with guidance for Max |
| Video | `steps`, `resolution`, `lengthSeconds`, `sound` | LTX-2.3 distilled for Standard and Boost with different resolution and length, the dev two-stage build for Max |
| Music | `steps`, `planner` | ACE-Step turbo, XL turbo, XL base |
| Voice | none (family only) | Chatterbox Nano for Reduced, Turbo for Standard, same reference clip and nonverbal tags, so a household's cloned voice stays recognisable |

The per-turn reasoning effort stays its own dial (tiers note section 3, "keep two axes apart"). The tier sets the **default** options for a
conversation; a person's per-turn effort still wins.

## 3. Rules

- **F1. Family grouping.** Catalog candidates carry a `family` field. The AI and models dialogs group candidates by family and say what staying in a family
  buys: "Same voice and look at every level, and quicker to switch."
- **F2. Option-only tiers are real tiers.** A tier whose model equals another tier's differs only by options; it is shown (it behaves differently). The
  tier collapse rule of the tiers note (section 4, and 3a rule 1 "Same as Standard, so Boost will be hidden") is narrowed: a tier is hidden only when its
  model **and** options are identical to the tier below.
- **F3. Footprint per option set.** A measured peak belongs to a model plus an option set (thinking on grows the KV cache; more steps change time, not
  weights). The governor admits from the peak of the chosen option set, never from the label.
- **F4. Switch cost classes.** `option` (per request, no cost), `family` (unload and load within one family; the time is measured by the evaluations and
  stays "unverified" until then, since two family members usually share no weight files), `cross` (full load). The live fit (profiles note 3b) prefers an option or family move before a cross-family move when it steps a category down or up.
- **F5. Identity continuity.** Voice and companion looks must stay recognisable across tiers; a family swap is only offered between tiers whose outputs
  are measured close enough with the same reference input (the voice evaluation does this for Nano and Turbo).
- **F6. Minors.** Thinking is off for every minor on every tier whatever the slot's options (RULES.md rules 2 and 8). The no-tools fail-safe applies to a model with no measured record. No option an admin sets reaches a minor.
- **F7. Only catalog candidates** (rule 11). A draft model for speculative decoding is a **launch setting**, not an option: CHAT-TPS-02 measured it as set when the engine
  starts (`-md`), +2.2 GB resident, and no gain alongside picture understanding, so the Stack change is held on Jesse's open choice between pictures and the draft.
  This note leaves that choice where it is; TIER-EVAL-05 may re-measure it, and the decision stays his.
- **F8. Sampling and tools per option set (RULES.md rule 3).** Sampling for each option set comes from the model's catalog record (thinking on and off can call for different sampling). A new chat option set that offers tools needs the rule 3 tool-decision measurements before it fills a slot.
- **F9. The window builder sizes the thinking allowance from the active option set** (rule 4: the window reserves room for the thinking allowance), so a Boost with thinking on still fits its context.

## 4. What changes in the plan

| Row | Change |
|---|---|
| TIER-SPEC-01 | The slot record is `{ model, options }` with typed options per category, plus `family` on catalog candidates and `switchCost` classes. Migrate the existing `generation.picture_quick_model`, `generation.picture_detailed.enabled` and `engines.<role>.choice` into it |
| TIER-STACK-01 | The resolver returns `(model, options, switchCost)`; candidates carry `family` and per-option-set peaks (measured or marked unverified); the collapse test is "same model and same options" (this replaces the row's "same model as the one below") |
| TIER-EVAL-01 to 06 | For each category compare "same weights with options" against "a different model" for Boost, and "same family" against "other family" for Reduced and Max; record peak memory, time and quality per option set (chat: thinking on peak and speed; voice: Nano against Turbo with one reference clip; pictures: ERNIE Turbo steps against Z-Image; video: LTX distilled settings against Wan; music: ACE-Step family) |
| TIER-HOME-04 | The gear dialog shows options as plain switches ("Thinks longer", "More detail") and groups candidates by family |

The tiers note's current proposals that cross families (pictures Boost on Z-Image, video Standard on Wan, voice Reduced on Pocket) become **candidates to compare** until the evaluations decide; they are no longer the defaults.

## 5. Reuse check

Prebuilt options considered: llama.cpp and MLX server options for thinking (used as the engine provides them, only through the Stack's tested set, rule 11; the measured draft-model facts of CHAT-TPS-02 are in F7); model-card option names (adopted as the typed option names where they exist). No library replaces the slot record; it extends the
settings registry and the Stack catalog already planned.

## 6. Rules check

Rule 4: no chat context change; the window builder sizes the thinking allowance from the option set (F9). Rules 2 and 3: F6 and F8. Rule 8: minors' floors unchanged (F6). Rule 11: catalog candidates only. S4: options are typed in the spec and drawn
by `SettingsShell`. Privacy: no new outbound connection.

## Supersedes

- Tiers note section 3a ("one record per slot ... values `recommended`, a catalog candidate id, or `off`") becomes `{ model, options }` (section 2 here); the old values map to a model with default options.
- Tiers note section 5 proposals that cross families (pictures Boost Z-Image, video Standard Wan, voice Reduced Pocket TTS) are candidates to compare, not defaults, until the evaluations decide.
- Tiers note section 5.1 ("Boost: a stronger model loaded on demand") may be the same model with different options.
- Tiers note section 4 and 3a rule 1 (collapse when the model is the same as the tier below) narrow to "model and options identical" (F2).
