# Will it run here? The fit verdict on every model, in Home's own look (2026-09-30)

For Jesse. The Stack can now answer, before anything is downloaded, whether a model will fit this computer (`POST /stack/v1/fit-plan`, for a Hugging Face GGUF file, a GGUF file already in the model store, or an MLX repository). Home has no screen that asks it. This page says what the screens are, what they read, and what they are made of. It exists because a person choosing a model has one real question, "will this run on my machine, and how well", and today Home answers it with a memory rule of its own (`fitsWithin` in `backend/src/lib/modelCatalog.ts`) that the Stack's design already names as a second copy to retire.

## Where the ideas came from, and what we did not take

RigSpark (a public tool, MIT, read for design only, none of its code or assets used) answers the same question well in three places: a list where every model carries a verdict, a detail page with the sizing numbers laid out plainly, and a report you can share. We keep those three shapes. We do not take its composite 0 to 100 score with quality, recency and capability weights (the weights are a judgement, not a measurement, and a fit verdict should be a measurement), its dark palette and mascot (Home has its own look and its themes), or its live speed figures (our speed numbers stay "not measured yet" until a bench row exists).

## What every screen reads

One shape, `StackFitPlan` (spec-v0.1.60): a verdict (`yes`, `slow`, `no`, `unknown`), the bottleneck, one line per role with its peak, the total, the cap and margin, one entry per way to run it (unified memory, one GPU, several GPUs, CPU offload, CPU) each with its own verdict and the shortfall in bytes, and on every number a low, a high, a source (`measured`, `dry-run`, `estimated`, `unknown`) and a date. Home's backend asks the Stack (loopback, the Stack runs beside it) and never sizes anything itself. Home words the answer; it never changes the numbers.

The words, in the dad test's terms:

| Verdict | Home says | Colour token (status pill) |
|---|---|---|
| `yes` | Runs well on this computer | teal (Ready) |
| `slow` | Runs, but slowly | orange (Attention) |
| `no` | Won't fit, needs about 6 GB more memory | red (Error) |
| `unknown` | Can't tell yet: nobody has measured a model like this on a computer like yours | secondary (Idle) |

An unknown answer is never dressed up as a no or a yes. A number that is an estimate says so in its tooltip with its source and date.

## The screens

1. **The model list gets a verdict on every row.** The model picker and the Models page show the status pill above and one short reason under the name ("about 3 GB of your 16 GB, with room to spare"). A search box filters as you type, and one switch, "Only models that fit", hides the rest.
2. **The sizing strip above the list.** Three controls change every row live: how much conversation to remember (a slider over the model's real limit, from the plan's context length), how the memory is used (Full, Quantized, Auto, the KV rule in `docs/dev.md`), and the switch above. Changing one re-asks the Stack; the rows update in place.
3. **The model's fit panel.** A card with the plan laid out: memory needed (a range), memory available now (what is loaded, what is free), the way it would run, what limits it, and where the number came from and when. When it will not fit, the panel says what would make it fit (a smaller size, a shorter memory, turning something off) using the plan's shortfall and the per-role list.

Home's first panel uses the shipped `SpecSheet` and `RecommendationCard`; source dates appear beside each measured figure.
4. **The computer beside the list.** A narrow card that stays in view: memory used by what is loaded now (one line per role), what is free, and the computer's usable limit. It reads the Stack's budget route; it is the same numbers the plan used.
5. **Compare and copy.** Mark two or three models, see them side by side, and copy a plain-text summary a person can paste into a message to a friend ("what can my computer run"). Nothing leaves the house unless the person pastes it.

Home uses the shipped `ComparisonCard` for model names, verdict headlines and memory needs, with the shipped `Button` and read-only `Textarea` for copying and its fallback.

The first-run wizard's sizing page (SETUP-SIZE-01) is screen 3 and 4 with the proposal and the step-down on top; it uses the same route and the same words.

## What it is made of (the no-hand-built-UI rule)

Every piece is a shipped part of the kit or the dashboard set, restyled only by the tokens, so any theme package restyles it with no extra work: the icon-tile metric cards and panel headers (screen 4), the status pill (verdicts), `model-picker`, `model-selector` and `data-table` with `command-palette` for search (screens 1 and 2), `range` and `context-display` (the context slider), `context-breakdown` and `spec-sheet` (the fit panel), `comparison-card` and `recommendation-card` (screen 5 and the "what would fit" line), `confidence-marker` and `inline-citation` (the estimate marker and its source), `number-ticker`, `empty-state`, `loading-state` and `error-state`. The one gap, named here before a line is written: a verdict pill that carries its one-line reason. The smallest composition of shipped parts wins: the status pill and the `confidence-marker` side by side in one row, no new component.
Home uses the shipped `IconTile`, `Progress` and `SpecSheet` parts for “Memory right now”, backed by `GET /api/computer-memory`.

Standing rules that apply: the phone is the same design as the desktop, optimized for the small screen (`feedback_mobile_same_design`); every expand and collapse animates; screenshots are generated from the seeded demo household and opened and looked at before they are used anywhere; no household facts in any fixture.

## What has to exist first

The Stack side is built and landed: the route, the planner for both engines, the KV rule, the budget route. Home's side needs its own small client and proxy first (HOME-FIT-01). Nothing here waits for Home to move onto the Stack (STACK-16): the Stack already runs beside Home on the Studio bench.

## Limits we are stating up front

Only one architecture family is verified for numbers today (`qwen3`), so most models will read "can't tell yet" until the Studio bench adds rows; that is the honest state, and the wording makes it plain. The MLX numbers come from one measured model. Speed is not measured, so no tokens per second appear anywhere.
