# MaiPai Home: design record

Seeded 2026-09-03 from the platform plan (`purring-chasing-noodle.md`).
This repo is a fresh start on that design: chapter 0 explains why (build
fresh, do not migrate; decision 11), chapters 3 and 4 are the hub's
architecture, chapter 13 is the release roadmap. This file is the dev-tier
design doc; it grows as the hub is built.

## What happened to the old repo

The pre-rebuild hub's full history (244 commits of the Bun/Hono monolith,
~250 SQLite tables, 61 code tools, Ollama-based models) is preserved
outside GitHub: a full git mirror at `legacy-backups/home-legacy.git` next
to this repo on the dev machine, plus its 21 releases' metadata (tags,
notes, asset lists with sha256) in
`legacy-backups/home-releases-metadata/`. Nothing was migrated into this
repo. (This is a separate lineage from the older, already-archived
`loki-doki` repo, which predates the `getmaipai` org migration entirely
and is not part of this rebuild's reference set.) Per platform plan
principle 8, legacy code is a read-only reference for hard-won logic only
(resolvers, sync, limiters, drivers, measurements), never for feature
scope or UI; every legacy feature gets a one-line review verdict here
before anything is rebuilt (section 5.8).

The live legacy hub (on the MSI) keeps running until this repo's v0.1 is
ready to take over; nothing about this repo's rebuild has stopped it.

## What this repo is

The self-hosted family AI hub: the platform and the household's master
(identity, people, memory, the turn engine, settings, the package host,
the credentials center, backups, updates, the shell). Every feature ships
as a catalog package from `getmaipai/catalog`; this repo ships the default
set. Full architecture: platform plan chapters 1, 3, and 4.

## Step 0 status

- [x] Repo reset to a clean history, with LICENSE (AGPL-3.0), NOTICE, this
      design record, and `scripts/check.sh` pinned to `@maipai/standards`
      std-v0.1.0.

## Hub v0.1 status

- [x] `home/spec/` v0.1: JSON Schema for Person, Setting, Memory/Entity/
      Episode, the package manifest/recipe/result shapes, the error
      catalogue; the settings registry (empty, ready for the first
      declaration) and the capability/permissions vocabularies; UI schema
      v0 for Chat only; both recipe interpreters (TS and Python, kept
      behaviorally identical) and both host emulators; generated Zod and
      Pydantic v2 bindings for every schema, committed; fixtures that
      round-trip through both, plus recipe conformance fixtures proving
      both interpreters agree. See `spec/README.md`. Not yet done: cutting
      the `spec-v0.1.0` tag (nothing pins it yet, since `bot` doesn't
      exist as real content in this session) and the standards schemas
      import (`logging.json`/`trace.json`/`errors.json`/`budgets.json`/
      `privacy.json` from `@maipai/standards`, which doesn't have them
      yet either, per its own README's "later versions add" list).
- [ ] Core (identity, people, safety layer, memory, turn engine, settings,
      scheduler, package host, llama-server router) - not started.
- [ ] The shell and kit, Chat and Companions as packages, the wizard,
      backups, self-update - not started.
- [ ] README.md still needs the full org skeleton (logo, screenshot strip,
      status) once there is a running app to screenshot; today's README is
      a placeholder.

## Review queue

Every legacy hub feature gets a one-line verdict here before it becomes
part of the fresh build: rebuild as designed, redesign, merge, or drop,
with the reason (platform plan section 5.8, open item in section 15).
Empty until that review pass runs.

| Legacy feature | Verdict | Reason |
|---|---|---|
| _(none reviewed yet)_ | | |

## Roadmap

See platform plan chapter 13. Order: Hub v0.1 ("the family can chat"),
Hub v0.2 ("media and the store"), Hub v0.3 ("voice, devices, the link"),
then Robot v0.1 once spec v0.1 exists, then Go once three default packages
have schema pages.
