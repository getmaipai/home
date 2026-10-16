# SPEAK-01 settings route test fix

The settings test fixture now answers the voice sample list request with an empty array, matching its existing face-print list mock. This keeps the enrollment card's production behavior unchanged and lets the shared profile/settings tests render its `AsyncState` with the expected list shape.

Validation:

- `cd frontend && bun test` - 2,018 pass, 1 skipped, 0 failures across 229 files.
- `cd frontend && bun run lint:ui-rules` - 23 pass, 0 failures.
- `MAIPAI_COMMONS_DIR=/Users/jessetorres/Developer/github.com/getmaipai/commons bash scripts/check.sh --pre` - passed, frontend scope.
