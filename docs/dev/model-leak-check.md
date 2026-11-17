# Model leak check (rule E8)

Rule E7 in [docs/design/RULES.md](../design/RULES.md): a model's own knowledge (names, limits, prompt wording, reference counts) lives in
its pack on the Stack, never in Home. Rule E8: a test enforces it. Record: [model-packs-2026-11-17.md](../design/model-packs-2026-11-17.md),
evidence: [model-packs-audit-2026-11-17.md](../design/model-packs-audit-2026-11-17.md).

**Run it:** `cd backend && bun run lint:no-model-names` (about a second; it reads files and starts no server). It also runs in every
`bun test` of `backend/`.

**What it does:** `backend/tests/modelLeakLint.test.ts` scans `backend/src`, `frontend/src` and `shared` (tests, locale files and `.po`
files excluded) for model brands, families and part ids (minimax, h3, h3_swap, flux, ltx, ace-step, wan, ernie, z-image, qwen, gemma,
pocket tts, chatterbox, kyutai, demucs, kokoro, parakeet, sdxl). A file that names one must be listed in
[docs/design/model-leak-allowlist.json](../design/model-leak-allowlist.json). `llama` is not scanned: llama.cpp is the engine, not a model.

**The allowlist only shrinks.** Each entry has the audit's verdict and a reason: `Stay` (Home's own logic, the word is incidental),
`Label` (a word on a card that HOME-PARTS-03 replaces), `Move` (the knowledge goes to a pack; `moveTo` names the MODELPACK-HOME row), or
`Deferred` (voice, chat and engine files the audit put out of scope; `moveTo` names the later pack). The test fails when:

- a file not on the list names a model (fix: use a generic job and the catalog, not a Home branch; never add an entry);
- a listed file no longer names a model (delete its entry; also lower `ALLOWLIST_CEILING` in the test to the new count);
- the list is longer than `ALLOWLIST_CEILING`, or has a duplicate, a missing reason, or a Move or Deferred entry without `moveTo`.

When a MODELPACK-HOME row lands, delete the entries it cleans in the same landing. MODELPACK-HOME-05 empties the list.
