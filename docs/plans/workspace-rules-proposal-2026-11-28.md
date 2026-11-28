# Workspace rules: a proposal for the architect (WORKSPACE-RULES-01)

Status: proposal, architect ruling pending. This is not a design rule yet and it does not belong in `docs/design/` until the
architect rules and, where a rule touches `RULES.md`, Jesse adds `Owner-approved`. Source: the LocalAI review
([plan](localai-port-plan-2026-11-27.md), "Workspace rules"), where writers had no file locks, `write_file` was
last-writer-wins, and anyone with write access could undo someone else's change.

## The rules

1. **Own workspace only.** A session writes only inside its own workspace. A shared household folder is read-only to a session
   unless its owner grants that session write access, for that session only.
2. **One branch per session.** Code changes go on a branch that belongs to one session. Two sessions never share a branch. A
   person merges after a diff review.
3. **No blind overwrite.** Saving back to a shared file checks the version the session started from. If the file changed since,
   keep both versions, tell both sides, and let a person choose. There is no overwrite tool.
4. **Every change names its session.** Undo works on your own session's changes only, and never over a newer edit by someone else.
5. **Undo a whole run.** "Undo this run" reverts everything one session changed, as one step.
6. **No commands on the hub.** Commands run in the sandbox, never on the hub's own machine.
7. **Say it before doing it.** A risky tool writes "about to run X" to a journal first, so a restart never repeats it blindly.

## How a chat agent and a coding session share a household folder

- The household folder belongs to a person (or the household). Neither a chat agent nor a coding session owns it.
- Each gets its own workspace inside the folder's tree: a chat agent's under the person's agent area, a coding session's on its own
  branch. Reading the shared folder is allowed; writing to it is not, until the owner grants it.
- A granted write is per session and per folder, shown in the person's activity list with a one-tap revoke. A grant ends when the
  session ends.
- When both want the same file, the second save finds a changed version (rule 3), keeps both copies, and says so to the chat and
  to the coding session. Neither wins silently.
- A chat agent in a child's or teen's context gets no write grant at all (rule 0: the age band outranks the grant).

## What already exists and what is missing

Rules 2, 4 and 6 are partly built (a branch and worktree per session, the activity record, the sandboxed Code lane). Rules 3, 5 and
7 are not: no version check on a shared-file save, no whole-run undo, no pre-run journal (the package lifecycle journal row,
`PKG-LIFECYCLE-JOURNAL-01`, is the first journal). Rule 1's grant list has no storage yet.

## Questions for the architect

- Does rule 1 conflict with `RULES.md` rule 0 or the shipped-parts rule anywhere?
- Is a grant per session enough, or does a standing grant per person need to exist for the coding lane?
- Does rule 6 hold for the hub-side Code lane as built, or does that lane need its own ruling?
