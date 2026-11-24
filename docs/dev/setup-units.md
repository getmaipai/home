# Setup units (the wizard's plan step)

The plan step lists one unit per Stack feature row (chat, pictures, video, music, stems, voice, vision, coding) plus the two parts the
hub holds itself (the face finder files, the video-from-pictures adapter). Each unit is one switch at its recommended level. There is no
per-model radio and no per-feature table in code.

- `shared/hubParts.json`: the units' ids, order, icons and copy keys. Nothing else.
- `shared/setupJobs.ts`: `buildSetupJobs` groups the disk plan's rows by their `feature` (the Stack names it on every row, rows/diskRowFeatures.json) and
  picks each unit's rows: the plan's default rows, or the first model row when the plan recommends none.
- `backend/src/lib/setupJobsState.ts`: the words (spec cards via `aiCopy`), the hub parts' state and whether a child or teen lives here.
- The picture model, the video level and music on or off are Stack level choices set after setup (Settings, AI and models). Setup writes no
  household setting; the four old keys keep their stored values (the picture and video slots are already Stack tiers).

Ported from the old job cards (`shared/aiChoices.ts`, deleted) before removal:

| Old behavior | Now |
|---|---|
| `defaultOn` (WAN-DEFAULT-01) | A row with `minors_only` is offered and starts on only when `householdHasMinors`; an adult-only home never sees it. Stack `POST /choices/recommended` takes `household_has_minors` for the same rule. |
| `blockedReason` | A hub part carries `blocked`; the wizard disables its switch and shows the line. |
| Licences | Unchanged: `PlanLicence` per row id, accepted in the step (LICENCE-ACK-01). |
| Unused / free-space view | Already served by the Stack (`GET /choices/unused`) in Settings; the wizard keeps `PlanDiskSummary`. |
| MODEL-ADD-01 (added chat) | Added models are Stack rows (`addedModels` on the chat feature); the wizard never listed them. |
| Wake word | Stack feature `wakeword`, not asked in the wizard (as before). |
| Sound effects as its own job | A row of the music feature; install it after setup from Settings. |
