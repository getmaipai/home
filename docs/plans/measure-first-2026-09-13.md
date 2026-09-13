# Measure first: the queue after the 2026-09-13 boundary fixes

Written by the coordinating session after an outside review (Codex,
2026-09-13) of the CHAT program's sequencing. The finding: CHAT-23, the
integrated evaluation, depends on CHAT-02 through CHAT-21, so the plan
would build seventeen M items before learning whether the combined
hub remembers correctly, answers naturally, and responds quickly. The
org's own rule is to measure before building. This file replaces the
"then follow the individual dependencies" part of BACKLOG.md's CHAT
order until the baseline exists; the CHAT items stay as the map.

## 1. Close the correctness boundary, verify the whole (done, then one check)

#86, #87, #88, #89 are closed on `main` (a5015c1, eae6994, 98e477b).
CHAT-04 (in progress) is the last boundary item: the guards' outcome
half, closing #74 and #62. When it lands, the integrator (Session A)
runs `bash scripts/check.sh` on bare `main` and records the hash and
result in `docs/dev/session-a.md`; that is the block-end verification
the skill requires, and the baseline's starting commit.

## 2. The baseline: a conversation bench that measures the whole hub (Session A, M)

A first slice of CHAT-23 plus the timing half of CHAT-21, pulled
forward. Extend `backend/scripts/bench/conversation.ts` (do not add a
framework; it already runs scripted conversations through the real
`runTurnStream()` against engine URLs through `setup.ts`):

- Twenty complete conversations, each three to six turns, with stable
  ids, covering: disclosure then recall in a later conversation;
  correction (an edit or "no, I meant") then recall; an ordinary
  question; a compound request (#83's shape); a tool turn (weather,
  timer) and its follow-up; a polite command ("can you remember...");
  a greeting and a thanks; a household fact asked back the next day
  (the clock seam); an interruption (a second message before the
  first reply finishes, through the abort path); and one credential
  disclosure (must get the fixed line and store nothing).
- Per turn, record the outcome the person would care about, from the
  system's own state, not from the reply text: memory written (row
  count and the record's text), recall correct (the expected fact in
  the context message), tool ran (the outcome's package id), guard
  hit and whether it replaced the reply, safety action, and the
  timings the `[turn]` log already carries (first sentence, total),
  plus prepare-to-first-token from `startedAt`.
- One table per run: conversation id, turn, expected, observed, pass,
  first-sentence ms, total ms; then totals by category. Seeds only
  persona-roster names; refuses a household data directory (CHAT-22's
  guard). Deterministic control-flow rows run against the stub in
  `bun:test` (so the bench's own logic is tested); the live rows run
  against the household engines by URL on a spare-port backend.

- Judge the answer, not only the state. Each turn also records
  whether the reply answered the question, used the corrected fact
  (not the retracted one), described a tool's success or failure
  accurately, and handled an interruption honestly. Scored by a
  scripted rubric per row (expected phrases present or absent, a
  contradiction with the corrected fact absent), never by a model
  judging a model.
- Frozen inputs. The run header records the commit, engine build,
  model files with checksums, fixture ids, sampling settings and the
  ordinary tool set from the fixture, so a later run (or a model
  comparison) is on identical inputs.

Acceptance: the table, recorded in `session-a.md` with the frozen
header and sanitized hardware, from one run on the commit named in
step 1. "No threshold" applies to latency and answer quality only,
where the first run sets the target. Four rows carry hard criteria
from the day they exist, because the org already has them: a
credential disclosure stores nothing and gets the fixed line;
cross-person recall never surfaces another person's private record;
no unsafe output reaches the reply; a consequential action never runs
twice on one request. A miss on any of those is a defect to fix before
the baseline is called done. Then rank the remaining failures by
severity first (a privacy or safety miss outranks any number of
awkward answers), then by conversations broken, then by what a parent
would notice, in five lines at the end of the section. Twenty
conversations are a diagnostic set, not release readiness.

## 3. The model decisions, on the repaired scorer (Session B, read-only, S-M)

MEM-05 and EVAL-01 as one lane, both benches only, no product change
beyond EVAL-01's one catalog entry: the judge eval on the 1.7B, 4B and
8B with the real scorer (judgeScore.ts, a5015c1), then EVAL-01's
comparison per its BACKLOG item. Memory scheduling: only one session
has engines up beyond the household hub at a time; Session B spawns
the 4B on 8808 and reuses the hub's 8B on 8788 as the other arm,
while Session A is in step 2's design and implementation (no engines
needed until its run); Session A runs step 2's live pass after Session
B's engines are down. Both verdicts recorded per the items' own rules;
a recommendation is not a switch. The model comparison uses the same
frozen inputs as step 2 (fixture ids, sampling, the ordinary tool
set) and includes step 2's conversation rows once they exist, so a
candidate that wins an isolated bench while making ordinary chat
worse is caught. Engine measurements are serialized: never two
sessions measuring at once.

## 4. Fix the largest measured failure, one at a time

After step 2's table exists, the next item is whichever CHAT item (or
new item) addresses the top-ranked failure, chosen from the data, not
from the CHAT order. Re-run the bench after each fix; the table is the
regression suite. A BACKLOG dependency is respected only where it is a
real technical prerequisite (CHAT-16 needs CHAT-15's outcomes; CHAT-17
needs the streaming state that CHAT-16 composes), never as a queue.

## 5. Family use before more scope

Once the top failures are fixed and the bench holds, the coordinator
recommends a release (Jesse's call) so the household runs the merged
hub, and the next items come from what the family reports, not from
the map. INVEST-01, the home redesign, and further prompt or model
tuning wait for that evidence.

## Lanes

Session A owns the chat engine end to end; Session B's lanes are
frontend, docs, or read-only benches. A Session B item that needs a
backend line is re-scoped or moved to Session A rather than
coordinated across the same files; the coordination cost was on the
critical path all night.
