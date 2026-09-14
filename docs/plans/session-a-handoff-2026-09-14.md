# Session A handoff (2026-09-14, evening)

For the fresh Session A that picks up the backend lane from the
coordinator (`getmaipai-39`, Fable). Everything on `main` is readable
there; this note holds only what a fresh session cannot read from
`main`: the queue in order, the working protocol as it stands tonight,
the decisions from today's sets that live in no doc yet, and where the
previous session's logs and scripts sit. The last landed commits of
the outgoing session: LOOKUP-01 `3d4fefc`, its follow-up `3c241fe`,
ENGINE-HOST-01 `a8ba6cd`.

## The queue, in order

1. **ENGINE-HOST-01's follow-up, on the coordinator's word.** The
   household's second machine serves the same three engines on the LAN
   (chat 8788, judge 8789, embed 8794; the same models and flags; about
   38.5 tokens per second decode at 25k context). Its engines are
   stopped tonight on purpose (a coding-model trial holds its GPUs);
   the coordinator says when they are back. Then: the live identity
   line for `docs/dev/session-a.md` "ENGINE-HOST-01" (read with
   `readEngineIdentity()` against the three URLs, the labels only),
   and LOOKUP-01's seeded set against those engines, in a follow-up
   commit. The machine's address is the coordinator's to give; keep it
   in your scratchpad only (an `engine-host.env` with the three env
   keys: `MAIPAI_LLAMA_SERVER_URL`, `MAIPAI_BACKGROUND_URL`,
   `MAIPAI_EMBED_URL`; one name per engine, no alias), never in a repo
   file, a log line you quote, or a report.
2. **ASK-01** (`docs/BACKLOG.md` "#ask-01"; the design in `docs/dev.md`
   "The chat design pass", section 3). The ready report the coordinator
   holds: model Opus 5 (the floor for an M item spanning subsystems);
   SPEC-01's shapes are all landed (`spec/schemas/subject-ref.schema.json`,
   `open-question.schema.json`, `entity.pronouns`, `relative_of` in
   `relationship-types.json`, `vocab/entity-kind-nouns.json`, the
   generated bindings in `spec/gen/ts`); the engine has none of the
   five parts yet (no `subjects` or `unknownNames` on `TurnContext`,
   `PendingAsk.kind` is `confirm | ask | lookup`, no `open_questions`
   table at schema version 33, no `compromise` dependency, no
   `false_familiarity` or `pronoun_mismatch`; `subjectLabel()` already
   hides a candidate's hedge). The spec touch is `vocab/defect-codes.json`'s
   two ids plus the guard corpus rows. Two decisions already taken:
   the open question is appended after the last delta and before
   `done` on a streamed reply (the engine's own ask site) and is the
   hub's next reply to that person on whichever conversation it lands;
   and finding 24's check comes first: the invention and
   false-familiarity guards against a grounded first-person recall
   ("what did I say my class schedule was") with the fact in context;
   a guard firing there is the defect to fix before the rest (eight of
   the public baseline's 21 misses were an honest line with the
   evidence in context).
3. **MEM-06 core**, gaining two rows: finding 22's (a restated fact
   with added detail keeps its core across supersede revisions; the
   `decideDedupe()` silent-overwrite path) and finding 24's (a question
   turn carrying an asserted inform clause yields the fact: "I like
   hotels with a rooftop pool, do you know any", which ACT-01's
   turn-level eligibility skips today).
4. **AGE-01 core.**
5. **CHAT-13** (finding 21, Jesse's rule: after the first correction of
   a claim the hub never re-asserts it from its own knowledge; the
   rejected list carries the claim; one lookup; settled said once;
   unsettled conceded with a question; never a third guess; the bench
   row: a fictional game title corrected twice). LOOKUP-01 left CHAT-13
   two lines: the empty-lookup reply shape (the websearch recipe's
   summary of an empty result reaches the person verbatim, "The search
   results do not provide..."; the ladder decides what is said
   instead), and the forced lookup's expression (the model writes it
   from the same messages until the turn has a subject; the pending
   ask binds the utterance verbatim). `pending-ask-lookup` turn 1 is
   CHAT-13's row (an invented forecast with no lookup and no ask
   passed every guard).
6. **CHAT-16 with ACT-03 core**, adding the program file's "milestone
   gate" rows and finding 23's part 2: the register table carries an
   ask-back rate per act and emotion calibrated to the reference (a
   feeling disclosure earns a question more often than a plain inform;
   a backchannel or a closing never), and the persona prose's "ask a
   brief, genuine follow-up" line is replaced by the table's decision.
   `recall-past-the-window` turn 1 is written to fail until this lands
   (the 8B's "I'll make sure to check it out when it drops", rightly
   replaced by the guard). The bench's summary prints the question
   rate per run beside the reference since LOOKUP-01
   (`scripts/bench/questionRate.ts`): the bench hub asks back less
   than people after a statement and far more after a question.

Then CHAT-08, CUR-01 core (finding 22's row: supersede never removes
content the person stated), EVAL-07 memory mode, AGE-02, ACT-02,
REVIEW-01, PREF-01, EVAL-07 mining. If CHAT-19 or CUR-01 touches the
judge's scheduling, use a real abort of the in-flight llama-server
request (the same primitive LOOKUP-01's stream hold uses:
`draftAbort` in `runTurnStreamHoldingLease()`).

## The protocol, as it stands tonight

- The coordinator never codes; it sends the work order and the go, and
  reads every done report against the item's acceptance before a
  tick. Report ready, done, blocked, question, low context. End every
  reply with Done / In flight / Blocked (FYI when there is one).
- The shared checkout is `~/Developer/github.com/getmaipai/home`,
  shared with Session B (`getmaipai-b8`), which works on branches in
  its own worktrees (`home-notif-dismiss`, `home-trial-*`) and
  ff-merges to `main`; its uncommitted hunks can still sit in the
  shared tree (`docs/plans/session-b-lane-12-2026-09-13.md` tonight).
  Atomic stage-and-commit: `git status`, `git add <named files>`
  (`git add -p` for a shared doc), `git diff --cached --stat` listing
  only yours, a bare `git commit -F msg` at once; never `git commit --
  <pathspec>` on a shared file; never commit while B's hunks sit in
  the index; `git show --stat HEAD` before the done report. Rebase onto
  B's merge if it lands before your push (`git rebase --autostash
  origin/main` re-applied B's dirty doc cleanly twice today).
- Gates run in a throwaway worktree, never the shared checkout: `git
  worktree add --detach ../home-gate-a<N> main`, `git apply` your
  patch, copy untracked files in, `git status` then `git add -A` inside
  the throwaway only (the blind-staging hook wants a recent status),
  a throwaway commit, then `check.sh` in the background with the log
  in your scratchpad, monitored for `exit=`; remove the worktree when
  it ends. A gate starts only on the coordinator's "gate"; a seeded set
  only on its "set". A gate and an engine-spawning run (a set, B's
  replay) never overlap on this Mac (24 GB: macOS killed B's replay at
  140 MB free); the coordinator clears each start and holds the other
  session. Message "set starting" and "set ended". Three gates on one
  item is where the review loop stops: after the third, a further read
  goes in the report as a follow-up line, never another fix-gate cycle.
- The code-review hook wants a `code-review` skill run with the
  worktree path as its explicit target within 30 minutes of the
  commit; the review runs while the gate runs, and its findings go in
  the tree before the commit (or in the report after the third gate).
  Read the path and branch the review reports before acting on it.
- The 4B judge on 8790 (`llama-server --model
  data/models/qwen3-4b-q4-k-m.gguf --port 8790 --host 127.0.0.1 -c 8192
  -ngl 0 -t 4 -fa on --reasoning off --jinja --no-webui --metrics
  --cache-ram 0`, from the repo root) is started for a seeded set and
  stopped when the set ends, never left up between sets; the hub's own
  engines are chat 8788 and embed 8794; 8799 is the screenshot
  pipeline's backend, never touched.
- A seeded set is three runs of `bun run scripts/bench/conversation.ts
  --live` with a fresh `MAIPAI_DATA_DIR` each, the three engine URLs by
  env, the default seed, logs named `bench-<item>-set<N>-seed-{a,b,c}.log`
  in your scratchpad; a partial rerun (`--only row,row`) is
  `bench-<item>-rerun-seed-{a,b,c}.log`, and a row that needs another
  row's turns includes it. Every set report lists the log paths, the
  pass counts, and every row id and turn number that failed in any
  run, classified by a manual read of the failing turn (defect,
  scorer, variance), then waits for the coordinator's read. The
  resourceGovernor tests flake under another session's load and pass
  alone; a target row that flips under load is rerun quiet before it
  is reported.
- Never a household memory record, chat quote, or fact about Jesse or
  his family in any repo file, issue or commit message: roster names
  and defect classes only. Prose lint forbids exclamation points and
  em dashes in docs (quote a reply without them). `spec/` for a new id
  is asked first; a vocab or corpus edit under an item's named files
  is fine.

## Decisions from today's sets that live in no doc yet

- The question rate is a measurement only until ACT-03 (finding 23's
  part 2 above); no item changes the rate before the register table.
- The forced lookup and the offer binding never run on a household
  subject (`asksAboutHousehold()`: the roster and registry minus a
  roster name inside a longer proper noun); a household subject named
  only by a frame ("my dog", no name on the roster) is ASK-01's
  household-frame rule.
- `offer-binding` turn 3 accepts a reply grounded in the previous
  turn's own lookup result; a person would not search again.
- `statement-not-request` turn 1 (a statement answered with an
  unrelated stored fact or the list, `unrelated_recall` silent) is
  finding 25 in the program file, left as a row.
- ENGINE-HOST-01's two read-and-noted lines: the client's own error
  text ("could not reach http://...", `spec/llm/ts/client.ts`) still
  carries an engine's address into the hub's local log and the 503's
  error string (a spec change to label it is a small item of its own);
  and in a bench the `[turn]` lines say `local` for the proxied
  external chat engine while the header says `external` (the header's
  label is the true one).

## Where the outgoing session's logs and scripts are

The scratchpad of the outgoing session:
`/private/tmp/claude-501/-Users-jessetorres-Developer-github-com-getmaipai/c7416714-9196-47bb-9a7f-1a5ff564c439/scratchpad`.
It holds every set's logs the coordinator has read (`bench-act01-*`,
`bench-reg01-*`, `bench-exp01-*`, `bench-recall03-*`,
`bench-lookup01-set1-seed-{a,b,c}.log` with `lookup01-set1-report.txt`),
the gate logs `gate-a<N>.log`, and the scripts: `gate-in.sh` (cd to the
worktree, `bun install --silent`, `bash scripts/check.sh`, then `echo
exit=$?`), `judge-4b-8790.sh` (the command above), `run-bench-4b-3x.sh`
and `run-bench-rows-3x.sh` (the set and the partial rerun as described),
`set-report.py` (the three-run failing-row list from the `[bench-turn]`
lines). A fresh session gets its own scratchpad; recreate the four
small scripts there (they are described in full above) and copy logs
across only when a report needs them. `/tmp` is not the scratchpad.
