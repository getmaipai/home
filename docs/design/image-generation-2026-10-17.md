# Pictures people make: image generation and editing in Home (2026-10-17)

Design note, written in the 2026-10-17 design audit. The engine side (runtimes, candidate models, the licence bar, the
ComfyUI sidecar, consent for household people) is decided in [the hub on Apple silicon](../plans/hub-on-apple-silicon-2026-09-17.md)
sections 2, 6 and 7 and the MEDIA-HOST and CHAT-MEDIA rows. The image editor tools (background removal, inpainting,
upscaling) have their own note, IMGTOOLS (2026-10-17). This note is the person-facing design those rows lacked: who may make
what, where it appears, what a person controls, what is stored. Rules in [RULES.md](RULES.md) and `SAFETY.md` govern;
nothing here asks for a rule change.

## Purpose

An adult asks for a picture in chat and gets one in seconds, on the house's own machine, with no company deciding what they
may draw. A child asks for a picture and gets one inside their band's ceiling. Generation is a chat action (the Apple silicon
plan, section 6: "no separate generation app is required"); the only screens outside chat are the person's gallery of what
they made and the settings an admin sets.

## Policy, stated once

- **Adults are adults.** An adult's generation runs with no content filter beyond the absolute lines, and adult-only
  adapters (LoRAs) are available to adults by default. There is no off-by-default adult switch and no "unfiltered mode"
  wording anywhere (SAFETY.md's copy rule); the one-time adult acknowledgment SAFETY.md already requires covers it.
- **The absolute lines, for everyone, no setting:** nothing sexual involving a minor or a minor-looking subject; and, as
  SAFETY.md states it, no feature whose purpose is generating imagery of identifiable real people. The household-people edit
  path with a consent record that [the Apple silicon plan](../plans/hub-on-apple-silicon-2026-09-17.md) section 6 sketches
  is a plan, not the rule: it is **not in this note** and is not built until Jesse amends SAFETY.md to name that exception.
  These lines are architecture, checked by the same classifier rule the plan names, never a word list (rule 1's spirit).
- **Adapters are classified, not trusted.** Every LoRA in the catalog carries `audience: all_ages | adult_only`; uncertain
  means `adult_only`. A minor's turn can only load `all_ages` adapters. The catalog lint refuses an adapter without the field.
- **Minors.** Generation is off for a child or a teen until a parent turns it on for that person (`generation.enabled`, a
  user override, per person, never inherited: SAFETY.md "child profiles are restricted by default", IMAGE-02's acceptance,
  hardware-tiers). Once on, it runs under the band's content ceiling (the same topic block as chat), on `all_ages` adapters
  only, with the output passing the safety floor before display, storage or export.
- **Surfaces.** A shared screen with a child possibly present (a TV, a pod) never shows an adult's generation; the result waits
  in the adult's gallery with a notification (rule 0's surface gate, SAFETY.md's reasoning rule applied to pictures).

> **Superseded in part (owner, 2026-10-17):** an adult may make a picture, video or style of a consenting household adult, and edit an uploaded photo of one. The design is [likeness-consent-2026-10-17.md](likeness-consent-2026-10-17.md); the absolute lines below otherwise stand.

> **Superseded in part (owner, 2026-10-17: "Teens can edit and create picture and video without annoying messages"):** a teen may make pictures and videos and edit pictures, on their own written screen, with nothing adult or sexual (the prompt gate and the finished-picture check refuse it in one short line), all-ages styles only, another person's likeness never (an adult's agreement is for other adults), their own photo for non-sexual edits, and no extra questions or warnings whatever the household setting. The design is the teen lane in [image-editing-2026-10-17.md](image-editing-2026-10-17.md); a child may make cartoon pictures and videos of safe things in a strict lane (owner, 2026-10-17: "Kids can make cartoon images and videos of safe content."), designed in the same note, section 9.

## Users and gates

| Person | Generates | Edits own pictures | Edits of real people | Adapters |
|---|---|---|---|---|
| Child | off until a parent turns it on; then within the band ceiling | same | never | `all_ages` only |
| Teen | off until a parent turns it on; then within the teen ceiling | same | never | `all_ages` only |
| Adult | yes, no filter beyond the absolute lines | yes | not in this note (SAFETY.md) | all, adult-only by default |
| Admin | the above; sets the models and the adapter catalog | | | |

## Screens and IA

1. **In chat (the main surface).** "Draw me a lighthouse at dusk" runs the `image` role; the thread shows the kit
   `image-generation` Element while the job runs (its `running` state stands in for queued and progress until upstream adds a
   numeric prop, as CHAT-MEDIA-01 already records) and the kit `image` Element for the result, with Variations, Try again,
   Edit (opens the IMGTOOLS actions) and Save to gallery in the Element's own action slot. "Make it sunnier" edits the thread's
   last picture. Undo is one tap and keeps the original (the plan's thread-asset rule).
2. **Gallery** (`/pictures`): the signed-in person's generated and edited pictures as the kit's media grid, newest first,
   each opening a detail sheet with the prompt, the model and adapter, the seed, the source picture when it was an edit, and
   Delete. Nobody sees another person's gallery, a parent included (NO-CROSS-USER-VISIBILITY-01, "images created"); a child
   shows a picture by sharing it (household storage's sharing).
3. **Settings, Pictures** (an app settings area, S4): the image model the Stack runs (read from the fit plan, never typed),
   the adapter list with its audience column, per-person `generation.enabled`, and a plain line on what is stored.
4. **Phone:** chat as it is; the gallery as a two-column grid; the detail as a sheet.

## Data and spec records (spec first)

- **`file` record** (exists): a generated picture is a `file` with `origin: generated`, `kind: image`, owned by the person;
  the storage caps and sharing of [household storage](../plans/household-storage-2026-09-23.md) apply unchanged.
- **Generation provenance (new, spec first):** `generation.schema.json`: `id`, `file_id`, `person_id`, `model` (id and
  revision), `adapters: [{id, audience}]`, `prompt`, `negative_prompt`, `seed`, `source_file_id`, `safety:
  {floor_passed, band}`, `licence_review`, `turn_id`, `provenance`, `hlc`. One record per output; the prompt is stored on the
  person's own record and never in a log (rule 6a).
- **Catalog manifest:** an adapter package (`kind: adapter` is the new manifest kind, spec first) carries `audience`, the
  base model it fits, its licence and a sha256; the catalog signs it like any package (PACKAGES.md).
- **Settings keys:** `generation.enabled` (user override; adults on, a minor off until a parent turns it on), `generation.adult_ack`
  (the one-time acknowledgment, per adult, SAFETY.md), `generation.watermark` (household, off by default per the plan).

## Offline and privacy

Everything runs on the hub or the paired engine computer over the existing engine link (PRIVACY.md). Model and adapter
downloads go through the Stack's one downloader and show on the privacy page as the existing pinned-download row; nothing
else leaves. No prompt, picture or provenance is ever sent anywhere. Backups: generated pictures follow the `file` record's
retention and the person's backup setting; the provenance record is `hot` with it.

Cross-app features (the [media apps blend note, section 12](media-apps-blend-2026-10-17.md#12-cross-app-platform-features-from-filetube)):
a generation job runs on the Stack's one heavy-job lane beside model downloads and media jobs, never a queue of its own; a
failed job notifies as `download_failed`-class time-sensitive; a deleted picture goes to the one household trash with restore.

## Kit Elements and parts (rule 9, 9b)

In chat: `image-generation`, `image`, `artifact-card` (ED-025's actions slot),
`error-state` inline for a failed job (rule 6: the model says in its own words that the picture did not come; the admin's raw
detail stays admin-only). Outside chat: the kit media grid (the `shadcndashboard` gallery block), `sheet`, `data-table` for
the adapter list, `SettingsShell`. No new kit part; no Home-drawn progress bar (the gap is upstream's, recorded in
CHAT-MEDIA-01).

## Slices

1. **PICTURES-01 (S, spec first):** `generation` and the `adapter` manifest kind in `commons`; the three keys; pin bump.
2. **PICTURES-02 (M, after MEDIA-HOST-01; it is IMAGE-02 and the first slice of CHAT-MEDIA-01, extended, not a second
   row):** generation in chat on the `image` role: the Elements, the thread asset, Undo, Variations, the provenance record,
   the per-person switch and the band ceiling and floor for minors, the adult acknowledgment on first use.
3. **PICTURES-03 (S):** the gallery and its detail sheet, per person only.
4. **PICTURES-04 (S):** Settings, Pictures: the adapter catalog with audiences, `generation.enabled` per person.
5. **PICTURES-05 (bench, rule 13):** the first-day media bench row: a child prompt within the ceiling after a parent turned
   it on, a child prompt refused while off, an adult prompt with an adult-only adapter, a refused real-person request, warm
   and cold 1024 px timings.

## Legacy verdicts (rule 8, one line each)

- Legacy "Image Studio" page with a prompt box and style presets: **dropped**; generation is a chat action.
- Legacy prompt-pack presets ("cinematic", "anime"): **dropped**; neutrality rule (SAFETY.md), the model and adapters carry
  style, presets curated toward a use are not shipped.
- Legacy per-image "safe" toggle: **dropped**; the gate follows the person (rule 10), never a toggle on an image.
- Legacy watermark on every output: **redesigned** as `generation.watermark`, household, off by default (the plan).
- Legacy gallery with household-wide browsing: **rebuilt** per person; nobody browses another person's pictures.
- Legacy "put me in the picture" face composition: **not built**; SAFETY.md's line on identifiable real people stands until
  the owner amends it.

## Supersedes

The open backlog line "Image generation (L): the design and model/licence bar now live in hub-on-apple-silicon" for the
person-facing half only; the engine half stays with that plan and MEDIA-HOST-01. IMAGE-02's acceptance (a child cannot
invoke it until an adult unlocks it per person) is kept and restated here, not changed. It does not change CHAT-MEDIA-01's
wire decisions. The Apple silicon plan's section 6 "household people and consent" is **not adopted** here; it waits on the
owner (SAFETY.md).

## Architect verdict

See the record `DESIGN-PICTURES-2026-10-17` in `data-scratch/architect/` (rules 0, 1, 6, 6a, 8, 9, 9b, 10, 13, S4; SAFETY.md).
First round REJECTED (child default, parent gallery view, the real-people line, overlap with IMAGE-02); this revision applies
all four edits. **Decision for Jesse:** whether SAFETY.md gains the household-people-with-consent exception the Apple silicon
plan sketches; until he says so, no such feature is designed or built.
