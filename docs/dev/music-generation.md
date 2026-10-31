# Music generation (developer notes)

Dev tier. The design and every measurement are in [the music design note](../design/music-generation-2026-10-17.md); this page is the
code map for working on it.

## Where the code is

| Part | Files |
|---|---|
| Gate (adults only, own adult lane, surface lines, household switch `generation.music.enabled`) | `backend/src/lib/music/policy.ts`, `backend/src/settings/musicKeys.ts` |
| Tools (`generate_music`, `edit_music`) and the change map (remake, restyle, instrumental, rewrite_section, extend, variation, trim, fade, loudness) | `backend/src/lib/music/tool.ts`, `backend/src/lib/music/sections.ts`, `backend/packages/generate_music/`, `backend/packages/edit_music/` |
| Turn wiring (offer gates `musicAllowed` and `musicEditAllowed`, policy node, tool node, ghost-claim guard) | `backend/src/lib/turnMachine/budget.ts`, `nodes/policy.ts`, `nodes/tool.ts`, `backend/src/lib/mediaClaims.ts` |
| Jobs, watcher, stored versions, provenance | `backend/src/lib/music/jobs.ts`, `store.ts`, `types.ts`, `models.ts` (Stack model id to licence and commercial clearance) |
| Stack client (`GET /stack/v1/music` is wrapped as `{ music }`) | `backend/src/lib/music/stack.ts`, `ready.ts` |
| Commercial export check | `backend/src/lib/music/commercial.ts` |
| Routes | `backend/src/routes/music.ts` (`/api/music/status`, `/jobs/:id`, stop, `/use`, `/jobs/:id/files/:fileId` with Range, `/files/:fileId?purpose=commercial`) |
| Table | `music_jobs` in `backend/src/db/schema.ts`, migration `0113_music_jobs.sql` |
| Card | kit `MusicTrack` (commons `ui/src/elements/music-track.tsx`), bound in `frontend/src/apps/chat/chatToolUis.tsx` (`MusicToolRender`, part name `song`), client `frontend/src/lib/musicApi.ts` |
| Stack engine | Stack `backend/src/music/*` (worker `music_worker.py`, ACE-Step 1.5 pinned by commit and hash), routes `/v1/audio/music` and `/stack/v1/music`, component `ace-step-1-5-turbo` (group `music`) |

## Rules to keep

- Music never follows the picture lanes: a teen or child is refused in `musicViewDenial` before the picture gate is consulted.
- The description, lyrics and title live only on the person's `music_jobs` row; never in provenance, a log line or an error.
- An edit's source is a song this person made in this conversation; its bytes go to the Stack unchanged with their sha256 (the Stack refuses
  anything it did not make).
- The chat model writes the lyrics without a line count. `secondsForWords` allows 6 seconds per sung line plus 10 (at least 30); `hookOf` selects Quick through the first chorus. A squeezed ending triggers one retry at 30 percent longer, up to the Stack ceiling, through normal admission.

## Stems (TIER-STEMS-01)

`edit_music` with `change: "stems"` splits a song made in this chat into vocals, drums, bass and other (design: `docs/design/stem-splitting-2026-10-30.md`).
It is a task of the existing tool, so the turn's tool count stays 16. Home sends the song to the Stack's `POST /v1/audio/stems` (the `stems` component,
Demucs `htdemucs`, MIT; the pinned checkpoint and its sha256 are in the Stack's `modelCatalog.ts`), then `finishStems` in `lib/music/jobs.ts` stores each stem as a
song with `provenance.parent_file_id`, so the commercial-use check follows the parent. One `music_jobs` row per stem (task `stems`, `request.stemsOf` is the
split's job id); a stem is never a version of its song (`musicVersions`) and the card of a finished split steps through its stems. The song card's
Edit popover has a Stems tab that calls `POST /api/music/jobs/{id}/stems`; that route logs its own "Split into stems" turn (the chat lists one music card per turn) and the card reloads the thread, then opens on the first track with its title following the shown stem. First real Home-to-Stack run: 2026-10-30, scratch Stack, a 20 s song split in four tracks. Only songs made here are accepted; uploaded audio waits on MUSIC-GEN-14 (TIER-STEMS-02).

## Try it on a scratch Stack and Home

Never against the live Stack (8770) or Home (3000). Take `mkdir /private/tmp/claude-501/bench.lock` for any model run and remove it after.

1. Run a Stack from a Stack worktree with its own data folder: `STACK_DATA_DIR=<folder> PORT=8895 bun run src/index.ts` in `backend/`.
2. Install the music component: `POST /stack/v1/components/ace-step-1-5-turbo/install`; install a small chat model the same way and its
   `llama-server` engine (`POST /stack/v1/engines/llama-server/install`), then load it (`POST /stack/v1/models/<id>/actions {"action":"load"}`).
3. Run a Home from a worktree: `PORT=8896 MAIPAI_DATA_DIR=<folder> MAIPAI_HUB_LOCK_PATH=<folder>/hub.lock MAIPAI_STACK_PORT=1 bun src/index.ts`
   in `backend/`, sign up a test person, then set `engines.stack.url` to `http://127.0.0.1:8895` (household setting). Set
   `MAIPAI_STACK_PORT=1` on that command only: exported in the shell that runs `scripts/check.sh`, it fails three `install.sh` tests that
   expect the default 8770.
4. Ask in chat for a song, then for a change, and open the chat in a browser.

## Tests

`backend/tests/music*.test.ts` (gate, tools, routes, commercial check, the Stack status shape, the section rewrite), `backend/tests/toolOffers.test.ts`
(the 16-tool cap), `frontend/src/apps/chat/chatMusic.test.tsx`, Stack `backend/tests/musicGen.test.ts` (a real-worker case runs only with
`MUSIC_REAL=1`).
