# Add a chat model from a Hugging Face link (2026-10-27)

Status: approved by the architect 2026-10-27. Item MODEL-ADD-01 (issue 252). The backlog entry was APPROVED 2026-10-27; this note settles
the questions that entry left open.
Owner record: Jesse, 2026-10-27, after switching the uncensored option three times in one day (each time a Stack pin, a Home
record, tests, two landings, a pin and a ship).

## Supersedes

This note retires and takes over these parts of other items:

- The global `CHAT_SAMPLING` constant and `chatSamplingFor`'s global default in `backend/src/lib/llm.ts` (slice S3). Rule 3 requires
  the move into per-model records; the Chat turn rules govern it.
- `ai-models-simple-2026-10-25.md` section 6 ("Free up space") stays the one removal path; section 7 below uses it and adds none.
- `CheckModelCard` (fit check for a pasted link) becomes the first step of the add flow. HOME-FIT-02 still removes the old card;
  this note supplies its replacement for pasted links.
- MODEL-SWITCH-01 open items on removal and on vetting: removal is section 7 below; vetting stays MODEL-VET-01.
- HOME-FIT-05 (deleting `fitsWithin`, `recommend`, `kvCacheBytes`) is untouched and still follows HOME-FIT-02 and 03.

## Reuse check

- **llama-server's own `-hf` download: rejected.** It downloads at launch, so the click and the download cannot be separated from
  the load; it does not check the repository's published hash against the file; it does not feed the disk plan or the install
  progress strip (rule S6). The Stack already downloads with `expectedSha256` (`lib/download.ts`) and Home already shows those jobs.
- **Reading a repository: reuse.** Stack `lib/hf.ts` (`resolveHuggingFace`, `@huggingface/hub`) gives the file list, size and
  LFS sha256. Stack `lib/fitPlan.ts` (gguf-parser) reads the layer shape from the file header with a ranged request, no full download.
- **Memory plan: reuse** `lib/fitPlan.ts`, `lib/diskPlan.ts` and the 086b5fb admission. Nothing new is invented for sizing.
- **Record shape: reuse** `ModelCapabilities` in `@maipai/spec`. No second record type (principle 4).
- **Removal: reuse** the "Free up space" dialog (`ai-models-simple-2026-10-25.md` section 6), `DELETE /api/components/:id`
  (`frontend/src/lib/componentsApi.ts`) and `backend/src/lib/aiUnused.ts` as the one guard. No second removal path.
- **Admin guard and progress: reuse** `requireRole("owner", "admin")` and the `InstallStrip` job feed.

## 1. One record, two doors

A model is one `ModelCapabilities` record whether it ships or a person adds it. Two additive spec fields (spec first, then Home):

- `origin`: `shipped` or `added`, plus `added_by` (person id) and `added_at` for `added`.
- `sampling`: every field `CHAT_SAMPLING` sends today (`temperature`, `min_p`, `xtc_probability`, `xtc_threshold`, `dry_multiplier`,
  `dry_base`, `dry_allowed_length`) plus optional `top_p`, `top_k`, `presence_penalty`, and a `source` naming where the values came
  from. A missing field sends nothing. This closes a gap with rule 3: sampling today is the global constant, not in the record.

Shipped records stay in `modelCatalog.ts`. Added records live in one Home table holding the same shape with the same id,
provenance and clock stamp. The catalog reader returns both, so every consumer (choices, fit, sampling, turn budget) reads one list.
`scripts/add-model.sh` and the Settings flow call the same Stack inspection (section 2), so they cannot produce different records.

## 2. Reading a repository (Stack)

New Stack route `POST /models/inspect { source }` (a Hugging Face link, or `repo` plus `file`). It returns, with no weights
downloaded: the file name, byte size, published sha256, licence (from the model card), architecture and layer shape (header
range request), and the sampling the repository publishes in `generation_config.json`, shown but never applied. Anything it cannot
read comes back as null with the reason, never a guess. Only `huggingface.co` links and its own file-delivery hosts are accepted.
The only outbound connection is to Hugging Face, made on the admin's click or the developer's command (PRIVACY.md outbound-connections
table gets one row for it; THIRD-PARTY-SERVICES.md: behave as the user would). `added_by` never appears in a log line or an admin
status line (rule 6a).

Features (rule 2 and rule 8): `thinking_mode`, tool calling and `image_input` for an added record come from what the Stack's engine
proves for that template (the inspect result plus the Stack's existing role `check` and picture check, later MODEL-VET-01). Anything
not proven stays off and is never guessed.

## 3. The person's flow (Settings, AI and models)

Placement: inside the `ai.glance` card's Chat row (its gear dialog, the pattern the glance note uses for Music), which already
draws `household.ai_chat`. No new group, card or view; the only key written is `engines.chat.choice`. Home writes no layout. All copy ("Not tested by MaiPai", "estimate", "Download and use", errors) is spec
copy, never hand-written in the page. Parts are shipped kit primitives only: `Input`, `Button`, `Badge`, `Item*`, `Progress`,
`AlertDialog` for the confirm, and `Alert` for a failure. There is no new `*Card` or wrapper component and no `className` override
(rule 9; `CheckModelCard` leaves the shrink-only wrapper baseline when HOME-FIT-02 removes it).

Admin or owner role only (server side `requireRole("owner", "admin")`; the control is not rendered for anyone else, and a minor
never sees model choice at all, rule 8). The steps:

1. Paste a link. Home calls inspect.
2. Show: model name from the repository, licence, file size, whether it fits this computer, and what it would replace in the
   chat job. An architecture the memory plan has not verified shows "estimate" and the dry run decides before load (section 5).
3. One button, "Download and use". The download is from the pasted link only, the file is checked against the published hash,
   and a mismatch deletes the file and shows the destructive `Alert` saying the file did not match the repository and to try again or
   pick another file.
4. The row carries the plain label "Not tested by MaiPai" until a measured record exists (MODEL-VET-01 and -02).

Progress shows in the existing install strip (rule S6). Every error says what went wrong and what to do.

## 4. The developer's command

`scripts/add-model.sh <repo> <file>` runs the same inspect, then writes the Stack pin (hash, size, disk-plan row), the Home
record with `origin: "shipped"`, and the tests for both, ready to land with `scripts/land.sh`. It never lands or ships on its own.
A shipped option is the same record a person would have added, plus the measured fields once benches exist.

## 5. Honest sizing before load

An added model is admitted by the 086b5fb path. For an architecture outside `VERIFIED_ARCHITECTURES`, the Stack runs the engine's
own dry run (`llama-fit-params`) before the first load and refuses to load when the result does not fit, saying how much
memory is missing. The 8 GB surprise 086b5fb found is the reason the file size and shape alone are never trusted.

## 6. Safety (rule 8, MODEL-VET-01)

An added record has no `turn_budget`, so the existing fail-safe applies (`model_transitions` false, no background turns). A minor's
turns on an added model keep their band's floor: no tools and no thinking. No non-admin and no minor can add, switch or remove a
model. Rule 3: an added record's sampling comes from its own record. With no values it sends no sampling keys (engine defaults) and
the source says "engine defaults, not tuned". The note relies on this reading of rule 3: the tool-decision measurement qualifies a
global override, not a model's own record with its source named. If Jesse reads it the other way (any unmeasured model on a turn
that offers tools), "Download and use" cannot put an added model into adult chat with tools and the rule needs his clarification.

## 7. Removal

Added models appear in the existing "Free up space" dialog as installed models and are removed through `DELETE /api/components/:id`
with `aiUnused.ts` as the one guard, exactly like shipped models. The model in use is already refused there. No separate Remove
action and no direct call to the Stack's `DELETE /models/{id}` from the page.

## 8. Slices

| Slice | Repo | Done when |
|---|---|---|
| S1 | commons `spec` | `origin`, `added_by`, `added_at`, `sampling` on `ModelCapabilities`; tag needs Jesse's yes |
| S2 | stack | `POST /models/inspect` with tests against recorded repository responses |
| S3 | home | Added-record table, merged catalog reader, sampling read from records. Shipped records carry today's values unchanged (temperature 0.7, min_p 0.05, xtc 0.5/0.1, dry 0.8/1.75/2) with source "Home's former global sampling (llm.ts), not measured per model"; `chatSamplingFor` keeps its skip rule (none when `response_format` or an explicit `temperature` is set); a test proves each shipped model's request body is identical before and after; the global constant is deleted in the same slice and the comments in `benchSampling.ts` and `persona.ts` are updated. Changing any value is a separate change needing rule 3's three measurements |
| S4 | home | Settings add flow, admin only, install strip progress, "Not tested by MaiPai" label |
| S5 | home | `scripts/add-model.sh` and its test |
| S6 | home | Added models listed in "Free up space"; no new removal code beyond listing them |

## 9. Not in this design

Training, quantising or converting models; vetting runs (MODEL-VET-01 and -02); model choice for minors; any non-GGUF format
beyond what the Stack already loads.

## 10. Owner decisions

- The spec tag for S1 (`commons`): only Jesse says yes to a new tag. S1 can land in its own worktree; the tag waits.
- The reading of rule 3's tool-decision clause (section 6), if Jesse wants it the other way.

## Built differently from the text above (S4, 2026-10-27)

- An added model is one more radio in the Chat card, id `chat.added.<modelId>`, beside Standard and Uncensored. It is chosen through
  `startChatModelChoice`, which pins from the model's own record; no `engines.chat.choice` model id is written, and no new setting key exists.
- The add panel sits in the Chat row's "Choose a model" dialog: paste, read (`POST /api/ai/models/inspect`, nothing downloads), confirm
  (`POST /api/ai/models/add`). Both routes are owner and admin only.
- The panel's words and the "Not tested by MaiPai" sentence are in the spec (`spec-v0.1.255`, the AI and models card's `copy`); Home holds none of them.
