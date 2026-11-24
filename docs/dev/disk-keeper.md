# Disk keeper: keeping the build Mac from filling up again (design, 2026-11-24)

Why: on 2026-11-24 the Mac Studio was 97 percent full (1.7 TiB). 762 GB of model weights sat in five finished experiment folders
under `data-scratch` (log: `~/.local/share/harness-trial/bench/removed-scratch.tsv`), and `getmaipai/wt` held 189 worktrees (212 GB; scan:
`~/.local/share/harness-trial/bench/wt-scan.tsv`: 59 clean and pushed = 55 GB, 87 with unpushed commits = 113 GB, 43 dirty = 44 GB).

## What already exists (extended, not duplicated)

| Piece | What it covers | Gap this note closes |
|---|---|---|
| Product disk guard (`disk-guard-2026-11-19.md`, DISK-GUARD-01 to 09: Stack `tidy.ts`, `diskStatusVolumes`, Repairs item, Status line) | Models the hub owns, the data folder, rollback copies, the live volume level | By design never touches developer folders ("Product must never touch dev folders") |
| `scripts/disk-report.sh` (DISK-GUARD-06) | Read-only list of the biggest folders | No categories, no threshold, no assigned-model check, no cleaner |
| `wt.sh reap` (`.github/standards/bin/wt.sh`, `live_reason`) | Removes provably dead worktrees whose branch is an ancestor of `origin/main` | Misses squash merges and pushed-but-unmerged branches (the 59 clean worktrees); only 4 h age gate and a session file |
| DISK-REMOVE-01 (`delivery-pipeline` lander sweep) | Landed worktrees after each landing | Same ancestor-only test |

## Decision: build in `scripts/`, not in the Stack

The Stack already owns "which models are assigned" and its cleanup must stay inside the product's own folders. The mess here is
developer scratch: experiment folders, worktrees and Claude session state, none of which the Stack should know exists (and a
product that deletes files in `data-scratch` is the 2026-11-19 incident, a cleanup that deleted a model the live hub used). So:

- **Detector and cleaner: `scripts/disk-keeper.sh`** (bash, next to `disk-report.sh`, which it supersedes for reading). It reads the
  Stack's assigned models as input (source files `tiers.ts`, `partDefs.ts`/`partDefs.json`, `modelCatalog.ts`, in the checkouts and
  under `/usr/local/maipai-home`) and never writes to the product.
- **Claude-side rule and hook:** prevention is cheaper than cleanup, and only the session knows an experiment is finished. A hook
  catches the download at the moment it happens; the Stack cannot.
- **Not built:** a launchd job that deletes on a schedule (a surprise deletion is worse than a warning), a Stack API for developer disk,
  a second Repairs item. The warning reaches Jesse through the session-start line below.

## Commands (all dry run unless `--apply`; every removal is appended to `~/.local/share/maipai/disk-keeper/removed.tsv`: epoch, bytes, kind, path, reason)

- `check`: one line from statfs, exit 3 at 85 percent used or under 150 GB free (`MAIPAI_DISK_WARN_PCT`, `MAIPAI_DISK_WARN_FREE_GB`). Cheap, so
  a SessionStart hook can run it and show the line.
- `report`: free space, then by category: worktrees (by class), experiment folders in `data-scratch` (finished means RESULTS.md present),
  the scratch root against its cap, caches (Hugging Face, bun, `~/Library/Caches`), build dirs (Xcode DerivedData, simulators), run dirs and
  session state (`home/data`, `~/.claude/projects`, Claude app support, `/private/tmp/claude-501`).
- `worktrees [--apply] [--keep GLOB] [--sizes]`: scans the worktrees of home, stack, commons, bot, catalog, stackchan and .github. Classes:
  - **SAFE**: tree clean (ignored `node_modules`, caches and `dist` do not count), no process has it as working directory, git state
    quiet, and either the tip is an ancestor of `origin/main`, or `git cherry origin/main <tip>` shows no `+` line (squash or rebase
    merged), or a remote-tracking branch already holds the tip (pushed). Removal is `git worktree remove` with no `--force`, so git itself
    refuses a tree that still holds files. A merged branch is deleted; a pushed one is kept (the remote has it).
  - **DIRTY, UNPUSHED, ACTIVE, PROTECTED, ODD**: listed with the reason, never touched. `MAIPAI_DISK_KEEP` or `--keep` globs (matched against
    path and branch) protect the StackChan hybrid redesign worktree and the stack and home feature worktrees Jesse still needs.
  - It uses local refs only (no fetch), so a stale `origin/main` can only make a worktree look unmerged, never the reverse.
- `weights [--apply] [--min-mb N] [--older-days N]`: finds weight files (safetensors, gguf, ckpt, pt, onnx and so on) over 500 MB in the
  scratch roots. A file is **assigned and kept** when its name, stem or folder name appears in any assigned-model source; if no source
  can be read, the command refuses to propose anything (exit 4). Unassigned files are deleted with `--apply` only when their experiment folder
  holds `RESULTS.md` (or, in the scratch root, when untouched for N days) and no process has them open. RESULTS.md and everything else stay.
  Name matching is deliberately generous (it errs toward keeping); the cost of a false keep is disk, the cost of a false delete is a model.

## Rule for Claude sessions (in `AGENTS.md`, enforced by `scripts/hooks/scratch-weights-guard.sh`)

1. An experiment keeps model weights outside the repo, in one scratch root: `~/scratch/maipai-weights/<experiment>/` (`MAIPAI_SCRATCH_WEIGHTS`),
   capped at 150 GB in all (`MAIPAI_SCRATCH_CAP_GB`). Reports, scripts and RESULTS.md stay in the repo's `data-scratch/<experiment>/`.
2. When the experiment is done: write RESULTS.md, then delete the weights (`disk-keeper.sh weights --apply`).
3. The hook (PreToolUse on Bash) refuses `hf download`, `huggingface-cli download`, `snapshot_download`, `git lfs pull` and `curl`/`wget` of weight files
   that do not name the scratch root, and refuses any download while the root is over its cap. It reads the command only and changes nothing.
   It is not active until installed in `~/.claude/settings.json`, which is Jesse's file (see below).

## Installing (needs Jesse's yes: it edits his global settings)

```json
{ "hooks": {
  "SessionStart": [{ "hooks": [{ "type": "command", "command": "bash /Users/jessetorres/Developer/github.com/getmaipai/home/scripts/disk-keeper.sh check" }] }],
  "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "bash /Users/jessetorres/Developer/github.com/getmaipai/home/scripts/hooks/scratch-weights-guard.sh" }] }]
} }
```
Use the path of `home` main once this branch has landed.

## Status of this build

On branch `disk-keeper`; nothing shipped to the live hub. Six tests pass (run from outside the worktree until its dependencies are installed): dry-run
classification (merged, squash-merged, pushed, unpushed, dirty), `--apply` for worktrees and weights in a throwaway repo, keep globs, `check`, the
download guard. The tests set `MAIPAI_DISK_ORG` and `MAIPAI_DISK_HOME` so they never scan the real machine. Installed 2026-11-24 with Jesse's yes: copies
of both scripts in `~/.claude/hooks/` (refresh them after a change here) and two entries in `~/.claude/settings.json` (backup `settings.json.bak-disk-keeper`).

Home-only dry run on 2026-11-24: 134 worktrees, 21 safe, 96 dirty (mostly ignored `data/` and `data-scratch/` folders, kept on purpose), 5 unpushed, 12 odd. `gate-stamps` and `public/ort` ignored folders are now treated as disposable.

Known limits: the full-machine worktree scan is slow (`git status --ignored` on 100k-file trees; minutes for hundreds of worktrees) and its numbers
were not yet verified against wt-scan.tsv. Follow-ups: change `wt.sh reap` in `.github` to use the same cherry test (separate repo, full gate).
