# The Code app, brought up to date: screens, reuse and the sandbox (2026-11-21)

Architect item `CODE-REFRESH-DESIGN-01`. Design only: no code is written.

[local-coding-2026-10-17.md](local-coding-2026-10-17.md) designed the Code app five weeks ago. Its screens, records, agent and safety model
stand. Since then the shell, the kit, the rules and the model separation have moved, and its sandbox plan was never tried. This note lists
only what changes. [code-session-tiers-2026-11-21.md](code-session-tiers-2026-11-21.md) already covers tiers and the queue.

## 1. What changed since 2026-10-17 (read from `origin/main` and `commons`, 2026-11-21)

| Area | Then | Now |
|---|---|---|
| App shell | The note drew its own three columns | A package declares `contributes.sidebar`; `PackageAppPage` draws rail, list and page with the kit `SectionSidebar` and no per-app Home code. Chat, News, Library and Settings use the same column |
| Right side | A custom panel with four tabs | Rule S2 (2026-10-27): nothing shows on the right except the standard right pane (kit `right-pane`, with `tabs`, pin and close) |
| Kit | Five gaps listed for `CODE-KIT-01` | All five still open. New shipped parts fit the session view: `tier-segment`, `pending-actions`, `confirmation`, `status-card`, `chat-header`, `composer-parts` |
| Asking before acting | Its own approval rules | One policy for every tool: an effect class and do, ask or never, decided in code (`lib/toolBrake.ts`, agentic-actions plan 2026-10-29), with receipts and Undo |
| Roles | Minors' limits written as fixed | Rule C3 (2026-11-16): a role's protections are defaults an admin may override, except Prohibited content and crisis handling. C10: a person is never shown what they may not use |
| Models | The note names models and "Fast" and "Careful" | Rules E1 to E8: Home holds no model data or names; a lint fails the build on a model name in Home source. The Stack's pack owns them |
| Sandbox | Apple `container` chosen, spike owed | No spike done, tool not installed. The tool reached 1.x. Its network isolation has open upstream reports (section 4) |

## 2. Screens

The layout is still Claude Code on the web (rule S2: its layout, not its styling). What changes is which shipped parts draw it.

- **Where it lives.** The catalog package `code`, page index at `/apps/code`, with a rail entry "Code" beside Chat. No hand-written route.
- **Sessions list.** Drawn by `SectionSidebar` with Chat's props (search, hide and show, Cmd/Ctrl+B, the same remembered choice through
  `useChatColumn`): New session at the top, then sessions newest first with state, repository and `+N -M`. On a phone it moves into the
  shell drawer like every other column. Exception (CODE-UI-04, 2026-11-22): the package does not declare `contributes.sidebar`, because a
  declared sidebar is static schema and these rows are live (a polled hub query with state dots), exactly as Chat's rows are fed by the
  thread runtime and not by a manifest. `CodePage.tsx` draws it with the shared column; a test fails if Code draws its own column config.
- **Session view.** The transcript is the assistant-ui thread with the shipped tool cards, as designed. The header is the kit
  `chat-header` with the title, `repo @ branch`, the mode chip, the tier control (`tier-segment`) and the context meter.
- **Changes, Files, Terminal, Plan** are tabs of the standard right pane, after the companion, which stays its first tab (S2). It opens when the person clicks a file, a diff card or a
  command, and can be pinned. This replaces the note's custom right panel.
- **Composer.** The shipped `composer-parts`, the `message-queue` above it, and the one status line under it (rule S6).
- **A held turn** (queued, or Max not free) shows the kit `pending-actions` row, which carries "Use Standard for this message".
- **Approvals.** The agent's actions get effect classes and go through the tool brake like every other tool. Ask shows the kit
  `approval-card`; a finished action that can be undone shows the `confirmation` receipt, and its Undo restores the checkpoint. No second
  ask flow. A session that has read content from outside the house cannot push, open a pull request or reach a new host without the
  person's click, whatever the mode (the agentic-actions rule).
- **Still owed in the kit first (`CODE-KIT-01`, unchanged):** file tree selection, diff line comments and compare label, a live terminal
  tail, a read-only code view, and the three schema nodes.

## 3. Reused, not rebuilt

| Need | Reuse |
|---|---|
| Delete and restore a session | `lib/trash` |
| Done, needs you, workspace expiring | `lib/notifications.ts` with three declared `coding.*` types |
| A turn that outlives the tab, and resume | the turn deadline and resume rules chat has (no time cap for an adult's written turn) |
| A long transcript | the agent's compaction, shown with the existing line |
| Files into a session | `lib/attachments.ts`; a result saved out goes through `lib/artifacts.ts` |
| Who may code | the `use:code` grant in the existing grant vocabulary, with its approver cell per age band |
| A session on a schedule | later, after the scheduler's turn kind (`SCHED-02`) exists |

Corrections to the 2026-10-17 note that follow from the rule changes:

- Every model name and the labels "Fast" and "Careful" leave the Home side of the design. A person picks a tier; the Stack's pack names
  and holds the model (rules E1 to E8).
- Where that note says a minor's limit holds "whatever the grant says", read: it is the child and teen role default, and an admin may
  override it for one person or the household (rule C3). Prohibited content and crisis handling stay fixed for everyone.
- A control a person may not use is absent, never shown locked (rule C10).

## 4. The sandbox, checked again

**The shape stays:** one small Linux virtual machine per session, one folder mounted, no network except the gateway and an allowlist
proxy, and git credentials only on the hub. Claude Code on the web is built the same way. The agent itself (OpenCode) has permissions but
no sandbox, so the virtual machine is the only wall.

**What is not proven.** Nothing has been run. Upstream reports on Apple's tool say the host stays reachable from a "host-only" network and
that raw-address traffic can leak in some setups. The local lane's wrapper is not a model to copy: it blocks the internet but leaves every
port on this computer open, the live hub included, and fences no files.

**Gate: the spike (`CODE-SANDBOX-01a`) passes only when all of these fail from inside the machine, run as root:**

1. Reach any port on the hub other than the gateway port and the proxy port (the live hub, the Stack, a dev hub, SSH).
2. Reach another device on the home network.
3. Reach the internet by raw address.
4. Resolve a name (the machine gets no resolver; only the proxy resolves).
5. Reach a host that is not on the session's list through the proxy.

If Apple's tool cannot pass with a block the guest cannot undo, the note's own fallback applies: a firewall anchor installed once with the
admin's password, or the shared-VM runtime with networking off. No session ships before the gate passes on the real computer.

**Holes the 2026-10-17 note did not cover, and the fix:**

| Hole | Fix |
|---|---|
| The agent writes a git hook or git setting, and the hub's git runs it at Push | The hub never runs git inside the session's folder as it stands. Push goes from a clean copy made by the hub, with hooks, file monitors, filters and the folder's own git settings switched off; submodule and large-file settings are scanned first |
| Names looked up to leak data | No resolver in the machine (gate item 4) |
| A link in the folder that points outside it | Hub code that reads the workspace never follows links out of it; the workspace is its own folder with nothing beside it |
| A setup script that misbehaves | It runs under the same network rules as the session, and its cached result is keyed by the script's hash and the host list |
| Data sent out through an allowed site | No site is allowed by default. Allowed sites show on the Push screen. Each request the proxy lets through is a line in the person's own session record (`coding-event`), never in household logs (rule 6a) |
| One session eating the computer | A disk limit on the workspace, a process limit, the 30-minute step budget, and a restart of a machine whose memory keeps growing (the runtime does not give freed memory back) |

**The safety test (`CODE-SAFE-01`) gains** a planted repository for each row above: a hostile hook, an outward link, a script that phones
out, a prompt in a file that asks the agent to send the code away. Pass means nothing leaves and nothing runs on the hub.

## 5. Rule check

- **S1, S2:** the rail stays; layout from the shipped column and the standard right pane; nothing custom on the right.
- **S5, S6:** copy from the spec; waiting and status on the composer line, the session row, notifications and the Status page.
- **Rule 9, 9b:** shipped parts only; the five gaps are closed in `commons` first.
- **Rule 1 and the agentic-actions plan:** one brake, effect classes in code, approval after untrusted content.
- **C3, C10:** role defaults an admin may override; nothing shown locked.
- **E1 to E8, rule 11:** no model name or model data in Home; only the Stack runs models and the sandbox service.
- **Rule 6a:** the proxy line and command trail are the person's own record; household logs carry typed counts only.
- **PRIVACY.md:** default no network; every allowed host is a privacy row, as in the 2026-10-17 note.

## 6. Slices (rows for `docs/BACKLOG.md`, "Local coding")

| Row | Size, repo | After | Objective |
|---|---|---|---|
| CODE-SANDBOX-02 | S, `stack` | with CODE-SANDBOX-01a | The five-item network gate of section 4 as a repeatable test run as root inside the machine; the spike is not done until it passes |
| CODE-GIT-02 | S, `home`; risky surface: credentials | with CODE-GIT-01 | Push from a clean hub-made copy with hooks, monitors, filters and local git settings off; link-safe reads of the workspace |
| CODE-APP-02 | S, `catalog` then `home` | with CODE-APP-01 | The app on the declared sidebar and the standard right pane; `chat-header`, `tier-segment`, `pending-actions`, `confirmation`; no custom panel |
| CODE-BRAKE-01 | S, `home` | with CODE-AGENT-01 | The agent's actions mapped to effect classes and the tool brake; approval after untrusted content |
| CODE-SAFE-03 | S, `home` | with CODE-SAFE-01 | The planted repositories of section 4 added to the safety test |

## Supersedes

- [local-coding-2026-10-17.md](local-coding-2026-10-17.md) section 3.3: the custom three columns and right panel (section 2 here).
- The same note, sections 3.3 and 8: its own approval rules, where they differ from the tool brake (section 2 here).
- The same note, section 3.4: host-side git inside the session's folder, and the setup script's network (section 4 here).
- The same note, sections 3.7 and 7: minors' limits written as fixed (section 3 here).
- The same note, section 4.3 on the Home side: model names and the "Fast" and "Careful" labels (section 3 here).

## Decisions for Jesse

None open. Installing Apple's `container` tool on the Studio for the spike is a download, which needs no ask.

## Architect verdict

Ruled by the `architect` agent; the record is `data-scratch/architect/CODE-REFRESH-DESIGN-01.verdict`.

- First pass, 2026-11-21: APPROVED, with one optional wording fix (the companion stays the right pane's first tab), applied.
