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

## Answers, docs and commits

10. Say where you saw it. When you state a fact about the code, name the file and line you read. If you did not read it, say you do not know; never guess.
11. Read your own diff before you finish. Remove anything you cannot explain, debug output, and any file the task did not ask for. Never change a test, a type or a check just to make it pass; if the test looks wrong, say so and stop.
12. Docs change with the behaviour, in the same change. Find the page that describes what you changed (grep `docs/` for the feature's name) and update it. Put new text in the right tier: `docs/user` is plain words and short sentences for the people in the home, `docs/dev` is how it works for a developer, and `docs/api` is generated, so never edit it by hand. Write concrete words (numbers, names, paths), no em dashes, no filler. Examples use `example.com` and `192.0.2.x` addresses, never real names or addresses. Run `bash scripts/check.sh --docs` and fix what it reports.
13. Commit by file name (never `git add -A` or `git add .`), one logical change per commit, a plain message. Never run `git push`, merge, rebase, reset or tag yourself. When your checks pass, land with `python3 scripts/local-land.py land` (or `localland`); when it refuses, stop and say why. Release only with `localrelease`, and only when the task asks for it.

## Where it is installed

The text is a section of three instruction files. All three are read by the model at the start of a run.

| File | Used by |
|---|---|
| The lane's task rules (`OC_RULES` in `local-lane`) | `local-lane dispatch` and `local-lane run`, one file per run |
| The lane's global rules (`OC_GLOBAL_RULES` in `local-lane`, written to OpenCode's own `AGENTS.md`) | OpenCode started by hand on the Studio |
| The offline coder's `RULES.md` | the offline coder worktree |

On the laptop, the `localcode` command loads `~/.config/opencode/dispatch-rules.md` by path (its wrapper is `mac/zsh/localclaude.zsh` in the
homelab repo), so the method goes in that file, not in `AGENTS.md`. The wrapper also fetches `origin/main` before it starts and fast-forwards a
clean checkout that is only behind; a checkout with its own work gets one warning line with the behind count and starts anyway. Any other computer
that runs the local coder through OpenCode needs the same section in whichever instructions file its launcher loads.

## Why these rules

Guidance for coding-agent instruction files is consistent, and the method follows it:

- Keep it short and limited to what the agent cannot work out from the repo. Long files get ignored, and repeating what the code already shows
  only adds cost. Thirteen numbered rules is the budget (nine for the method, four for answers, docs and commits); before adding one, remove or merge another.
- Make rules concrete and checkable. The test and typecheck commands are named, and the model is told to run them and read the output.
- Warn against the mistakes seen in practice. SWE-agent found that tips against known failure patterns raised success. Rules 2, 5 and 7 come
  from runs where the model edited without reading, changed unrelated code, or repeated the same failing edit.
- Reproduce first, change only what is needed, check, leave a clean diff. This is the flow of the small SWE-agent baseline.
- End with an explicit stop. Without one the model keeps working after it is done.

Sources: the [SWE-agent paper](https://arxiv.org/pdf/2405.15793) (prompt tips, system template), and general guidance on
[AGENTS.md and CLAUDE.md files](https://mac.install.guide/ai/agent-instructions/best-practices).

## Landing and releasing without Claude

When Claude is unavailable the local model has to be able to finish the job: land its work on `main`, and release it so the family's hub runs it.
It does not get push rights or release rights of its own. It calls `scripts/local-land.py`, which applies fixed guards and uses the repo's own
`wt.sh` and `release-home.sh`:

| Command | What it does |
|---|---|
| `python3 scripts/local-land.py land [--dry]` | In a worktree: commits the changes by file name, runs `wt.sh check`, lands on `main` as a fast-forward, removes the worktree. |
| `python3 scripts/local-land.py release --yes` | On the Studio: tags `origin/main` as the next version and installs it through `release-home.sh`, which restarts the hub. |

Guards, all in the script (one definition): it refuses anything touching access, credentials, safety, migrations, installers, the gates, package
files or `RULES.md`; more than 12 files or 700 diff lines; a failing check; a newest `main` that failed its gate; and a second release within 30
minutes. A refusal says why and leaves the work on its branch for a person. `local-lane dispatch --land` runs the same script after a finished
dispatch. On the laptop, `localland` and `localrelease` (in the homelab shell file) run it; `localrelease` runs it on the Studio over SSH. The
person who types `localrelease` or lets the model run it is giving the owner's yes for that release.

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
