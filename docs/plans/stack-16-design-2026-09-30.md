# Home runs on the Stack: one role at a time, proven before it moves (2026-09-30)

For Jesse. STACK-16 is the move where Home stops running its own model engines and calls the Stack for them. This page is the design pass the backlog asked for before any of it is built. It says what is already done, what is in the way, the order the roles move in, how each one is proven before a family depends on it, and how any of it is undone. Nothing here changes how the household's hub runs today, and nothing in it is built until Jesse says go on the first item.

## Why move at all

Home carries five engine modules of its own (chat, embeddings, speech to text, text to speech, and the background judge: about 1,750 lines, plus the process, port, download and identity code around them). The Stack already does the same job better in the ways that matter for a family hub: it sizes a model before it is downloaded, keeps one memory budget across every model, updates and rolls back engines, reports one health list, and runs on the Studio. Two engine owners means two memory budgets that do not know about each other, two update paths and two places for a bug to hide. The goal is one owner, and Home is the only caller.

## Where things stand (read from the code on 2026-09-30, not from the docs)

Built and landed: the installer that places the Stack (HOME-STACK-01), Home's Stack client and the role wire (02a, 02b), the event bridge (03), the Engines page API (04a) and Updates and Repairs (05). Home's chat, embeddings, text to speech and speech to text calls already go through the Stack when one address is set (`engines.stack.url`).

What is in the way:

1. **The switch is all or nothing.** One address turns every role over at once. There is no way to move only text to speech and leave chat alone.
2. **The installer flips everything by itself.** After a successful install it writes the address if it is empty, so a fresh install moves chat, voice and search onto the Stack with no proof and no one deciding.
3. **Nothing has been proven side by side.** No code in either repo runs Home's engine and the Stack's on the same input and compares. The "dual-run proves each role" step in the backlog row has never existed.
4. **The Stack's contract is not pinned.** STACK-75, the test suite that fails when a route's shape changes, is not built.
5. **Speech to text through a Stack has no test in Home.** Chat, search and text to speech do.
6. **No Stack is installed on the dev machine, and the Studio is not running it yet.** The Studio bench (STACK-14) is the proof the Stack's own backlog puts first.
7. **A call that started on the Stack and failed is not retried on Home's engine.** That is right (a silent retry hides a broken Stack), and it means a rollback only affects the next request.

## The design

### One setting for where, one for which

`engines.stack.url` stays what it is: where the Stack lives. Four household booleans, `engines.stack.use_chat`, `engines.stack.use_embeddings`, `engines.stack.use_stt` and `engines.stack.use_tts`, independently decide which model roles go through it. The four booleans were retired once all roles were proven on the Stack. The memory judge and background worker follow chat because they share chat's model.

This one change fixed the earlier plan. HOME-REQ-01 retired the switches after all roles were proven on the Stack, and the installer now requires it.

Home's current memory response preserves the `homeOwnedRoles` field for compatibility and reports an empty list.

### Proving a role before it moves

A role is proven by a script, not by a feeling. The proof harness lives in Home (`backend/scripts/bench/`) and runs the same recorded inputs through Home's engine and through the Stack, then compares. The bar per role, written before the first run:

| Role | Inputs | Must match | Must not regress |
|---|---|---|---|
| Text to speech | 30 recorded lines across every voice in use | no clipping above 0.1 percent of samples; spoken part's median ratio within 0.9 to 1.1; Stack edge silence no longer than Home's; same voice by listening check, with no odd gaps | median time to first audio at most 1.25 times Home's |
| Speech to text | 30 recorded clips | word error rate no worse than Home's by more than 1 point | time to final text no worse than 1.25 times |
| Embeddings | 200 recorded texts | cosine similarity at least 0.999 against Home's vectors for the same model file, equal dimensions, deterministic | median single request no more than 50 ms slower; batch throughput at least 100 sentences per second |
| Judge | 50 recorded memory and safety decisions | same yes or no on every decision (a difference is read by a person, never averaged away) | no added refusal or crisis-path failure |
| Chat | the chat replay set | same model file and sampling, reply quality read by a person against the bare-model floor, every crisis and child-safety row unchanged | time to first token no worse than 1.25 times, memory at most what the Stack's own plan said |

Every run records the engine builds, the model files and a sanitized hardware line. A role passes only when the whole table row passes on the machine it will run on, so the first runs happen on the laptop bench and the real proof on the Studio.

Every bar is set from a control run (the same engine against itself) and a listening check, never from a guess (learned on text to speech, 2026-10-01). The embeddings batch ratio was retired the same way (a guess, then measured).

### The order

1. **Text to speech.** The smallest isolated path, the best existing test coverage, and a failure is one line of audio, not the household's chat.
2. **Speech to text.** After its missing Home test exists.
3. **Embeddings.** Shared by memory and search, so it moves only when the two before it have been stable.
4. **Judge and the background worker together.** They share chat's model and process.
5. **Chat last.** The thing the family uses most, and the one with no retry on Home's engine if the Stack call fails.

A role moves to the Stack on the family's hub only on Jesse's word for that role, after its proof passes, and it stays on the Stack for a week of ordinary use before the next one starts.

### Undoing it

The switches are kept in the shared spec until a later cleanup, but Home no longer reads them. The Stack is required during install; a missing configured address appears in Repairs after boot.

### Deleting Home's engines

Only after all five roles have run on the Stack in family use for a week, and after one release has carried that, the supervisors go (`llmSupervisor`, `embedSupervisor`, `ttsSupervisor`, `stt`, `backgroundSupervisor`, their process and port code, their tests and fixtures). After that there is no way back to Home's own engines, so this is the one item that needs Jesse's explicit go at the time, not only at the start.

### What has to be true on the Studio first

The Stack's own backlog puts the Studio proof before any of this reaches the household's hub: the bench of chat, embeddings, judge, speech to text and text to speech resident together (STACK-14), the governor proven across both chat engines, and a chosen Studio profile. The dual-run proofs can start on the laptop bench before then, but no role moves on the household's hub until the Studio has run the Stack with the resident set.

## The work, in order

| Id | What | Size | Needs |
|---|---|---|---|
| STACK16-A | Four independent role switches route model calls; the memory judge and background worker follow chat | M | nothing |
| STACK16-B | Fresh install writes all role switches off; an existing configured hub is backfilled to all on unless a switch was already stored | S | STACK16-A |
| STACK16-C | Speech to text through a Stack gets the same scripted-Stack test chat, search and text to speech already have | S | nothing |
| STACK-75 | The Stack contract suite, run in Home's gate | M | nothing (existing item) |
| STACK16-D | The proof harness and the recorded inputs (from the demo household's own seed, never real recordings) | M | A and C |
| STACK16-E1 to E5 | One proof run and one move per role, in the order above, each a short item with its numbers recorded | S each | D, STACK-14 for the household's hub |
| STACK16-F | The "Use this computer's own engine" button and the memory-budget note | S | A |
| STACK16-G | Delete Home's supervisors and their tests | L | E5 plus a week plus one release, Jesse's go |

A and B are what make "start a Stack beside the hub" safe to do now; they are the first things worth building whatever happens to the rest.

## What this note does not decide

Whether the Studio runs the household's hub (the owner's call, recorded 2026-09-17). Which models the Studio profile pins (that is STACK-14's output). Whether the robot uses the same setting (the robot is not built yet; the switches are Home settings and the robot's runtime reads the Stack directly).
