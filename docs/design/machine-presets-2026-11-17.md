# Known systems: a shipped lineup per reference machine, auto-matched at install, closest-match fallback (2026-11-17)

Status: proposed, for the architect and then the owner's sign-off; no code before both. Owner idea (Jesse, 2026-11-17, in chat): "known systems/configurations with assigned configurations, then try to auto match and if not found guess and suggest this might be the closest match but you can customize." Builds on [model-packs-2026-11-17.md](model-packs-2026-11-17.md) (packs carry each model's measured numbers) and on rule E5 (the household's choice is stored once, by Home, never in a repo).

## Reuse check

The Stack already sizes a machine into four RAM tiers (`backend/src/profiles.ts`: p16, p32, p64, p128) and proposes one with `proposeProfile`; `tiers.ts` and the parts list's `fits` apply them. Those tiers are RAM bands built around Apple silicon. This note keeps them as the last-resort fallback and adds what they cannot say: the backend that runs the models (Apple graphics, NVIDIA, a Pi accelerator, CPU only) and a measured speed.

## 1. The problem

Memory size alone cannot tell a Mac Studio from a Pi with an AI HAT from a CPU-only laptop, and the owner cannot tell which models are proven on his own machine and which were only tried once or expected to run on a Pi. Two things are missing: an honest label per model per machine class, and one place that says what a machine of that kind should run.

## 2. Known systems (shipped data, in the Stack)

A **known system** is a data file `backend/src/systems/<system-id>/system.json`, validated at boot like a pack. It holds: the machine class it describes (backend, memory band, speed band), a plain name ("Mac Studio, M5 Max, 128 GB"), the lineup per feature (an ordered list of part ids: first Primary, second Secondary, then optional others) and the `measured` evidence it was proven on (model, tokens per second or seconds per item, peak memory, date). It never holds a household's name, a person's choice or an address. Reference systems to ship first: Mac Studio M5 Max 128 GB; MacBook Pro M4 Pro 24 GB; MacBook Pro M1 Pro 16 GB; Raspberry Pi 16 GB with the AI HAT; Raspberry Pi 8 GB; a 16 GB CPU-only Linux or Windows laptop. A system with no measurements for a feature lists the feature as `untested` and proposes nothing for it.

## 3. What the Stack detects

`GET /stack/v1/machine` (additive): `backend` (`apple`, `cuda`, `accelerator:<kind>`, `cpu`), `memory_for_models_bytes` (what the governor would let models use), `os`, `arch`, and `speed` from a short install-time test (tokens per second on the smallest installed chat model, measured once, kept, re-run on request). Detection reads the machine and the speed test only.

## 4. Matching

1. **Exact:** the machine's backend equals a known system's, its memory is within 10 percent and its speed band matches: propose that system's lineup, labelled with its name.
2. **Closest:** otherwise score every known system on backend match (required: a different backend is never "close"), then memory distance, then speed distance, and propose the nearest with the words "This looks closest to <name>. Check the picks below." and the differences stated plainly ("less memory than that system: the Secondary picture model is left out").
3. **None usable:** no system shares the backend: propose nothing by name; derive the lineup from the packs: for each feature, the parts whose pack lists the machine's backend as measured or estimated, ordered by priority, the first two as Primary and Secondary, every one marked proven, estimated or untested here.
4. The four RAM tiers remain as the memory-fit rule inside all three; they no longer decide the lineup.

## 5. Customization and where choices live

The proposal is the starting point of the setup wizard's model step (Primary first, Secondary optional, true sizes, one plain line each). The household's changes are its own `engines.<category>.order` in Home's settings (rule E5); nothing a person picks is written back to a known system. A person can re-run matching from Settings, AI and models, and can see "Proven on this machine" or "Estimated" or "Untested" beside every model, from the Stack's data.

## 6. Packs gain a field

A pack job's `peaks` already carry `measured` or `unverified`. Add `proven_on[]`: system ids (or machine classes) the job was measured on, with the number. The known system's evidence and the pack's `proven_on` are one record: the system file only references pack ids; the numbers live in the pack (one definition).

## 7. Build rows (proposed)

- **SYSTEM-SPEC-01** (commons): the known system record, the machine report, the match result; fixtures.
- **SYSTEM-DETECT-01** (Stack): `GET /stack/v1/machine` with the backend, usable memory and the install-time speed test; tests with fake hardware for the six reference machines.
- **SYSTEM-MATCH-01** (Stack): the matcher (exact, closest with differences, none) and `GET /stack/v1/systems/match`; tests per case.
- **SYSTEM-DATA-01** (Stack): the first known systems, written from real measurements only; a system or feature with no measurement says `untested`.
- **SYSTEM-WIZARD-01** (Home): the setup model step and Settings "re-run matching" draw the proposal; no model name in Home (rules E1, E7).
- **SYSTEM-PI-01** (Stack, research first): confirm what the AI HAT can run and in which format before a Pi system is written.

## 8. Risks

A known system with no measurement is a guess: it ships `untested`, never `proven`. The speed test must not disturb a running household (run at setup, or when idle). Named reference machines age: a new Mac matches the closest, with the difference said, until someone measures it.
