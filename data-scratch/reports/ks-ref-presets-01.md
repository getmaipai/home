# KS-REF-PRESETS-01 report

## Delivered

- Added `POST /api/reference/plan`, `POST /api/reference/apply`, `GET /api/reference/state`, per-set install/remove, and job pause/resume/cancel routes in `backend/src/routes/reference.ts`, all owner/admin only and described with `@hono/zod-openapi`.
- Added preset/custom planning and durable job orchestration in `backend/src/lib/referencePresetEngine.ts`. Catalog size, sha-256 and snapshot come from `resolveReferenceFlavour()`; estimates use `reference.update.max_mbps`; plans enforce a 20 percent remaining-free-space margin.
- Added a single location seam in `kiwixSidecar.ts`, resumable job state and startup recovery, child-eligible sets before Wikipedia, nightly quiet-hours gating, and download rate limiting in `modelDownload.ts`.
- Added safe removal of installer-owned ZIM files and metadata, followed by library regeneration/reload when Kiwix is registered.
- Added pinned reference preset settings to the backend settings registry, generated `docs/api/openapi.json`, documented the implementation in `docs/dev.md`, and marked the backlog row complete.
- Added `backend/tests/referencePresets.test.ts` for all preset plans, margin refusal, order, idempotency, interrupted state recovery, window gate, offline-mode warning, remove ownership and child 403.

## Decisions

- Used the pinned `@maipai/spec` v0.1.142 `reference-presets.json` as the bundle source.
- The plan's 20 percent reserve is 20 percent of the current free bytes on the selected volume; planned downloads are refused when they would leave less than that reserve.
- Queue state is stored as `.reference-jobs.json` in Home's configured reference library. ZIM transfer bytes continue to use the existing `.part` Range resume and publisher hash validation.
- The API state reports a preset when all of its set members are installed, independent of `search.source_mode`.

## Open questions and limitations

- `data-scratch/design/KS-REFERENCE-PRESETS-DESIGN.md` and `data-scratch/architect/KS-REF-PRESETS.verdict` were absent from this worktree. `data-scratch/` is gitignored, so approval details beyond the brief could not be reviewed.
- Source-to-Kiwix book/flavour mappings are based on existing source IDs and expected Kiwix names, but live public-catalog verification was not run. Tests use a local shaped fixture catalogue.
- The selected location is accepted by plan, apply, and per-set install, and is stored per queue. The existing sidecar's configured library reload still follows `reference.library_dir`; fully relocating the serving sidecar is part of DATA-LOCATION-01f and remains outstanding.
- No frontend, setup wizard, commons, or full `scripts/check.sh` run was included, as requested scope limits this slice to backend/docs and the requested preflight gate.
- Optional `location` is plan-only: apply and per-set install write to the configured serving library so the sidecar, ownership records and downloaded files stay aligned. A future placement implementation can make the chosen drive a persistent reference-class location through the existing resolver seam.
