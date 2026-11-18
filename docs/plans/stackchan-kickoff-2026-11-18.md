# Kickoff brief for the StackChan work session (2026-11-18)

For: the "STACKCHAN - WORK" session on the Mac Studio. Written by the research session (cloud) at the owner's request. The owner starts this; nothing here runs until he says so in the work session.

Plan of record: [stackchan-master-plan-2026-11-18.md](stackchan-master-plan-2026-11-18.md) on branch `claude/hopeful-keller-mh6wng` of `getmaipai/home`. Evidence: `docs/reports/stackchan-ecosystem-audit-2026-11-18.md`, its attachments and `round2/`.

## Read this first: the plan was written blind to your current work

The research session could read only the public `getmaipai/bot` at firmware 0.2.213 and an empty `getmaipai/stackchan` on GitHub. It could not read your local `getmaipai/stackchan` checkout or `~/esp/stackchan-rebase`. Late in the session it read the docs draft (artifact "MaiPai StackChan Docs Draft"), which shows much more is built than the plan assumes: swipe pages, the control sheet, lock, apps, seven games, 26 overlays, five face styles and picture faces, six languages, subtitles, remote controls, an own-model mode (`brain = "llm"`), a web flasher, a setup code, and more. So:

**Step 0 is reconciliation, and you are the one who can do it.** A first pass comparing the docs draft with the plan is being added to the plan as section 26 by the research session; treat it as a draft and correct it from the code.

## Your context is nearly full

Your session shows about 830,000 of 1,000,000 tokens used. Do not run the program from this session. Do steps 1 to 3 below, then start a fresh coordinator session from the handover and this brief, and let the old session end.

## Steps

1. **Handover (before anything else).** Push all locally committed work (firmware, host, docs, the movement limiter, dance v2, themed tiles) to named branches on the remote. Write `docs/handover-2026-11-18.md` in the repository that holds the truth, with: what is built and flashed, built not flashed, planned; every screen, gesture and setting as it is today; memory numbers on the unit; the wake word and audio setup; which ESP-IDF and how the firmware is kept (patches or a tree); build, flash and bench times; known bugs (including the "no reply after wake" problem); hands-on checks not done; open owner decisions (sponsors listing, Bluetooth, egress capture, release key, release approval).
2. **Reconcile the plan.** For every item id in the plan mark: already done, shrink to verify or polish, keep, change, or drop. Correct sections 1, 9a, 12.1, 19 and 20. Record what your work has that the plan lacks. Land the corrected plan.
3. **Owner decisions.** Put the open ones in `docs/plans/stackchan-decisions.md` with a recommendation and a default (plan section 17.2). The ones that shape everything: own firmware as the target (section 21.2), the gesture map (20.4) against today's real gestures, standing approvals (17.2 item 5).
4. **Operating model (plan section 17).** Set up the lander pickup for cloud branches, the ledger, the item prompts, the coordinator schedule and the daily digest.
5. **Start the three tracks (plan section 23)** with the lanes of section 24: Codex first, the local coder second, Claude for judgment, cloud sessions for parallel lanes.
   - Playground first: headless virtual unit, golden frames, then the 3D view starting from `qua121/stackchan-simulator` (Apache-2.0), face first (section 18.6).
   - Firmware: baselines and speed (lane T), safety and security on the unit, portable screen modules.
   - App: spec work, Bot service without Home, Home's robot page.
6. **One unit.** It is also the family's robot. Bench use goes through one queue; it ends each window on the released image; wireless push and automatic rollback are the normal path once built (section 18).

## Rules that bind the work

- `docs/design/RULES.md` in Home overrides this plan. Only the owner changes a rule; the boundary rule text (plan section 5, as revised in section 12) and the adult-only standalone mode need his `Owner-approved` commits.
- A "no" rests on physics, safety, privacy or product judgment, never on what was tried before (section 21).
- Every new concept goes into the shared robot interface first, so Reachy Mini gets it too (section 6): the movement limiter you just built is the first one to move there.
- Minimal owner time: two short hands-on sessions a week, one release yes, a decision file. Do not block on him; do not ask him to test outside those sessions unless it stops the line.
- Security findings from other projects are the checklist for ours (audit section 4).

## What the research session could not verify

Anything about the unit's real behavior; anything after firmware 0.2.213; all effort estimates; the license of the official 3D model; Espressif component fit against your ESP-IDF version; account usage limits.
