# Local coding: the Coding switch, personal API keys and the Code app (2026-10-17)

Jesse, 2026-10-17: "We need a design for local coding - as an admin I should be able to turn on the coding feature and users
can connect and code via an api key. Also should have a web browser coding ability identical to Claude Code on web. Design
this." This note decides the household switch and its limits, personal API keys and the endpoints coding tools connect to, the
web Code app and its per-session sandbox, the coding model per hardware tier, the safety model, the records, the screens and the
slices. Design note only: no code, no spec tag, no setting changed, no GPU bench run. Architect item `CODE-DESIGN-01`.

Jesse answered the open decisions in chat on 2026-10-17 (owner-approved 2026-10-17), and this revision (architect item
`CODE-DESIGN-02`) records them: (1) **Who**: "for anyone permissioned, adults by default": every adult may code once an admin
turns Coding on, and any other person (a teen or a child) only through an explicit per-person admin grant that keeps every
minor protection (section 3.7). (2) **Keys away from home**: only through the household's Tailscale, only when an admin turns
it on. (3) **The coding model**: a second model, its own process, loaded only while someone is coding and unloaded after about
15 idle minutes; the chat model stays loaded (section 4.3). Section 12 lists what is still open.

Plain-words summary: [local-coding-overview-2026-10-17.md](local-coding-overview-2026-10-17.md). Clickable mockup (admin
settings with "Adults by default" and the per-person list, the grant dialog for a teen or a child, API keys with a copy-once key and connect snippets, the Code app on a phone and a desktop):
[assets/local-coding-2026-10-17/index.html](assets/local-coding-2026-10-17/index.html), screenshots in its `shots/` folder.

Numbers are marked: **measured** (ours, with the record named), **published** (a vendor card or a public benchmark, linked), or
**estimate** (arithmetic from published sizes, written `(?)`). Nothing here was measured for this note.

## 1. What exists today (from code and records, 2026-10-17)

| Piece | Where | State |
|---|---|---|
| The `coding` role | Stack `backend/src/roles.ts:57` (wire `chat`, `/v1/chat/completions`, `sharesModelWith: "chat"`); `profiles.ts`: resident on p16, p32, p64, on demand on p128; no model binding for it in `PROFILE_MODEL_BINDINGS` | Declared, never bound: every coding call today is the household chat model (Muse Glimmer 30B on p32 and up) on its one slot |
| Stack coding-tool items | Stack `docs/plans/stack-plan-review-2026-09-18.md` item 12: STACK-60 (binding and discovery: no `GET /v1/models`), STACK-61 (context from the Studio bench); "Agents remain clients and never become a Stack runtime" | Open, no design |
| The Stack's auth | Stack `backend/src/app.ts`: binds 127.0.0.1, "loopback is the whole authentication"; `docs/dev.md`: "No people, no clients, no keys" | Every person-facing check must live in Home |
| A per-person bearer token | Home `backend/src/lib/apiToken.ts`, table `person_api_tokens` (`schema.ts:128`): `maipai_` plus 32 random bytes, sha256 with no pepper, 365 days, **one token per person** (issuing replaces), shown once, `lastUsedAt`; `POST` and `DELETE /api/settings/api-token`; no screen calls them | Real but interim; no scopes, no name, no list, unpeppered (CREDENTIALS.md wants a pepper on one-way secrets) |
| Home's OpenAI-style door | Home `backend/src/routes/openai.ts` `POST /v1/chat/completions` behind `requireApiToken`: takes the last user message, runs it as a **spoken turn** through the turn engine (rule 12's port list), no tools passthrough, no `/v1/models`; Wyoming (`lib/wyomingServer.ts`) authenticates with the same token | A turn brain for Home Assistant and satellites, not a model endpoint; stays as it is |
| Device tokens | `lib/deviceTokens.ts`, table `device_tokens`: hashed, 365 days, up to 20 per person, a `Device` row each | The multi-token precedent for a person |
| Away access and TLS | `lib/tailscale.ts`, `tailscaleTls.ts` (the household's own Tailscale, set up by an admin, certificate renewed by the `tailscale.renew_certificate` job); `lib/householdCa.ts` (a household CA and a leaf for `maipai.local` and the LAN addresses) | HTTPS on the tailnet with a publicly trusted certificate; on the LAN once the CA exists |
| Kit parts for code | `commons/ui/src/elements/`: `code-diff`, `reviewable-diff`, `file-tree`, `terminal-block`, `code-runner`, `agent-plan`, `todo-list`, `approval-card`, `permission-grant`, `message-queue`, `stopped-run`, `checkpoint-history`, `context-display`, `task-card`, `background-inbox`, `tool-call`, `tool-group`, `thread-list-sidebar.aui` | Present; several were built as showcase cards (`visibleCount`, `cycle` props) and need additive live-data props (section 6) |
| Org measurement of a local coder | `.github/docs/local-coding-model.md`: Qwen3.8-27B (dense, Apache-2.0) at GSQ/RCO IQ3_XXS-mtp on two 8 GB cards: 31 tok/s at 5k context with MTP (**measured**), Sonnet's output on precise S and M briefs at 2 to 2.5 times the time, no judgment on ambiguous briefs; OpenCode as the agent | The quality evidence this note leans on |
| The lane | BACKLOG STUDIO-LANE-01 (OpenCode on the Studio for Jesse's own S and M briefs), LOCALCODER-LIFT-01 (bench pass rate, 35B-A3B comparison) | Jesse's own coding lane; this note's gateway serves it too |
| Grants | `spec/vocab/grant-actions.json` `use:<package>` with a per-band approver; `lib/grants.ts` | The "chosen people" mechanism, reused |
| Data classes | `backend/src/lib/dataClasses.ts`, spec `data-class.schema.json` | One new class, `coding` |

No backlog row covers a coding product feature, a coding API key, a sandbox or an Anthropic-compatible endpoint (searched
`BACKLOG.md` and `BACKLOG-HISTORY.md` for coding, coder, codex, api key, sandbox, container, `/v1/`, Anthropic).

## 2. Purpose and audience

**Who.** Anyone an admin permits; adults by default. Coding is off for the household until an admin turns it on (like every
heavy model that holds memory). When on, every person on Adult controls may use it by default (`coding.adults_by_default`,
on), and an admin may turn any one adult off, or turn the default off and pick adults one by one. A person on Teen or Child
controls may code only when an admin grants it to that one person, on a grant every admin can see, with the minor's
protections of section 3.7 kept in full: age and surface gates outrank everything (rule 0). A guest never can.

**Two doors, one engine.**

1. **Your own tools.** A person creates a personal API key and points Claude Code, OpenCode, Aider, Continue, Cline or Codex CLI
   at the hub. The tools run on their laptop; the model runs on the hub. Nothing goes to a cloud model.
2. **The Code app.** In the browser (phone or desktop) a person picks a repository, types a task, and watches an agent work
   in a sandbox on the hub: transcript, tool calls, diffs, files, terminal, plan approval, stop and steer, then Push or Create
   pull request. It copies Claude Code on the web (rule S2).

Both doors call the same gateway, which calls the Stack's `coding` role. The Code app's agent is just one more client of the
gateway, holding a short-lived session key.

**What it is good for (set expectations in the copy).** The org's own measurement: a local 27B "types as well as a frontier
model on well-defined work, at half the speed, at no cost per token", and "cannot design, diagnose, or catch its own wrong
turns". The app's empty state says so in plain words: "Best for clear, small tasks: fix this test, add this field, write tests
for this file."

## 3. Flow and screens

### 3.1 The admin switch (Home settings, Coding)

A new section in the `home` settings area, drawn by `SettingsShell` (rule S4), `min_role: admin`, icon `code`:

- **Card "Coding"** (group `household.coding`): the switch `coding.enabled` ("Let people write code with Home's AI", off).
  Under it, from `describeSetting` (rule S5): what turning it on loads ("Loads a coding model when someone uses it. It uses
  about 40 GB while busy and gives it back after 15 quiet minutes" on p128; the figures come from the Stack's admission record,
  never hand-written). On a p16 or p32 computer the switch is disabled with the reason line "This computer does not have the
  memory for coding. It needs 64 GB." (the `unsupported` package state of the packages note, 4.1).
  Two child switches: `coding.web.enabled` ("The Code app", on) and `coding.api.enabled` ("Coding tools on people's own
  computers, with API keys", on).
- **Card "Who can code"** (group `household.coding_people`): the switch `coding.adults_by_default` ("Adults by default",
  on: "Everyone on Adult controls can code unless you turn them off below"). Under it, the household's people, adults first,
  then teens and children, each with a switch. A person's switch is the one grant `use:code` (the existing grant mechanism,
  `lib/grants.ts`): for an adult the switch shows the default and turning it off writes a `deny` grant (turning it back on
  removes it); with the default off, turning an adult on writes an `allow` grant. A teen's or a child's switch is off until an
  admin grants it, and turning it on opens the minor grant dialog of section 3.7 (kit `Dialog`), never a bare toggle. Each
  minor's row carries the guardian line "Needs your grant. Their protections stay on." and, once granted, "Granted by Nadia on
  Oct 17" with what the grant allows. Guests are never listed. There is no "Only admins" choice: an admin turns the default
  off and turns themselves on.
- **Card "Sharing the computer"** (group `household.coding_limits`, level advanced): `coding.max_sessions` (Code app sessions
  running at once: p128 default 2, range 1 to 4; p64 default 1, range 1 to 2), `coding.max_streams_per_person` (2),
  `coding.requests_per_minute_per_key` (60), `coding.daily_tokens_per_person` (0 means no cap), `coding.keep_warm_minutes`
  (15), and on p128 the model choice `coding.model` (Fast, the default; Careful; section 4.3). The card's help line, from
  `describeSetting` with the Stack's admission figures (static, not live), says "Chat always comes first. Coding waits or slows
  down, never chat." What is running and how much memory it holds right now is not drawn here: it is a coding row on the
  Status page (section 3.5, rule S6), linked from the card as "See what is running".
- **Card "Internet for coding"** (group `household.coding_network`): `coding.network.default` (No internet, the default; or
  Package downloads), `coding.network.allowed_hosts` (the household list people may approve for their own sessions; presets
  npm, PyPI, crates.io, the Go module proxy, RubyGems, each off until the admin ticks it), `coding.network.people_may_approve`
  (on). A host outside the list needs an admin to add it.
- **Card "Away from home"** (inside the Coding card, shown only when away access is set up): `coding.api.away` ("API keys work
  away from home, through your Tailscale", off). Decided by Jesse, 2026-10-17: the household's Tailscale is the only way a key
  works away from home, and only after an admin turns this on; there is no public address and no other tunnel.
- **Stop all coding now**: one destructive button (kit `AlertDialog` confirm) that sets `coding.paused`: every sandbox is
  stopped (work kept), every API call answers 503 with "Coding is paused by an admin. Try again later.", the Code app shows the
  paused line (S6, section 3.5). Resume clears it. Turning `coding.enabled` off does the same and also hides the app.
- **What an admin sees of use**: on the Status page only (S6), counts only (rule 6a): sessions running now, the coding model
  busy, idle or unloaded, memory it holds. Never whose session, which repository, a title, a prompt or a key's last address.
- **A person's coding credentials**: on a person's admin page (Family), a "Coding access" row lists that person's API keys and
  git connections without any name, host or repository the person typed (rule 6a): for each, its kind (API key, GitHub,
  Gitea), status, created date, expiry and, for a key, the four-character hint; with "Revoke" per row and "Revoke all". This is
  CREDENTIALS.md's "a status, an expiry, and a one-click revoke in the admin UI". It shows no last-used time or usage, which
  are the person's activity. For a teen or a child the same row leads with the coding grant: who granted it, when, and what
  it allows (section 3.7), with Change and Take back; every admin sees it, which is what makes the grant guardian-visible.

### 3.2 A person's API keys (Settings, Coding)

A new section in the `account` area, kind `view` (`account.coding_keys`), `min_role: child` (the grant, not the role, decides), shown only when coding is on and
the person may code (`needs: ["coding.allowed_for_me"]`). For a teen or a child it opens with a read-only "What your grant
allows" card (granted by whom and when, the limits of section 3.7) and shows the keys parts below only when their grant allows
API keys:

- **Your keys**: a kit `Table` of name, what it can do ("Coding"), created, expires, last used ("Today, on the home network" or
  "Yesterday, away from home": a coarse place word, never the address in the list; the address is in the key's detail sheet,
  for its owner only), and a row menu (Rename, Revoke). Up to 10 keys.
- **Create a key** (kit `Dialog`): name ("Laptop, Claude Code"), expiry (7 days, 30 days, 90 days default, 1 year),
  what it can do (Coding; the existing voice and Home Assistant use is the second scope, `turn`, section 4.1). Create shows the
  key **once** in a monospace `Input` with a Copy button and the line "Copy it now. You will not see it again. Anyone with
  this key can use coding as you." Closing the dialog drops the value from memory.
- **Connect a tool**: kit `Tabs` (Claude Code, Codex CLI, OpenCode, Aider, Continue and Cline), each a ready snippet with the
  hub's address and the model name filled in and the key shown as `<your key>` (the snippet never embeds a key after the
  dialog closes). A line under each tab says what the tool still sends elsewhere (section 5).
- **Use**: today's requests and tokens per key, for the person only.

### 3.3 The Code app

A catalog `app` package `code` (`getmaipai/catalog` `apps/code/`, bundled in Home's default set, hidden unless coding is on and
the person may code). Layout copied from Claude Code on the web (rule S2): at 640 px and up the rail, then the sessions list,
then the session; on a phone the sessions list is the root screen and a session opens full width.

Claude Code on the web, feature by feature (read from code.claude.com/docs/en/claude-code-on-the-web, web-quickstart and
cloud-environments on 2026-10-17), and what Home does:

| Claude Code on the web | Home's Code app | Verdict |
|---|---|---|
| Sessions sidebar; archive, filter archived, delete | Sessions list with the same actions; delete goes to the household trash | Copied |
| Connect GitHub (app or token); others only as an uploaded bundle with no push back | GitHub and Gitea connections (token or device flow) and repository folders on the hub, all with push | Copied and widened (Gitea is the household's own) |
| A fresh Ubuntu VM per session, about 4 vCPU, 16 GB, 30 GB | A lightweight VM per session on the hub, 4 CPUs, 4 GB, 30 GB (a household computer shares memory with the models) | Copied, smaller |
| Environments: setup script cached as a snapshot, environment variables, network secrets added by the proxy | Setup script and variables, per person or shared by an admin; network secrets later | Copied in part, CODE-NETSECRET-01 |
| Network: None, Trusted (a default allowlist), Full, Custom | None (default) or the household's allowed hosts; no Full | Narrowed: nothing leaves the house unless allowed |
| Prompt plus repository plus branch; URL prefill | The same, with `?repo=&branch=&prompt=` | Copied |
| Watch and steer: messages queue mid-run, ✕ takes one back | `message-queue` with take-back; Stop | Copied |
| Diff view with a file list, compare against a branch, inline comments that join the next message | Changes tab: file tree, diff, compare against, line comments | Copied |
| Permission modes Auto, Accept edits, Plan, switchable mid-run | Auto-edit, Ask before acting, Plan, switchable | Copied (no classifier "Auto") |
| Parallel sessions, each its own branch | Same, capped by the household | Copied |
| Push a branch, Create PR (draft or ready), Auto-fix on CI | Push branch, Create pull request (draft or ready) | Copied; Auto-fix later (needs CI webhooks into the house) |
| Teleport a session into the CLI | "Open on your computer" (fetch the branch); live attach later | Partly, CODE-ATTACH-01 |
| Share (private, team, public) | One household adult, read only | Narrowed: never public |
| iOS and Android Code tab | The phone layout of the same app; Go later | Copied in the browser |
| Sessions pause when idle, resume on the same VM; history restored | Sandbox stops when idle; workspace and transcript kept | Copied |
| Routines (scheduled or triggered sessions) | Not in this version | Later, through the household scheduler |

**Sessions list.** A search box, New session, and the person's sessions newest first, each with its title, repository and
branch, a state (Working, Needs you, Done, Paused, Failed, Waiting for a free slot), `+N -M`, and the time. Filters: Active,
Archived. Archive and Delete (to the household trash, media-apps note section 12) per row.

**New session.** A composer with: the repository picker (a connected GitHub or Gitea repository, a repository folder on the
hub, or Empty), the base branch, the environment (section 3.4), the mode (Plan, Ask before acting, Auto-edit), and the task box.
Send starts a session; the URL may carry `?repo=&branch=&prompt=` like claude.ai/code's prefill.

**A session.** Desktop: the transcript in the middle (an assistant-ui thread: the person's messages, the agent's text, its
reasoning folded, each tool call as a kit tool card: Read, Edit with a small diff, Run with its terminal output, Search files,
Write todo), the composer at the bottom (Send; while running, Stop and a queue of messages typed meanwhile, which steer the
agent at its next step), and a right panel with tabs **Changes** (file tree with `+N -M` per file and the diff of the selected
file, against the base branch; line comments queue into the next message), **Files** (the workspace tree, read only, opening
a file in a read-only code view), **Terminal** (every command's output in order, exit code and time), **Plan** (the agent's
todo list). The header holds the title, `repo @ branch`, the mode chip, the context meter (kit `context-display`), and
**Create pull request** (or **Push branch** for a hub folder). A phone puts Chat, Changes and Terminal as tabs under the header.

**Plan and approve.** In Plan mode the agent reads and writes a plan but changes nothing. The plan shows as a kit `agent-plan`
card, and a bar over the composer offers **Approve plan and start** (switches to Ask or Auto-edit, the person picks), **Keep
planning**, or editing the plan text. In Ask mode each command outside the session's allowed list and each first write to a
file shows a kit `approval-card` (Allow once, Allow for this session, Deny). A request for an internet host shows a kit
`permission-grant` ("Allow registry.npmjs.org for this session?") only if the household list holds it; otherwise "An admin
has to add this site first."

**Stop and steer.** Stop ends the current step at once (the agent's abort); the transcript keeps everything with a kit
`stopped-run` line and Continue. A message sent while the agent works joins the `message-queue` and is read at its next step;
the ✕ on a queued message takes it back.

**Checkpoints.** Each agent turn is a checkpoint (the agent's own snapshot). A kit `checkpoint-history` sheet restores the
workspace to any of them.

**Push and pull request.** Push branch and Create pull request (Draft or Ready) run on the hub, never in the sandbox
(section 3.4): Home runs the secret scan over the diff first; a finding blocks with "This change holds what looks like a
password or key in `config/dev.env`, line 4. Remove it, then try again." The branch is `maipai/<short title>-<4 letters>`;
the title and body are written by the model and editable before sending.

**Parallel sessions.** A person may run several; the household cap is `coding.max_sessions`. Over the cap, a new session
waits with the state "Waiting for a free slot" and starts by itself.

**When it is done.** A notification of the new type `coding.session_done` (and `coding.needs_you` when an approval waits),
audience the session's owner, through the existing bell and browser alerts (S6). The session row's state changes in place.

**Open on your computer.** A sheet with the two commands to take the branch locally (`git fetch` and `git switch`) after a
Push, and, for a person whose own tool already uses a key, the note that the same model answers there. A live "continue in
the terminal" (the agent's attach command) is a later slice, CODE-ATTACH-01, after it is verified.

**Share.** A read-only snapshot shared with one other adult of the household, from the session's own menu (PRIVACY.md: "a person
may share their own screen"). Never a public link. A teen or a child may share a snapshot with a household admin the same
way; it is their own act, never a view an admin opens on them. Later slice CODE-SHARE-01.

### 3.4 The sandbox, the agent and the session's workspace

**One sandbox per session, a lightweight virtual machine.** Options compared on the Mac Studio (macOS 26.4 or later):

| Option | Isolation between sessions | Limits | Network control | Licence and fit | Verdict |
|---|---|---|---|---|---|
| Apple `container` (Containerization framework) | A separate lightweight Linux VM per container (Virtualization.framework), its own kernel | `--cpus`, `--memory` per container | Its own vmnet network; host-only and egress rules to verify in the spike | Apache-2.0, Apple-maintained, OCI images, macOS 26+ on Apple silicon | **Chosen** |
| Docker on Colima (Lima VM) | One shared Linux VM; containers share its kernel | cgroups per container | `--network none`, internal networks, mature | MIT and Apache-2.0; one VM for all sessions | Fallback if the spike fails; weaker isolation between people |
| Docker Desktop | Same as Colima | Same | Same | Proprietary licence | Rejected |
| `sandbox-exec` profiles | Same kernel, same user | None for memory or CPU | Coarse; deprecated by Apple | Built in | Rejected: no resource limits, deprecated |
| A macOS user per session | Same kernel; file permissions only | None useful | pf rules per user, root needed | Built in | Rejected: weak, and every tool would run on macOS, not Linux |

The sandbox is a **Stack service** (`/stack/v1/sandboxes`), because the Stack already owns pinned downloads (the runtime and
the image by sha256), launchd, and the governor that admits memory against the models. It is a workload host, not an agent
runtime: the agent inside is a client of the gateway, which keeps the Stack review's line ("Agents remain clients and never
become a Stack runtime"). Home owns people, gates, sessions, keys, git and the UI. Linux and Windows hubs get Coding later
(CODE-LINUX-01, Podman rootless with gVisor as the first candidate); the Stack exposes the same service there.

**The image.** One pinned OCI image built from a public base (Ubuntu 24.04 LTS), with git, ripgrep, jq, Python with uv, Node
LTS, Go, Rust and a C toolchain (the set Claude Code on the web pre-installs), and the agent. No Docker inside (no nested
virtualization). An environment may add a setup script (runs once as root at session start, before the agent, with the session's
network policy; its result is cached as a snapshot per environment until the script or the hosts change, like Claude Code on the
web). Environments hold plain variables only in this version; secrets for private registries wait for CODE-NETSECRET-01
(section 3.4, Secrets).

**The agent: OpenCode, pinned.** Reuse check: Claude Code (proprietary, and its maker does not support it against other
models), Codex CLI (Apache-2.0, needs the Responses wire, no documented server mode for a web front end), Aider (no agent
server), OpenHands (MIT, heavy, its own UI and sandbox), and OpenCode (MIT): a headless server (`opencode serve`) with an HTTP
API and an event stream, sessions, plan and build agents, ask, allow and deny permissions, per-turn snapshots with revert, todo,
abort, and a provider block for any OpenAI-compatible base URL. The org already drives it over HTTP (STUDIO-LANE-01) and measured
it with this model family. Chosen: OpenCode inside the image, its server bound to the sandbox's internal address only; Home's
backend talks to it through the Stack's port forward for that one sandbox. Its settings follow the org measurement: the model's
own sampling, the context limit set to the server's window, output 8,000, a 20-minute request timeout, no step cap but a
wall-clock budget per message (default 30 minutes, then the agent stops with a `stopped-run`), its ask-the-user tool off (the
person steers through the queue), every git command except local commit denied.

**Filesystem.** The session's workspace is a folder on the hub (`<data>/coding/<person>/<session>/work`), the only mount, read
and write. Nothing else from the hub is visible: no people, memory, photos, conversations or household storage. A person may add
one of their own household storage folders read-only from the New session sheet ("Add a folder from Home"); it is listed in the
session header and the transcript. A teen's or a child's session never gets a household folder: "Add a folder from Home" is
not offered to them, whatever their grant says (section 3.7). Snapshots of the workspace beyond the agent's own checkpoints (before Push, on archive) are
APFS clones (`clonefile`), instant and space-sharing.

**Network.** Default: none. The sandbox's only routes are (a) the gateway at a host-only address, with a session key scoped
`coding:session`, which reaches `/code/v1/*` and nothing else of Home, and (b) when the session allows hosts, an egress proxy on
the host that permits HTTPS `CONNECT` only to the session's approved hosts. The proxy is a pinned, maintained one run by the Stack
(reuse check: tinyproxy, GPL-2.0 as a separate process, `FilterDefaultDeny` with a per-session host list; Squid is heavier for
the same job; a hand-written proxy is not needed). The spike (CODE-SANDBOX-01a) proves the VM cannot reach anything else: the
LAN, Home's own port, the Stack's port, the internet directly. If Apple's runtime cannot hold a host-only network without root,
the installer adds one pf anchor once with the admin's password, recorded in the runbook. A fixed deny list the admin cannot lift
covers the live video services of rule V1 and the adult-site host list.

**Secrets.** The sandbox never holds a git credential or a person's secret. Git runs on the hub: Home clones into the workspace
before the agent starts and pushes from the workspace after the person clicks Push, with the person's git connection read from
the keystore and handed to git through a credential helper in the child process's environment (CREDENTIALS.md: never on a
command line). Plain environment variables are visible inside the sandbox and the screen says so. **Network secrets are not in
this version**: Claude Code on the web adds a private registry's token at its proxy, but a `CONNECT` tunnel is end-to-end TLS,
so tinyproxy cannot add a header; doing it needs a proxy that opens TLS for that one host with a certificate the sandbox
trusts (Squid's ssl-bump or mitmproxy, both unchecked here). That is its own design, row CODE-NETSECRET-01; until then a
private registry is reached by allowing its host and putting a read-only token in a plain variable, which the screen marks as
visible to the agent.

**Git connections.** In Settings, Coding, "Connect GitHub" or "Connect Gitea" (a fine-grained token for chosen repositories, or
GitHub's device flow), stored per person as a write-only secret with status, expiry and Revoke, by the person and on the
admin's "Coding access" row (section 3.1), the calendar precedent of the packages note, 4.7; a hub folder repository is a path under household storage that the person may read. The push target is
only the session's own `maipai/...` branch: no force-push, no branch delete, no tag push, no push to the base branch. A teen or
a child connects GitHub or Gitea only when their grant allows git hosts (section 3.7); otherwise their projects are Empty or
their own coding projects folder (`<data>/coding/<person>/projects`), never a path in household storage.

**Resource limits and cleanup.** Per sandbox: 4 CPUs, 4 GB memory, 30 GB disk (settings `coding.sandbox.cpus`,
`coding.sandbox.memory_gb`). A sandbox stops after 15 idle minutes and its VM is discarded; the workspace stays, and the next
message starts a fresh VM on the same folder (background processes do not survive, as on Claude Code on the web). Workspaces of
sessions untouched for `coding.workspace_days` (30) are deleted after a `coding.workspace_expiring` notification three days
before; the transcript stays
until the person deletes the session. Storage per person is capped by `coding.storage_gb_per_person` (20).

**How the session talks to the model.** The agent's provider points at `http://<gateway host-only address>/code/v1` with its
session key. The gateway applies the same checks as for a personal key (section 3.6), with the session owner as the person.

### 3.5 Status (rule S6: existing surfaces only)

| Status | Surface | Data source |
|---|---|---|
| Coding model loading ("Coding is starting, about 20 seconds") or paused by an admin | The Code app's composer line and Send hold, the same mechanism as the chat paused or starting state | A `coding` concern in `lib/roleHealth.ts` read through `lib/healthSnapshot.ts` (`availability`, `reason`, `cause`); the admin pause is `coding.paused` beside `lib/chatPause.ts` |
| A session's own progress | That session's row and header state | The `coding-session` record |
| Done, needs you, or a workspace about to be deleted | Notifications (bell, browser alerts) | Three types declared in `lib/notificationTypes.ts` |
| What coding is doing now (sessions running, the model busy, idle or unloaded, the memory it holds) | A coding row on the Status page | `lib/statusApps.ts` over the Stack's role health and governor figures synced by `lib/stackHealthSync.ts`; counts only (rule 6a) |
| The coding engine down | Status page and Repairs | The Stack's role health, synced by `lib/stackHealthSync.ts` |
| Waiting for a free slot | The session's row state | The session record |

### 3.6 The gateway and the API

**Endpoints** (Home, under the prefix `/code`, so the existing `/v1/chat/completions` turn door is untouched):

| Path | Wire | For | Served by |
|---|---|---|---|
| `POST /code/v1/messages` | Anthropic Messages, SSE streaming, `tool_use` and `tool_result`, thinking blocks | Claude Code | llama-server's native `/v1/messages` through the Stack's coding role (published: ggml-org, January 2026) |
| `POST /code/v1/messages/count_tokens` | Anthropic | Claude Code (optional; it estimates without it) | llama-server native |
| `POST /code/v1/chat/completions` | OpenAI Chat Completions, SSE, `tool_calls` | OpenCode, Aider, Continue, Cline and Roo, Zed, the Code app's agent | llama-server native |
| `POST /code/v1/responses` | OpenAI Responses | Codex CLI (its `wire_api = "chat"` was reportedly removed in 2026; unverified) | llama-server native if the pinned build serves it (verified first in CODE-API-02); otherwise Codex is listed as "not yet" |
| `GET /code/v1/models` | OpenAI list | Pickers in Continue, Cline, OpenCode | Home answers from the Stack's coding record: `maipai-coder` and the real model id, with `context_length` |

Rule 2 holds: templates, tool-call parsing, the reasoning split and token counts come from the engine; the gateway never
re-wraps a template and never re-parses a tool call. For an adult it forwards the engine's bytes as they come. What the gateway
does to a request or a stream is limited to: dropping client sampling, adding a system part (the band's topic block for a
minor, section 3.7), reading the engine's own parsed fields (text, reasoning, tool-call arguments) to run the safety floor on
them, dropping reasoning parts at the engine client for a minor (as rule 2 itself requires), adding the crisis resources as a
text part, and, for a child, holding text to sentence boundaries and holding each tool call whole until its arguments pass the
check (a JSON delta has no sentence boundary). Reading the engine's parsed arguments is not re-parsing. Model names: the gateway accepts any `model` value and serves the coding role (Claude Code
sends its own names for background calls); responses carry the household's model id. Sampling fields from the client are
dropped and the model record's own sampling applies (rule 3's principle: each model runs on its own settings; client defaults
are tuned for other models); `max_tokens` passes as a ceiling. The context window is the engine's real one (128k on p64 and
p128), reported by `/code/v1/models`; Claude Code needs at least 100k (its auto-compact window is clamped there), which both
tiers meet.

**Auth and gates, on every request, in this order.** HTTPS only (plain HTTP refused except on loopback). The source address is
on the home network (private ranges) or, with `coding.api.away` on, in the Tailscale ranges; anything else is refused, and a
request through `home.public_url` or a reverse proxy is refused (no public URL, ever). The key (`Authorization: Bearer` or
`x-api-key`) resolves to one key and one person. Then: the key is active and not expired, holds the `coding` scope, the
person is not deleted and not a guest, coding is on and not paused, and the person may code **now**, read from their current
controls on every request: an adult by `coding.adults_by_default` unless a `deny` grant `use:code` names them, or by an `allow`
grant when the default is off; a teen or a child only by an `allow` grant `use:code` an admin wrote for them, and for a
personal key only when that grant allows API keys (`coding.person.api_keys`, section 3.7). Then the per-key rate and the
per-person stream and token caps, the tighter minor caps for a teen or a child. A key never widens anything: it carries no
permission of its own beyond its scope. A person whose controls change is re-checked on the next request: an adult moved to
Teen controls finds their keys suspended (not deleted) unless a minor grant allowing keys exists, and from then on every
minor protection of section 3.7 applies to them. Refusals are plain: 401 "This key is not valid. Make a new one in Settings, Coding.", 403 "Coding is not turned on for
you. Ask an admin.", 429 with `retry-after` in seconds.

**Safety floor.** The deterministic input and output floors of SAFETY.md apply to every coding request (the person's text in, the
model's text out). For an adult the output is checked as it streams, as for an adult's written chat (rule 10). For a teen or a
child the grain, the reasoning rule and the topic block follow section 3.7. The floors never read code for style, only the
non-removable categories. **Crisis resources, offer, never block, for every person** (SAFETY.md: not configurable off): when
the floor sees self-harm intent, the Code app shows the crisis overlay beside the session, and on the API, where Home draws
nothing, the gateway adds the crisis resources (988 and local equivalents) to the answer as a text part. Nothing is blocked.

**TLS for tools.** Away from home the Tailscale address carries a publicly trusted certificate and needs nothing. On the home
network the hub's household CA must be trusted by the tool: the connect screen offers "Download the home certificate" and adds
`NODE_EXTRA_CA_CERTS=~/maipai-home-ca.pem` (Claude Code, OpenCode) or `SSL_CERT_FILE` (Codex, Aider) to the snippet. The
recommended setup for a laptop is the tailnet address at home too, because it needs no certificate step.

**The snippets** (the screen fills in the address; the model name is the stable alias):

```sh
# Claude Code (~/.zshrc or the shell before running claude)
export ANTHROPIC_BASE_URL="https://home.example.ts.net/code"
export ANTHROPIC_AUTH_TOKEN="<your key>"
export ANTHROPIC_MODEL="maipai-coder"
export ANTHROPIC_DEFAULT_OPUS_MODEL="maipai-coder"
export ANTHROPIC_DEFAULT_SONNET_MODEL="maipai-coder"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="maipai-coder"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
export CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1
export CLAUDE_CODE_ATTRIBUTION_HEADER=0
export CLAUDE_CODE_AUTO_COMPACT_WINDOW=131072
```

```toml
# Codex CLI (~/.codex/config.toml), with MAIPAI_API_KEY set in the shell
model = "maipai-coder"
model_provider = "maipai"

[model_providers.maipai]
name = "MaiPai Home"
base_url = "https://home.example.ts.net/code/v1"
env_key = "MAIPAI_API_KEY"
wire_api = "responses"
```

OpenCode (`opencode.json`, provider `@ai-sdk/openai-compatible`, `baseURL` `.../code/v1`, `limit.context` 131072,
`limit.output` 8000) and Aider (`OPENAI_API_BASE=.../code/v1`, `--model openai/maipai-coder`) follow the same pattern. Sources:
Claude Code's LLM gateway pages (code.claude.com/docs/en/llm-gateway-connect, llm-gateway-protocol, model-config), the ggml-org
post on the Anthropic Messages API in llama.cpp, Codex's advanced config page, Aider's and OpenCode's provider docs.

**Tools that cannot use it.** Cursor sends a custom base URL's requests through Cursor's own servers (Cursor staff on its forum),
so a home address never answers and the code would leave the house; the connect screen lists Cursor as "Does not work with a
home AI" rather than offering a tunnel. GitHub Copilot's own models are out of scope.

**Fairness with chat.** The coding model runs in its own engine process (section 4.3), never on the chat process's one slot, so a
coding loop cannot queue a family member's chat turn. Inside coding, the engine holds 2 slots on p128 and 1 on p64; more
requests wait in the gateway's queue (fair by person), and a full queue answers 429 with `retry-after`.

### 3.7 Coding for a teen or a child, by grant

Jesse, 2026-10-17: "for anyone permissioned, adults by default". A teen or a child is not excluded by design; they code only
when an admin grants it to that one person. Rule 0 decides everything here: age and surface gates outrank every rule, and
nothing in this section loosens a protection SAFETY.md calls non-removable. A grant opens a door with the minor's protections
already on; it never chooses a looser mode.

**The grant.** One `allow` grant `use:code` on the minor, written only by an admin (`use:<package>` is an admin-held grant
action in `lib/grants.ts`). The mechanism is the existing one for "grants beside roles": coding's role floor is adult, and
`requireRoleOrGrant` (`middleware/auth.ts`) widens it for exactly the person an admin's `allow` grant names. The grant
vocabulary's cell stays `none` in every band for `code`, because an `approver` cell of `parent` would ask a parent before every
request (`lib/gate/decide.ts` returns `ask_parent` for it whatever grant exists), which the API door has no surface for; the
gate here is the standing grant, not a per-request approval. It is never inherited, never a default, never set by the setup
wizard and never by the minor; `coding.adults_by_default` never reaches a teen or a child. Turning a minor's switch on opens the grant dialog (kit
`Dialog`): "Let Pippa code?", the list "What stays on" (the floors below, in plain words), the choices below, and one
confirmation, "Grant coding", which records `granted_by_person_id`, `acknowledged_at` and `acknowledged_by_person_id` on the
grant (the admin's one confirmation when loosening, as for a person's controls). Take back removes the grant: running
sessions stop with their work kept, keys suspend, and the Code app hides.

**Who the guardian is.** A household admin. Person has no parent or guardian link in spec (`lib/notificationTypes.ts` says so),
so every admin sees, changes and takes back a minor's coding grant, on the "Who can code" card and on the minor's Coding access
row (section 3.1), and the minor sees what was granted and by whom in their own Settings, Coding.

**What the grant lets an admin choose.** Person-scope settings keys, `layers: ["band", "person"]`, the same pattern as the
media keys (`settings/mediaKeys.ts`). `coding.person.api_keys`, `coding.person.git_hosts` and `coding.person.network_hosts`
take `control: {child: guardian, teen: guardian, adult: self}`. The four cap keys (`max_sessions`, `daily_tokens`,
`sandbox_size`, `message_minutes`) are admin-held for every band (`control: {child: guardian, teen: guardian, adult:
guardian}`), and the household cap of section 3.1 clamps any person value, so no adult raises their own share. The minor
never changes any of them; an admin sets them in the grant dialog and later with Change.

| Key | Child default | Teen default | Adult default | What it allows |
|---|---|---|---|---|
| `coding.person.api_keys` | false | false | true | Personal API keys. The dialog says: "A key reaches tools on their own computer that Home cannot see or control. Home still checks every answer." |
| `coding.person.git_hosts` | false, fixed | false | true | Connecting GitHub or Gitea. Off means Empty projects and their own coding projects folder only. Never for a child (SAFETY.md: "A child sees no outbound links"): the dialog does not offer it, and a child's session renders no pull-request or repository link |
| `coding.person.network_hosts` | empty | empty | the household list | Hosts from the household allowed list (section 3.1) the person may approve for a session. Empty means no internet |
| `coding.person.max_sessions` | 1 | 1 | the household cap | Code app sessions running at once |
| `coding.person.daily_tokens` | 100,000 `(?)` | 200,000 `(?)` | the household setting | Starting values; CODE-TEEN-01 sets them from CODE-BENCH-01's numbers |
| `coding.person.sandbox_size` | small | small | standard | Small is 2 CPUs, 2 GB and 5 GB of storage; standard is section 3.4's 4 CPUs, 4 GB and the per-person storage cap |
| `coding.person.message_minutes` | 15 | 15 | 30 | The agent's wall-clock budget per message |

**What no grant, setting or admin reaches (the minor floors).** These are architecture, not choices in the dialog:

1. **The output gate's grain follows the person** (SAFETY.md, rule 10). For a child every sentence is checked before it is
   released, in the Code app and on the API: the gateway holds the model's stream to sentence boundaries before it forwards
   them. For a teen, the household teen setting picks the child's mode (the default) or the adult's. The check covers the
   agent's prose and the text of every file write and every command, before the write or the command happens.
2. **No reasoning for a minor** (SAFETY.md, owner's ruling 2026-09-22). The hub never emits it: the gateway asks the engine for
   no thinking and drops any reasoning part before forwarding (never a client-side hide); the Code app stores none; the
   session record says reasoning was withheld and why.
3. **The band's topic block** (SAFETY.md, sensitive subjects) is part of every model call for a minor, on both doors, rendered
   from the one spec record and added by the gateway as the first system part. The hard lines are the same as for any minor
   turn, and the agent answers within the band's content ceiling. The agent's prose to a minor keeps the band's own limits
   (rule 5: "A child's or teen's chat ... keep their own limits", the band's `max_words` through `replyMaxTokensFor`); file
   and command content is tool output, bounded only by the `max_tokens` ceiling.
4. **Crisis resources, offer, never block.** The same offer every person gets (section 3.6, Safety floor); listed here so the
   minor list is complete.
5. **The real-danger parent alert.** `safety.flagged_turn` fires from a minor's coding session exactly as from chat: text
   free, real danger only.
6. **No household data.** No "Add a folder from Home", no repository folder in household storage, no memory, people,
   photos or conversations. Only the session's own workspace is mounted.
7. **No internet beyond the grant.** Only hosts the grant lists, and only hosts already on the household list; the minor
   cannot approve any other host, and the adult-site host list and the V1 live video list stay locked (rule 0, rule V1).
8. **No web fetch.** The agent's web fetch tool is off for everyone in this version; when a later slice adds it, fetched text
   passes the deterministic floor before it reaches a minor's turn (SAFETY.md).
9. **Keys stay short and tied to the grant.** At most 3 keys, expiry at most 30 days; each suspends at once when the grant
   is changed to no keys or taken back, or when the person's controls change.
10. **Re-checked every request.** The gateway reads the person's current controls each time; a minor's grant never turns
    into an adult's default, and a person moved to Adult controls falls under the adult rules from their next request.

**What a guardian sees, and what they do not.** Every admin sees the grant and its limits, the minor's keys and git
connections on the Coding access row (kind, status, created, expiry, hint, Revoke), and the text-free real-danger alert. No
admin sees the minor's sessions, transcripts, commands, repositories, hosts used or usage counts: rule 6a and
NO-CROSS-USER-VISIBILITY-01 (owner, 2026-10-07: "if a parent wants to read a kid's chats they ask the kid to show them").
A minor may share a session snapshot with an admin themselves (section 3.3, CODE-SHARE-01). The grant dialog tells the admin
this, and the minor's "What your grant allows" card says: "Your sessions are yours. A grown-up can see what your grant
allows, not what you build."

**Not designed in: session logs for the guardian.** Jesse's 2026-10-17 answer also asked for "session logs visible to the
guardian". Rule 6a ("details reach an admin only through a report the affected person previews and sends") and the owner
decision NO-CROSS-USER-VISIBILITY-01 forbid an admin view of a person's activity, and only Jesse changes a rule. This note
does not design it; section 12 lists it as a NEEDS-RULE-CHANGE question. If Jesse changes the rule, the smallest version is
the minor's `coding-event` trail (commands, files written, hosts, approvals, pushes; never the transcript) readable by an
admin on the Coding access row, said to the minor in the grant card.

## 4. Records and settings (spec first)

All additive. Shared shapes land in `commons/spec` with fixtures (roster personas only) and a tag, then Home pins (PINNING.md),
then nothing on the robot (it has no coding). Every record carries id, provenance and the clock stamp (principle 3).

### 4.1 One key store: `ApiKey` (replaces the interim per-person token)

There is no key record in spec today; the interim token is a hub table. One store, extended, not a second one:

| Field | Type | Meaning |
|---|---|---|
| `id` | id (`key_...`) | Also the key's lookup prefix |
| `person_id` | id | Owner; the only person who sees `last_used_*` and usage |
| `name` | string, 1 to 60 | "Laptop, Claude Code" |
| `scopes` | list of `turn`, `coding`, `coding:session` | `turn` is today's voice and Home Assistant door; `coding:session` is only ever minted by Home for one Code app session and expires with it |
| `created_at`, `expires_at`, `revoked_at` | timestamps | Expiry required: 7, 30, 90 (default) or 365 days |
| `status` | `active`, `expired`, `revoked`, `suspended` | `suspended` while the person may not code or may not hold keys (controls changed, coding off, a `deny` grant, a minor's grant taken back or set to no keys) |
| `last_used_at`, `last_used_from` | timestamp; `home_network` or `away` plus the address | Owner only |
| `limits` | `{requests_per_minute}` | Defaults from the household setting |
| `hint` | string | The last four characters, to tell keys apart |

The secret is `maipai_<id>_<32 random bytes, base32>`. The hub stores only an HMAC-SHA256 of it under the existing pepper
(`lib/secret.ts`'s `secret_pepper`; CREDENTIALS.md: one-way secrets are hashed with a pepper) in a hub-only column that never
reaches the wire; lookup is by `id`, comparison in constant time. Migration: each `person_api_tokens` row becomes an `ApiKey`
named "Voice and Home Assistant" with scope `turn`, its old unpeppered hash kept only until that key is next used (then
re-hashed) or for 90 days, then dropped with the table. `requireApiToken` becomes `requireApiKey(scope)`; `routes/openai.ts` and
Wyoming require `turn`. A gitleaks rule for the `maipai_` prefix joins `check.sh` and the Code app's push scan, so a key pasted
into a repository is caught.

### 4.2 `CodingSession`, `CodingEnvironment`, `CodingEvent`

`coding-session` (person scope): `id`, `person_id`, `title`, `repo` (`{kind: github | gitea | hub_folder | none,
connection_id?, full_name?, path?, base_branch, work_branch}`), `environment_id`, `mode` (`plan`, `ask`, `auto_edit`),
`state` (`queued`, `starting`, `working`, `needs_you`, `idle`, `paused`, `done`, `failed`, `archived`), `network`
(`{policy: none | hosts, hosts: []}`), `mounts` (household storage file ids, read only), `model_id`, `usage` (`{input_tokens,
output_tokens}`), `changes` (`{files, additions, deletions}`), `pull_request` (`{url, number, draft}`), `checkpoints`
(`[{id, at, label, files}]`), `created_at`, `last_activity_at`, `deleted_at`, `trash_until` (TRASH-01).

The transcript is the session's message list in the same message-part shape the chat stores (text, reasoning, tool call with
its arguments and result), so assistant-ui renders it with no adapter beyond the event bridge; stored like a conversation,
owner only, passed through the existing credential redaction before it is stored (the "credential catch" of rule 1).

`coding-environment` (person scope, or household when an admin shares it): `id`, `owner` (`person_id` or `household`),
`name`, `image` (the pinned image id), `setup_script`, `env` (plain variables, visible to the agent), `network` (default policy
and hosts), `resources` (`{cpus, memory_gb}`). No secret field in this version (CODE-NETSECRET-01).

`git-connection` (person scope): `id`, `person_id`, `kind` (`github`, `gitea`), `host`, `account`, `status` (`active`,
`expired`, `revoked`, `failing`), `expires_at`, `created_at`; the token is a write-only secret in `lib/secrets.ts`, never on
the wire.
A Default environment is created for a person on first use.

`coding-event` (person scope, the session's audit trail, owner only): `{id, session_id, at, kind, detail}` with `kind` one of
`command` (the command line, exit code, time), `file_write` (path), `host_allowed`, `host_blocked`, `approval` (what, answer),
`push`, `pull_request`, `secret_found` (path and line, never the value), `checkpoint_restored`, `stopped`. It is the person's
record of what the agent did, exportable with the session. Household logs carry only typed events with no person, text, path or
id (rule 6a): `coding.session_started`, `coding.session_ended` (reason), `coding.api_request` (status class, duration),
`coding.paused_changed`, `coding.sandbox_failed` (error code).

### 4.3 The coding model per tier (Stack record, `model-capabilities` additive)

| Tier | Default | Alternative | Context, slots | Admission (estimate) | Why |
|---|---|---|---|---|---|
| p128 (Studio, 128 GB) | **Qwen3.6-35B-A3B**, Q6_K GGUF, "Fast" | **Qwen3.8-27B** dense, Q6_K, "Careful" | 128k, 2 slots, q8_0 KV | about 38 to 40 GB `(?)` (29 GB file `(?)` times the governor's 1.3 for llama-server, plus about 1.3 GB KV per slot `(?)`) | 3B active: 87 to 105 tok/s at 8-bit on this chip (**published**, stared/benching-local-llms-on-apple-silicon), so an agent loop that reads and writes for 20 minutes on a GPU becomes a few minutes, and speed buys thinking at low effort; SWE-bench Verified 73.4 (**published**, vendor scaffold); the Studio staging plan already pins it (STUDIO-STAGE-01); leaves about 24 GB for one picture job beside it |
| p64 | **Qwen3.8-27B**, GSQ/RCO IQ3_XXS-mtp GGUF (10.1 GB) | none | 128k, 1 slot, q8_0 KV | about 17 GB `(?)` | The org's own measured model and quantization (`local-coding-model.md`); the only good coder that fits beside the resident chat model; admitted instead of a picture job, never with one |
| p32, p16 | not available | | | | The chat model holds the memory; the switch shows the reason line |

Licences: Qwen3.6-35B-A3B and Qwen3.8-27B are Apache-2.0 on their model cards (read again at pin time, rule of the image note's
licence screen); the GSQ/RCO quantization's own repository licence is read at pin time.

Considered and not the default: **Qwen3-Coder-Next** (80B, 3B active, Apache-2.0, SWE-bench Verified 70.6 **published**):
about 46 to 50 GB at 4-bit `(?)`, which takes every gigabyte a picture, video or music job would use, for a score no higher
than the 35B-A3B's; it is a bench candidate. **gpt-oss-120b** (Apache-2.0, 5.1B active, about 63 GB): too large to share
with generators; a bench reference. **Qwen3.8-27B as the p128 default**: the stronger typist per token, but dense at about 17
to 20 tok/s on this chip (Qwen3.6-27B **published** at 17 to 18 in the same benchmark; MTP on Metal is negative per the
chat-throughput note), so an M task takes half an hour; it is the "Careful" choice. **GLM-5.3-Flash, DeepSeek V4, MiniMax,
Qwen3.8-Flash-Next**: too large for 128 GB beside chat, or not Apache or MIT. **MLX**: about 10 to 30 percent faster on some
models (published, unverified), but it serves no Anthropic Messages endpoint, so Claude Code would need a translating proxy;
llama.cpp serves both wires natively (rule 2). The engine is the Stack's pinned llama-server.

**Coexistence.** Its own process, on demand, never resident: loaded on the first coding request (about 10 to 20 s from page
cache `(?)`), unloaded after `coding.keep_warm_minutes` idle. The governor admits it like a generator with a lease: an idle
coding engine (no request in flight) is unloaded to admit a picture, video or music job; a busy one makes that job wait with
the existing busy line. Chat, voice, embeddings and the judge are residents and never evicted or shrunk (the governor's rule).
Thinking runs at the model's low effort, set at the server (the org note: the highest effort spent the whole output budget
thinking); the Stack's catalog record carries sampling from the model card with its source (rule 3).

**Decided by Jesse, 2026-10-17 (owner-approved 2026-10-17, in chat): the coding model loads only when needed.** It is a second
model in its own process, loaded while someone is coding and unloaded after about 15 idle minutes (`coding.keep_warm_minutes`);
the chat model stays loaded and never shares its slot with coding. This supersedes the 2026-09-17 owner decision "one
foreground model ... no permanent 27B coding copy beside an intelligence model" for coding (see Supersedes): a second model
now loads on demand while coding is in use; it is still never permanent, and chat stays the one resident foreground model.

### 4.4 Settings keys

All household scope, `lives_in` the Coding cards above, copy through `describeSetting` (S5), `honoured_by: ["home"]` unless
noted:

| Key | Type, default | Level |
|---|---|---|
| `coding.enabled` | boolean, false | basic |
| `coding.paused` | boolean, false (the kill switch) | basic |
| `coding.web.enabled` | boolean, true | basic |
| `coding.api.enabled` | boolean, true | basic |
| `coding.api.away` | boolean, false | basic |
| `coding.adults_by_default` | boolean, true (every adult may code unless a `deny` grant names them; never reaches a teen or a child) | basic |
| `coding.model` | select `fast`, `careful`; `fast` (p128 only; `honoured_by: ["stack"]` too) | advanced |
| `coding.max_sessions` | number, tier default (p128 2, p64 1) | advanced |
| `coding.max_streams_per_person` | number, 2 | advanced |
| `coding.requests_per_minute_per_key` | number, 60 | advanced |
| `coding.daily_tokens_per_person` | number, 0 (no cap) | advanced |
| `coding.keep_warm_minutes` | number, 15 (`honoured_by: ["stack"]`) | advanced |
| `coding.network.default` | select `none`, `registries`; `none` | basic |
| `coding.network.allowed_hosts` | list of hosts, empty (presets offered) | advanced |
| `coding.network.people_may_approve` | boolean, true | advanced |
| `coding.sandbox.cpus`, `coding.sandbox.memory_gb` | number, 4 and 4 | expert |
| `coding.workspace_days` | number, 30 | advanced |
| `coding.storage_gb_per_person` | number, 20 | advanced |

Person scope: `coding.default_mode` (`plan`, `ask`, `auto_edit`; `ask`). Areas: `home` gains section `coding` (kind `keys`,
`min_role: admin`, cards `household.coding`, `household.coding_people`, `household.coding_limits`, `household.coding_network`);
`account` gains section `coding` (kind `view`, view `account.coding_keys`, `min_role: child`, `needs:
["coding.allowed_for_me"]`: the grant decides, not the role). The grant vocabulary is unchanged: `use:code` keeps the `none` cell in
every band, and a teen's or a child's access is the admin-written `allow` grant over coding's adult role floor (section 3.7). Person scope also gains the seven guardian-held
`coding.person.*` keys of section 3.7, with their band defaults. Three notification types: `coding.session_done` (passive, person),
`coding.needs_you` (time sensitive, person) and `coding.workspace_expiring` (passive, person). One data class `coding` (holds workspaces, transcripts, environments; sensitive
`personal`; backup: records and transcripts yes, workspaces no, since a pushed branch is the copy and an unpushed one shows
"Push to keep this work safe"; size: per-person cap).

### 4.5 The Code app package and the kit

The package is schema pages (app-kind note) on three additive schema nodes the kit draws, so Home writes no layout:
`agent_thread` (the assistant-ui thread with the composer, the queue, the plan bar and the approval cards, bound to one
session's event stream), `code_changes` (file tree plus diff with line comments), `terminal_log` (the terminal block list). The
package's bindings stay under `/api/plugins/code/` (the app-kind guard); the host serves them from Home's coding service through
one new host capability `home:coding` (the permission vocabulary's `home:<domain>`), with one streaming binding (`stream: true`,
the turn stream's `assistant-stream` transport) for a session's events. Settings and keys are core settings sections, not
package pages, because they hold credentials.

## 5. Privacy and offline

Nothing leaves the home by default. The model, the sandboxes and the transcripts stay on the hub.

| Connection | When | Carries | Receiver | Setting |
|---|---|---|---|---|
| Package registries and other allowed hosts | A session the person allowed them for | Package names and versions; whatever the agent's commands send (the code itself could be sent) | npm, PyPI and the other hosts on the household list | `coding.network.default`, `coding.network.allowed_hosts`, per-session approval |
| GitHub or Gitea | Clone, Push, Create pull request | The repository and the branch | The person's own git host | The person's git connection |
| Image and agent download | Install and update | The pinned file path | The pinned upstream (download, don't vendor) | The existing updates switch |

The privacy page gains these rows in the same commits that add them (PRIVACY.md), each saying in plain words that an allowed
host can receive whatever the agent sends it. The connect screen states what each outside tool still sends to its own maker:
Claude Code asks Anthropic before fetching a web page unless `skipWebFetchPreflight` is set, Cursor cannot use a home AI at all.
Those are the person's tools on the person's computer; Home cannot govern them and says so rather than pretending.

**Who sees what (rule 6a, NO-CROSS-USER-VISIBILITY-01).** A person sees their own sessions, transcripts, keys, key use and git
connections. Nobody else does, admins included; an admin sees counts, health codes and memory, and can revoke a person's API keys
and git connections from the Coding access row (kind, status, created, expiry, key hint; no names, hosts or use). A person may share one session snapshot with one household adult, and a teen or a child with one household admin.

**Offline.** With the internet down, everything works except clone, push, pull requests and allowed hosts; those say "The internet
is down. Your work is saved here; push when it is back." With the coding engine down, the Code app shows the paused or starting
line and the API answers 503 with the same words.

## 6. Kit Elements and parts

**Rule 9 (chat Elements) for the session's transcript**, which is an agent chat: the assistant-ui thread, `tool-call`,
`tool-group`, `reasoning`, `markdown-text`, `agent-plan`, `todo-list`, `approval-card`, `permission-grant`, `message-queue`,
`stopped-run`, `checkpoint-history`, `context-display`, `code-diff`, `reviewable-diff`, `file-tree`, `terminal-block`,
`thread-list-sidebar.aui` for the sessions list, `empty-state`, `error-state`, `connection-state`. **Rule 9b (shadcn kit) for
settings and keys**: `SettingsShell`, `Card`, `Switch`, `Select`, `Table`, `Dialog`, `AlertDialog`, `Input`, `Tabs`, `Badge`,
`Progress`, `Alert`, `Sheet`, `Button`. No `className` that changes shape and no wrapper (rule 9); each look comes from tokens
and props.

Named gaps, each an additive kit change in `commons` first with a row in `ELEMENTS-DECISIONS.md` (CODE-KIT-01):

1. `FileTree` gains `selectedPath` and `onSelect`, and a live mode where `visibleCount` defaults to all (it is a reveal
   animation today).
2. `CodeDiff` and `ReviewableDiff` gain `onLineComment(path, line)` and a `compareLabel` slot; `cycle` defaults off.
3. `TerminalBlock` gains a `streaming` mode that appends `lines` as they arrive and a `followTail` prop.
4. A read-only code view for the Files tab: the kit's `shiki-highlighter` exposed as a `CodeView` part with line numbers.
5. The three schema nodes of 4.5 in `commons/ui/src/schema` and `spec/ui/schema.json`.

**Reuse check.** Looked at first and reused: the assistant-ui thread and the code Elements above (all exist), the
`person_api_tokens` store (extended, not duplicated), `lib/secrets.ts` and the pepper, grants (`use:<package>`), the Stack
governor and pinned downloads, Tailscale away access and the household CA, the notifications registry, `roleHealth`, the
household trash, OpenCode (agent), llama-server's native Anthropic and OpenAI wires, Apple's container runtime, tinyproxy,
gitleaks, the GitHub and Gitea REST APIs for pull requests. Not used: LiteLLM (a translating gateway: not needed while the engine
serves every wire natively; it would re-parse tool calls, against rule 2), OpenHands and its UI (a second UI and sandbox), code-server
or a web IDE (Claude Code on the web has none; out of scope). Hand-built code is limited to the gateway's gate chain and queue
(no shipped gateway checks a household's people, controls and grants), the event bridge from OpenCode's events to message parts,
the host-side git push and pull request calls, and the sandbox service's thin driver over the runtime's CLI.

## 7. Rule check

- **Rule 0 (age and surface gates first)**: adults by default; a guest never; a teen or a child only by an admin's per-person
  `allow` grant over coding's adult role floor, and every minor floor of section 3.7 holds whatever the grant says: the output gate at the person's
  grain, no reasoning, the band's topic block, the crisis offer, the real-danger alert, no household data, no internet beyond
  the household list, the adult-site and V1 lists locked. A key cannot widen any of it (checked per request against the
  person's current controls). Nothing loosens a minor's protection.
- **Rule 2**: llama-server's own `/v1/messages`, `/v1/chat/completions`, `count_tokens` and tool parsing; the gateway never
  re-wraps a template, re-parses a tool call or estimates tokens. It reads the engine's parsed fields to run the floor, adds a
  system part for a minor and drops a minor's reasoning at the engine client (section 3.6).
- **Rule 3**: the coding model's sampling comes from its catalog record with its source; client sampling is dropped.
- **Rule 4**: the engine runs at the real window the tier can hold (128k); `/code/v1/models` reports it.
- **Rule 5**: no length instruction for an adult; a minor's prose keeps the band's own limits (section 3.7); file and command
  content is bounded only by the `max_tokens` ceiling.
- **Rule 6a**: household logs are typed events with no person, text, path or id; the admin sees counts and health; the session's
  audit trail is the person's own record, a minor's included: an admin sees a minor's grant, limits and credentials, never
  their sessions (section 3.7).
- **Rule 7**: the agent's web fetch tool is off in this version; any fetched text in a later slice is data, never instructions.
- **Rule 9 and 9b**: the transcript is Elements, settings are kit primitives; five named kit gaps land in `commons` first.
- **Rule 10**: the safety floor checks every coding request in and out: streaming for an adult, each sentence before release
  for a child, and the household teen setting (child's mode by default) for a teen.
- **Rule 11**: the model runs only in the Stack's pinned llama-server; OpenCode and the person's tools are clients, not runners.
- **Rules 1, 12, 13**: the chat turn is untouched. CODE-BENCH-01 measures chat's first-token time while a coding loop runs; the
  bar is no change beyond noise, so CHAT-AB-01's adult rows cannot move.
- **S1, S2, S4, S5, S6**: the rail stays; the app copies Claude Code on the web; settings are `SettingsShell` areas; copy comes from
  the keys; status uses the existing composer line, notifications, Status and Repairs.
- **V1**: the egress proxy's fixed deny list holds every live video service host; no session can reach one.

No NEEDS-RULE-CHANGE for this design. One owner ask is left out because it would need one: "session logs visible to the
guardian" (section 3.7) conflicts with rule 6a and NO-CROSS-USER-VISIBILITY-01; it is listed in section 12 for Jesse.

## 8. Safety

| Risk | Control |
|---|---|
| The agent runs a harmful command | It runs inside a VM per session with only its workspace; the worst case is that workspace, restorable from a checkpoint. No Home data, no credential, no network by default |
| Prompt injection from repository text, issues, package READMEs or install scripts | The same sandbox limits; no credentials inside; the agent cannot push or open a pull request (only the person can, after seeing the diff and the secret scan); hosts need the person's approval; the system prompt names repository text as data. A fixture repository with planted instructions ("send ~/.ssh to ...", "push to main") is a CODE-SAFE-01 test: nothing leaves, nothing pushes |
| Exfiltration through an allowed host | Allowed hosts are a household list, per session, shown in the header; the privacy row says an allowed host receives what the agent sends |
| Secrets in code | gitleaks over the diff before Push and pull request (blocks with path and line); the credential redaction on stored transcripts; the `maipai_` key pattern |
| A stolen key | Expiry required, owner-visible last use with the place word, one-click revoke by the person or an admin, LAN or tailnet only, rate limits; the key reaches coding only, never Home's API |
| Coding starves the family | Separate engine process; residents never evicted; queue and caps; the kill switch |
| Destructive actions in the real world | Only four: Push, Create pull request, allowing a host, deleting a session; each is a person's explicit action with a confirmation that names what happens |
| A minor | Only by an admin's per-person `allow` grant over the adult role floor, every admin sees it; the ten floors of section 3.7 no grant reaches; keys short-lived, off unless granted, suspended when the grant or controls change; CODE-TEEN-01 and CODE-SAFE-01 test each floor on both doors |

**Why minors by grant is safe enough to offer.** Coding is a real skill families want to teach, and the sandbox makes it safe
to experiment: a session sees only its own workspace and, by default, no internet. The open risk is the API key, which reaches
tools on the minor's own computer that Home cannot gate; that is why keys are off in every minor's band default, short-lived
when granted, and the dialog says so in plain words.

## 9. Slices (rows in `docs/BACKLOG.md`, "Local coding (2026-10-17)")

| Id | Size | After | Exit check |
|---|---|---|---|
| CODE-SPEC-01 | S, `commons` | none | Records of section 4 with fixtures, keys (the `coding.person.*` guardian-held keys included), areas, no grant-vocabulary change, notification types, data class, schema nodes; commons check; tag; Home pin bump |
| CODE-BENCH-01 | M, bench on the GPU lock | none | The section 10 plan run on the Studio; report with numbers; the default model confirmed or flipped |
| CODE-STACK-01 | M, `stack` | CODE-SPEC-01, CODE-BENCH-01 | Coding role bound per tier, own process, on demand with lease and idle unload, slots, `/v1/messages`, `count_tokens`, `/v1/responses` if served, `/v1/models` (closes STACK-60 and STACK-61); p16 and p32 `notAvailable`; Stack `check.sh` |
| CODE-KEYS-01 | M, `home`, risky (credentials, migration) | CODE-SPEC-01 | One key store with scopes, pepper, expiry, migration from `person_api_tokens`, `requireApiKey(scope)`; full `check.sh`, `code-review` medium |
| CODE-API-01 | M, `home`, risky (auth) | CODE-KEYS-01, CODE-STACK-01 | The gateway with the gate chain, address rules, floor, queue; Claude Code, OpenCode and Aider verified end to end against a scratch Stack; full `check.sh` |
| CODE-API-02 | S | CODE-API-01 | Codex CLI through `/code/v1/responses` verified, or recorded as not served and hidden |
| CODE-SET-01 | M, `home` | CODE-KEYS-01 | Admin Coding section, a person's keys screen, admin revoke on Family; captures at 390 and 1440 judged |
| CODE-SANDBOX-01 | M, `stack` (01a spike, 01b build) | CODE-SPEC-01 | 01a: Apple container VM per session with host-only network proven (no LAN, no Home port, no direct internet); 01b: the service, limits, proxy, snapshots, cleanup; Stack `check.sh` |
| CODE-GIT-01 | M, `home`, risky (credentials) | CODE-KEYS-01 | GitHub and Gitea connections stored encrypted with status, expiry, revoke; host-side clone and push to `maipai/...` only; full `check.sh` |
| CODE-KIT-01 | M, `commons` ui | CODE-SPEC-01 | The five gaps of section 6, ELEMENTS-DECISIONS rows; commons check; Home pin |
| CODE-AGENT-01 | M, `home` | CODE-SANDBOX-01, CODE-API-01, CODE-GIT-01 | Sessions, OpenCode bridge, modes, approvals, queue, stop, checkpoints, gitleaks before push, pull requests; tests with a fake agent |
| CODE-APP-01 | M, `catalog` then Home's bundled copy | CODE-AGENT-01, CODE-KIT-01 | The Code app pages; captures at 390 and 1440 against the seeded demo household |
| CODE-NOTIFY-01 | S | CODE-AGENT-01 | Three notification types, the `coding` concern in `roleHealth`, the coding row on the Status page, Repairs from the Stack |
| CODE-SAFE-01 | M, risky (safety) | CODE-AGENT-01 | Injection fixture, egress tests, minors and guests refused, key-never-widens, kill switch, floor on the API; `code-review` medium |
| CODE-PRIVACY-01 | S | with each slice that adds a connection | Privacy page rows and user docs |
| CODE-TEEN-01 | M, `home`, risky (child and teen gates) | CODE-SET-01, CODE-API-01, CODE-AGENT-01 | Coding for a teen or a child by grant (section 3.7): the grant dialog and guardian lines, the `coding.person.*` keys honoured, the ten floors on both doors; tests per band per door; full `check.sh`, `code-review` medium |
| CODE-SHARE-01, CODE-ATTACH-01, CODE-LINUX-01, CODE-NETSECRET-01 | S, S, M, M | later | Each named in section 3 or 8 |

Relation to existing rows: CODE-STACK-01 carries the coding half of ENGINE-HOST-05 ("coding does not silently evict chat") and
the Stack's STACK-60 and STACK-61; CODE-BENCH-01 reuses LOCALCODER-LIFT-01's brief set; STUDIO-LANE-01 may point its driver at
`/code/v1` with a key once CODE-API-01 lands, instead of the bare engine port.

## 10. Benchmark plan (CODE-BENCH-01; not run in this task)

On the Studio, under the machine's GPU lock, the live Stack running (chat resident), scratch data directory, `HF_HUB_OFFLINE=1`
after the pins are fetched once:

1. **Candidates**: Qwen3.6-35B-A3B Q6_K and Q8_0; Qwen3.8-27B Q6_K and IQ3_XXS-mtp; Qwen3-Coder-Next Q4_K_M; gpt-oss-120b MXFP4
   as a reference.
2. **Engine numbers** per candidate: load cold and from page cache; decode and prompt tok/s at 4k, 32k and 100k; peak memory
   beside the residents; KV per 1k tokens read from the engine.
3. **Starvation**: chat time to first token, p50 and p95 over 30 turns, idle versus while a coding agent loop runs on 2 slots.
   Bar: p95 within 10 percent of idle.
4. **Tool reliability**: 200 tool calls through `/v1/messages` (Claude Code) and `/v1/chat/completions` (OpenCode); valid-call
   rate and the first malformed call recorded.
5. **Work**: LOCALCODER-LIFT-01's ten S briefs and three M briefs, pass^3 and wall time, thinking off and at low effort.
6. **Decision**: Fast stays the p128 default unless Careful passes at least 10 points more briefs at pass^3; p64 takes the IQ3 27B
   only if it is admitted beside the residents with the governor's margin.

## 11. Legacy verdicts

Legacy had a coding agent and sandbox (the BACKLOG row "Verdicts for the features absent from both this file and the rebuild" lists it, and now records this verdict): **redesigned** here, nothing carried. The mirror (`legacy-backups/home-legacy.git`) is not on this machine, so CODE-AGENT-01 reads it first, when present, for hard-won sandbox and agent logic only. The interim token (`apiToken.ts`, session C step 8): **extended** into the one key store
(names, scopes, several per person, pepper, expiry choices). Session C's lessons (`local-coding-model.md`, STUDIO-LANE-01): a fresh
agent session per task, a wall-clock budget instead of a step cap, git denied except commit, thinking set at the server:
**copied** into the agent's settings. Nothing else borrowed.

## Supersedes

- `backend/src/lib/apiToken.ts`'s "One token per person at a time: issuing a new one replaces whatever existed" and its unpeppered
  sha256: replaced by the one key store of 4.1 (several named keys with scopes, HMAC under the pepper). The table
  `person_api_tokens` is migrated and dropped (CODE-KEYS-01); `requireApiToken` becomes `requireApiKey(scope)`.
- The Stack's `coding` role as `sharesModelWith: "chat"` and resident on p16, p32 and p64 (`roles.ts`, `profiles.ts`): replaced by
  its own process and binding per tier, on demand, not available below p64 (4.3, CODE-STACK-01).
- The 2026-09-17 owner decision "one foreground model" (`docs/plans/hub-on-apple-silicon-2026-09-17.md`, "One model for chat,
  intelligence, and coding", and its memory section's "no second permanent coding model"): superseded for coding by Jesse's
  decision of 2026-10-17 (owner-approved 2026-10-17, in chat): a second coding model in its own process, loaded only while
  someone is coding and unloaded after about 15 idle minutes, with the chat model staying loaded (4.3). Chat remains the one
  resident foreground model. The plan carries a `> **Superseded in part` marker pointing here. Nothing in RULES.md.
- ENGINE-HOST-05's coding provisioning ("the current 27B coder"): the per-tier choice of 4.3.
- This note's own first version (architect item CODE-DESIGN-01): "adults only", `coding.who` (Every adult, Only admins, Only
  people I choose), the `never` grant cell for teens and children, and the teen stretch goal. Replaced by "adults by default,
  anyone by grant" (`coding.adults_by_default`, the per-person `use:code` grant over an adult role floor, section 3.7).

## 12. Decisions for Jesse

Decided by Jesse in chat on 2026-10-17 (owner-approved 2026-10-17):

1. **The coding model**: a second model, loaded only while someone is coding and unloaded after about 15 idle minutes; the chat
   model stays loaded (4.3).
2. **Who**: anyone an admin permits, adults by default; a teen or a child only by an explicit per-person admin grant that keeps
   every minor protection (3.7).
3. **Away from home**: API keys work away only through the household's Tailscale and only when an admin turns it on (3.1).

Still open, one question:

4. **Session logs for a minor's guardian** (NEEDS-RULE-CHANGE, rule 6a and NO-CROSS-USER-VISIBILITY-01): keep a minor's
   coding sessions private like every other activity (as designed), or change rule 6a so an admin can read a minor's
   `coding-event` trail (commands, files written, hosts, approvals, pushes; never the transcript), with the minor told at grant
   time (3.7).

## Architect verdict

Ruled by the `architect` agent on this note's text; the record is `data-scratch/architect/CODE-DESIGN-01.verdict`.

- First pass, 2026-10-17: REJECTED on rule 6a (key names on the admin's Family row), rule S6 (a live memory bar and live counts
  in Settings), an undeclared workspace-expiry notice, git connections and network secrets without an admin revoke, and network
  secrets that a `CONNECT` proxy cannot add. Fixed: the Coding access row shows no names, live figures moved to the Status page,
  `coding.workspace_expiring` declared, a `git-connection` record with status and expiry, network secrets deferred to
  CODE-NETSECRET-01; section 11 cites the legacy verdicts row.
- Second pass: REJECTED on one leftover sentence in section 5 ("by name"). Fixed.
- Third pass, 2026-10-17: APPROVED.
- CODE-DESIGN-02 (the owner's answers of 2026-10-17: adults by default, minors by grant, Tailscale only away, the on-demand
  coding model), record `data-scratch/architect/CODE-DESIGN-02.verdict`. First pass, 2026-10-18 UTC: REJECTED on the grant
  vocabulary's `parent` cell (it asks a parent before every request), the crisis offer listed for minors only, rule 5 misstated
  for a minor's prose, "forwards bytes" against the minor floors, and adults able to raise their own caps. Fixed: `use:code`
  keeps `none` with a minor's access an admin's `allow` grant over an adult role floor, the crisis offer moved to section 3.6
  for every person, rule 5's band limits kept for a minor's prose, section 3.6's rule 2 paragraph reworded, the cap keys
  admin-held and clamped; a child gets no git hosts and no outbound links. Second pass, 2026-10-18 UTC: APPROVED.
