# Session B: lane 6, docs and user-facing truth (2026-09-13)

Work order from the coordinating session. Frontend and docs only, per
`measure-first-2026-09-13.md`'s lane rule; no backend line, no bench.
Session A is on the baseline fixes (#92, #93, the judge) in the chat
engine and the memory files; do not touch those. Same protocol as
lane 5: gate on your own diff in a throwaway worktree of `main`,
`git add -p` on `BACKLOG.md`, sections in `docs/dev/session-b.md`,
report on ready, done, blocked, question, low context. Commit this
file with item 1.

## 1. CHAT-25, the half that is true today: reconcile the user docs with what shipped (S-M)

BACKLOG.md's CHAT-25 says the docs must not claim more than the code
does. Tonight the code moved a long way: memory batch select, forget
and clear-all; the memory chip on messages; edited messages surviving
a reload; credentials refused in chat with the fixed line; world
knowledge answered; the Copy button; the PWA and the offline page;
"please remember" phrasings; replies starting with a capital. Read
`docs/user/chat.md`, `memory.md`, `privacy.md`, `home.md`,
`getting-started.md`, `fix-a-problem.md` against the running app on a
spare-port backend with a seeded persona-roster household, and make
each page describe what a person actually sees now: what memory
remembers and how to forget it, what happens when you type a
password, what the offline page looks like, how editing a message
works. Dad test, grade 6, one action per step; no claim the bench
did not show (the baseline's failing rows are not features: do not
document "ask what someone is allergic to" until #92 lands). Every
screenshot on those pages regenerated and opened; a stale one is
replaced or removed. Tick CHAT-25's "current documentation" half in
its status line; the readiness half waits for the bench.

## 2. Doc drift the audit found, the parts that are not Jesse's call (S)

BACKLOG.md "Doc drift the audit found" (Cross-cutting). Fix the parts
that are plain corrections: `spec/llm/README.md` ("non-streaming
only") and `spec/ui/README.md` ("single-shot JSON") are stale since
streaming landed; correct them to what `spec/llm/ts/client.ts` and the
UI interpreter do today, by reading the code. Leave the parts marked
as Jesse's call (committing the platform plan into `spec/design/`,
renaming a tier ladder) untouched, and split the BACKLOG item so the
remaining decision items stand alone with "Jesse's call" in the
headline. These two READMEs are under `spec/`, which is shared with
`bot` as a pinned package: prose only, no schema or code change.

## 3. Reader's rows from the baseline, filed as issues (S, docs)

Session A's baseline section in `docs/dev/session-a.md` lists reader's
rows it did not score: the timer follow-up that invented a remaining
time, "[Knowledge could not answer.]" spoken as a reply (folded into
#92), emoji and canned closers. Session A was asked to file the timer
and closer findings; check whether it did (`gh issue list`), and file
whichever is missing through the `issue` skill if your session has it
(the plugin is installed; a restart picks it up) or by hand per the
org template, each with the exact bench row as evidence. No fix.

## 4. The privacy page's "what leaves the house" table against the code (S)

`docs/user/privacy.md` and the Privacy page draw from
`lib/privacy.ts`. Tonight added no outbound endpoint (the PWA, the
service worker, and the benches are local), but the page should say
so explicitly for the service worker (it caches only same-origin
pages) since a parent reading "offline mode" will wonder. Add the
sentence to the user page, confirm the table needs no new row by
reading `lib/privacy.ts`'s aggregation, and record that check in
session-b.md.

## Out of scope

Anything under `backend/` or `spec/schemas`, the benches, the home
redesign, unified search, the stream-reconnection item (CHAT-17's),
#75.
