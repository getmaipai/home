# Working method for the local coding model

The household's own coding model is not a frontier model. It does well on small, well-specified tasks and drifts on open-ended ones, so the
instructions it is given are short, concrete and ordered. This page is the one source for them. When the method changes, change it here and
copy the same text into every place below, so the files never contradict each other.

## The method

1. Look first. Find the relevant files, read what they import and a sibling file for style, and read the acceptance test: it is the spec. Search (grep) before you use a name; never invent one. Read the part of a file you need, not all of it.
2. Reproduce or understand. Run the failing test or command and read the output so you know what is wrong before you change anything. If there is no test, write a small failing one first.
3. Plan. Write a short numbered plan in your reply: the goal in one sentence, then 3 to 7 small steps, each with the command that checks it. Tick steps off as you go.
4. One step at a time. Finish a step and run its check before you start the next. Never start a step while the last one is failing.
5. Change only what the task needs. No renames, cleanup or refactors on the side, no new dependencies, no debug prints or stray files left behind. If the task needs more than you can finish, finish the part you can and say what is left.
6. Check with commands, not memory: the test next to your change, `bunx tsc --noEmit` in `backend/` or `frontend/`, and `bash scripts/check.sh --pre` before a commit. Read the output. Never say something works or is done unless you ran the check in this session.
7. If the same error comes back twice, stop repeating the edit. Re-read the error, open the code it points to, and try a different cause. After three tries, stop and report what you found.
8. If the task is unclear or has two readings, take the safer one and say which you took. Go on only if it is easy to undo; otherwise stop and ask.
9. When the checks pass, stop. Do not start extra work. Report in a few lines: what changed (files), the checks you ran and their results, and what is not done or not verified.

## Where it is installed

The text is a section of three instruction files. All three are read by the model at the start of a run.

| File | Used by |
|---|---|
| The lane's task rules (`OC_RULES` in `local-lane`) | `local-lane dispatch` and `local-lane run`, one file per run |
| The lane's global rules (`OC_GLOBAL_RULES` in `local-lane`, written to OpenCode's own `AGENTS.md`) | OpenCode started by hand on the Studio |
| The offline coder's `RULES.md` | the offline coder worktree |

Any other computer that runs the local coder through OpenCode needs the same section in its own `AGENTS.md`.

## Why these rules

Guidance for coding-agent instruction files is consistent, and the method follows it:

- Keep it short and limited to what the agent cannot work out from the repo. Long files get ignored, and repeating what the code already shows
  only adds cost. Nine numbered rules is the budget; before adding one, remove or merge another.
- Make rules concrete and checkable. The test and typecheck commands are named, and the model is told to run them and read the output.
- Warn against the mistakes seen in practice. SWE-agent found that tips against known failure patterns raised success. Rules 2, 5 and 7 come
  from runs where the model edited without reading, changed unrelated code, or repeated the same failing edit.
- Reproduce first, change only what is needed, check, leave a clean diff. This is the flow of the small SWE-agent baseline.
- End with an explicit stop. Without one the model keeps working after it is done.

Sources: the [SWE-agent paper](https://arxiv.org/pdf/2405.15793) (prompt tips, system template), and general guidance on
[AGENTS.md and CLAUDE.md files](https://mac.install.guide/ai/agent-instructions/best-practices).

## Always on the latest repo

The model must never work from an old copy of the code. `local-lane dispatch` checks this before the model starts: it fetches `origin/main`, and
a clean worktree that is behind main with no commits of its own is fast-forwarded to it. A worktree that is behind and has its own commits or
edits is refused with the next step (sync it, or start a new worktree). If the fetch cannot run, the run goes on from the last known
`origin/main` and the first line of the output says so. Start every dispatch in a fresh worktree (`bash scripts/wt.sh start <slug>`), which is
cut from the latest main. A long-lived worktree (the offline coder's) or an OpenCode started by hand is not covered by this check: sync it
before use.

## Keeping it honest

- Record the verdict of every dispatch (`local-lane verdict RUN accepted|edited|discarded`). When a failure repeats, add one rule for it here
  and drop a rule the model already follows.
- Settings that the Stack applies to the model (thinking budget, sampling) are not part of this page; they live with the model's catalog entry.
