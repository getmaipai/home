# The Stack stores model facts and model choices; Home is a screen over its API (2026-11-21)

Status: accepted 2026-11-21 (architect: NEEDS-RULE-CHANGE; Jesse approved the E5 edit in the question box). Owner rule (Jesse, 2026-11-21, final).

## Supersedes

- Engine boundary rule E5 in `docs/design/RULES.md` ("The household's choice is stored once, by Home ... and sent to the Stack"). It becomes: the choice
  is stored once, by the Stack; Home reads and writes it through the Stack's API.
- The sentence "Home is its only caller" and "no users, no operator login" in the 2026-09-20 entry of `.github/docs/DECISIONS.md`, in one way
  only: the Stack gains a choices API that Home calls. The Stack still has no people, no login of its own and no LAN exposure; Bot may call
  the same API. Home stays the only caller that speaks for a person.

- Section 4 of [stack-home-catalog-separation-2026-11-16.md](stack-home-catalog-separation-2026-11-16.md) ("Home pushes the value to the Stack; the Stack stores no household"):
  the Stack now stores the household's model choices.

Everything else in that note and the model packs note stands.

## The rule

The Stack works on its own, without Home. It stores every model fact (already true: part rows, packs, measured peaks) and every model
choice: model order per category, disabled models, per-tier picks (Standard, Boost, Max, Reduced), and per-hardware-profile assignments
(for example Mac Studio M5, 128 GB). Home keeps no model preference of its own. Per-person access ("who may use each level") needs people, so it
stays in Home.

## Why

1. A model listed in the Stack must appear in every Home picker by itself. Today Home keeps its own slot settings (`engines.*`, `slot.*` rows read by
   `backend/src/lib/tiers.ts`, written by `aiChoices.ts`) and a hand-kept voice option list, so VoxCPM2 is in the Stack but not in the Voice picker.
2. Bot runs the same platform code and should get the same picks without Home.
3. One place per choice (platform principle 4).

## Design

- **Stack tier table** (`backend/src/lib/tiers.ts` in the Stack) is the one list of candidates per category and tier. A model is added by one row
  there (plus its part row and pack); `GET /tiers/<category>` already serves it and Home's picker renders whatever it returns. First row: `voxcpm2-bf16`
  and `voxcpm2-4bit` under voice.
- **Choices API** on the Stack: `GET /choices` (all picks, order, disabled list, per-profile assignments) and `PUT /choices/<category>/<tier>`
  (validates the part exists, fits the profile and is installed or installable). Stored in the Stack's own settings store.
- **Home** renders the Stack's answer and writes through the API. It adds per-person access only. `lint:no-model-names` keeps Home free of part ids.
- **Migration, no data loss:** on first boot after the change Home sends its existing slot and engine values (`engines.*`, `slot.*`) to the Stack
  once, the Stack stores them and marks the migration done, then Home deletes its copies. A value the Stack refuses is kept in Home and shown
  as a plain notice, never dropped.

## Reuse check

Considered: keeping Home's slot settings and adding a hand-kept option per model (what failed for VoxCPM2); a Stack-side key-value store
beside the existing `settings.ts` store; a new database. Chosen: the Stack's existing settings store and its existing `GET /tiers/<category>`
route and tier table, plus two thin routes. No prebuilt library fits a per-hardware choice table. No UI change: the pickers already render the
Stack's answer, so no kit Element is touched.

## Build steps

1. VOICE-VOXCPM2-01 (now): add the two VoxCPM2 rows to the Stack tier table; check Home's pick sets `stack.voice.engine`. Needs no new API.
2. Stack choices API and its tests.
3. Home reads and writes choices through it; migration; delete Home's slot settings code.
4. Remaining pickers (chat, pictures, video, music) confirmed to need no Home edit per model.

## Open for the architect

E5 and the DECISIONS entry are the two items this changes. Both carry the owner's word of 2026-11-21; the rule edit will carry
`Owner-approved: 2026-11-21`.
