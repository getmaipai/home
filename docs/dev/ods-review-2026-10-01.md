# What to learn from ODS: a whole-product review (2026-10-01)

For Jesse. Design record, coordinator: Fable 5.1. Docs only, nothing here is built and no backlog item below is filed yet.

ODS (github.com/Osmantic/ODS, Apache-2.0 apart from `vendor/pixel`, which was never read) is a one-command local AI stack for a single technical operator: a shell installer, about thirty bundled Docker services, a dashboard, a model catalog and a large test and release apparatus. It solves many of the problems Home, the Stack and the Catalog are about to meet, and it has made several mistakes in public that we can skip. This record says what we take, what we change, what we refuse, and where each decision lands.

## Ground rules for this review

- We take patterns and structure. Every word and every screen of ours is our own. None of their copy, art or code is used, and their own asset register lists unresolved image rights.
- Their screens are a reference for naming and information layout only. Ours come from shadcndashboard, assistant-ui Elements and the kit, by tokens.
- Their reader is one operator at a terminal. Ours is a household. Anything adopted has to pass the dad test.
- Their cloud and hybrid modes and the PII scrubber for cloud fallback are out of scope, kept only as contrast.
- The evidence is a static read of a shallow clone: eleven reports under `data-scratch/ods-review/reports/` (git-ignored, about 4,000 lines, each claim cited by file and line) plus a direct read of the repo's root files for question 11. Nothing was run. ODS ships no screenshot of any product screen, so this record makes no claim about how anything looks.

One report claim was marked unverified and is now checked: the offline installer writes `DISABLE_TELEMETRY=true` and `DISABLE_UPDATE_CHECK=true` (`ods/installers/phases/09-offline.sh:43-44`), the env schema describes both keys (`ods/.env.schema.json:2065-2073`), a test fixture sets them, and six third-party library services set a same-named variable for their own software. No ODS code reads either key: not the dashboard API's version check, not the CLI, not the updater, not any core compose file. The offline doc's promise of no update pings is carried by a switch nothing consults. (`vendor/pixel` was not searched.)

## Verdicts

Verdict words: **adopt** (take the pattern as is), **adapt** (take the idea, change the form), **reject**, **covered** (our design already does it; "covered, unproven" means designed but never exercised).

### 1. Setup and first run

| ODS practice | Verdict | Why | Lands in |
|---|---|---|---|
| Thirteen implementation phases shown to the person as six named steps, each with a time estimate, with a written rule that adding a phase never renumbers the person's journey | adapt | Named steps and an honest wait are right; ours are wizard screens, and the time comes from bytes left and measured speed, never a typed guess | Home BACKLOG "The first-run wizard, end to end" and SETUP-LOOK-01 (acceptance line) |
| Bootstrap mode: a 1.2 GB model answers in minutes while the chosen model downloads behind, then a swap that drains requests, proves a real completion and restores the old model on failure | adapt | The single best first-run idea in the repo. We already pin a floor chat model per tier, and the Stack already drains, swaps, checks identity and rolls back. Their README calls the swap "zero downtime" while the script pauses admission; we say "a short pause" | Jesse's call 1. Then Stack BACKLOG "Supervisor and engines" (STACK-START-01), Home BACKLOG "Hardware tiers" (SETUP-START-01), UPDATES.md "Easy install" |
| Preflight as data: stable check ids, pass, warn or blocker, a message and a fix, a JSON report, a preflight-only run | adapt | Our health item is already this shape (`code`, `severity`, `title`, `text`, `cause`, one `fix`). Preflight is the same list before install, read by the script and the wizard alike | SERVICES.md "Install and uninstall"; Home BACKLOG INSTALL-PREFLIGHT-01, beside DATA-LOCATION-01f's `checkPlacement` |
| "Continue anyway?" when requirements fail, and stopping another program (Ollama) from the installer | reject | A blocker blocks and a warning informs; the hub never stops a process it did not start (ENGINE-PORT-01 is already that rule) | no change |
| Failure wording: names the step, the log, the next action and what was left untouched | adopt | Four facts in every failure message is a rule we can lint for | ENGINEERING.md errors and copy sections (UI-COPY-01) |
| Half-finished install: re-run is the recovery, downloads resume from a partial file, checksums re-verify, a forced reinstall proves the new version can install before removing the old one | adopt | Our installer is idempotent by design but has no test that kills it mid-step | Home BACKLOG INSTALL-RESUME-01 (mirror DATA-LOCATION-02b, "a killed move at every step") |
| Where a new person gets stuck: prerequisites that exist only in the script (a newer Bash, Homebrew, Docker CPU count, Node, an admin password mid-install), a disk minimum that differs between docs and code, no browser opened at the end, the setup wizard pre-marked complete so it never appears | covered, unproven | No Docker, no prerequisites, the installer opens the UI. But our own installer has never been run end to end on a real machine (BACKLOG "Service install and the one-line installer"), so this is a promise, not a result | INSTALL-SIM-01 and DOCS-FACTS-01 below |
| Three different installers (shell, a PowerShell path, a desktop GUI) that disagree: the GUI passes a flag the shell rejects and names different models per tier | reject, and guard against | A second front end over the same steps drifts unless both read one step list | INSTALL-SIM-01 acceptance |
| A narrator persona, typing effects and a five second splash | reject | Calm and plain beats theatre for a parent | no change |

A conflict found in our own docs while comparing: SERVICES.md says a daemon runs as the signed-in user under a LaunchAgent so it has the GPU and the keychain; `home/scripts/install.sh:182` registers a LaunchDaemon so the hub runs with nobody logged in. Both reasons are real. This is a measurement, not an opinion: whether the engines get Metal and the keychain under a LaunchDaemon on the Studio. It belongs in STUDIO-RUNBOOK-01 as a named step, and whichever document is wrong is corrected from the result.

### 2. Updates, backups, restore, uninstall, rollback

| ODS practice | Verdict | Why | Lands in |
|---|---|---|---|
| A pre-update snapshot that copies configuration only, never `data/`; if the snapshot fails the update goes on with a warning | reject | UPDATES.md already backs up the affected data and restores it on a failed migration. One sentence is missing: a failed pre-update backup stops the update | UPDATES.md "Install mechanics" (BACKUP-GATE-01) |
| Two update paths (one pulls images, one pulls source), migrations run by only one of them, rollback that restores config but not data, source or image versions, and no automatic rollback on the common path | reject | One path, a `current` pointer, health check or the pointer moves back | covered by UPDATES.md |
| An update dry run listing what would change | covered | The Updates projection (installed, latest, summary, needs, blocked_by) is the preview | no change |
| Backups: one list is the single source of what gets saved, and a test fails when a bundled service adds a data folder nobody decided about | adopt | Our manifest's `backup` mode is optional today, so a package can persist data with no decision recorded | PACKAGES.md definition of done and the catalog lint (PKG-BACKUP-DECL-01); Home DATA-LOCATION-06 |
| Backups: no schedule, no second location, no encryption, default backup omits the secrets file, uninstall deletes the backup folder | reject | BACKUPS.md already has schedule, off-machine target, encryption, the emergency kit and the restore drill | covered |
| Restore: a preview of what will be replaced, integrity check before anything moves, refusal of an incomplete archive, staged copy then swap, originals moved back on failure, a typed confirmation | adopt the preview and the typed confirm | BACKUPS.md stages and verifies but never says the person sees what will be replaced | BACKUPS.md "Restore" (BACKUP-GATE-01) |
| Uninstall states what it removes and what it keeps, refuses when it cannot tell what it is looking at, keeps models on request | covered | SERVICES.md: uninstall never removes the data directory and says so | Jesse's call 4 on a separate "erase this hub" |

### 3. Monitoring, health, logs, diagnose

| ODS practice | Verdict | Why | Lands in |
|---|---|---|---|
| Readiness that means "a person can use it", with the fix carried as data, and an install that ends by sending a real one-token completion | covered | Health items with one fix, the Stack's post-load identity check, STACK-87 | no change |
| A doctor with stable diagnosis ids, evidence, confidence and next steps, which names a cause only when saved evidence supports it | adapt | Our Repairs list is the household's doctor. The rule worth taking: a cause is stated only with evidence, otherwise the item says what is known | SERVICES.md "Health, one list" (one sentence, with UI-COPY-01) |
| A redacted support bundle: bounded commands, a manifest of what ran, secrets masked, and a plain warning to read it before posting | adapt | We have the zip writer in `@maipai/core` and no household-facing way to produce a report. Ours is a button for admins, shows what it contains, never includes conversations, memories or people, and never sends itself anywhere | SERVICES.md "Logs"; Home BACKLOG "Status page" (DIAG-REPORT-01) |
| No alerting at all; the usage tool lists alerts as unbuilt | we do better | NOTIFICATIONS.md, Repairs, the status page with history | no change |
| Three pages group the same service states three different ways | reject | One vocabulary from the spec, mapped to words once in the kit | APP-STATE-01 |
| Missing telemetry shown as a dash with "unavailable", stale numbers labelled as last known | adopt | Unknown is never drawn as zero; the fit plan's `unknown` figure already works this way | ENGINEERING.md copy (UI-COPY-01) |

### 4. Settings, apps and organization

| ODS practice | Verdict | Why | Lands in |
|---|---|---|---|
| An environment editor: 738 keys, labels derived mechanically from variable names, about 458 of them in one trailing "Advanced" section | reject | STYLE.md already says an env var as the only way is a product gap. Their page is what the settings registry exists to prevent | no change |
| Sixteen settings sections in one flat list; search matches section names only | reject | SETTINGS.md rule 5: one index, search over keys, labels and help | covered |
| Save and Apply as two steps, with a list of what must restart | covered | `needs_restart`, `pending`, `in_effect` | no change |
| A field owned by another flow shown read-only with the reason | covered | Rule 1: a setting lives in one place, so it is never drawn twice | no change |
| Feature cards: the API knows four states (ready, needs services, not enough memory, available); the screen shows two and puts the reason in a hover tooltip | adapt | The states are right, hiding the reason is wrong, and hover does not exist on a phone or a TV. Every app card shows its state in words with one action | commons spec then Home BACKLOG "Status page" (APP-STATE-01, after STATUS-SVC-01) |
| Extension cards: ten states with one sentence each, confirmations that say what is kept, a dependency notice before enabling, an install progress row with the step name | adopt the vocabulary idea, in our words | One declared list of package states, each with a sentence and an allowed action, is the same "one definition" rule we apply to settings | APP-STATE-01 |
| An app that is not healthy disappears from the sidebar | reject | STATUS-SVC-06 marks the menu item instead; a vanished app reads as data loss | covered |
| Starter bundles with a size and a minimum machine | adapt | The wizard's default package step shows each package's download size and says more can be added later; no separate bundle concept | "The first-run wizard, end to end" (needs PKG-FOOTPRINT-01) |
| Chat as the home page with every other page in a side panel | reject | Our navigation is settled (home-pages-2026-09-20) | no change |
| One assistant known by three names across code, flags and screens | reject, and guard against | A retired-name list in the prose lint keeps old names out of docs and copy | .github standards (STD-RETIRED-01) |

### 5. Integration packaging

What an ODS service declares: id, name, aliases, ports, a health path with timeouts, a UI path, GPU backends, a category (core, recommended, optional), dependencies, configuration variables (secret, format, a pattern with a required plain description, a generator, "must differ from"), an LLM contract (minimum context and a probe that proves the app follows a model swap), install hooks, feature cards (requirements, launch target, a free-text setup time), and a compatible version range. Library recipes add an upstream record: source repo, licence, pinned image digest, architectures, whether it was run.

| Point | Verdict | Why | Lands in |
|---|---|---|---|
| State is known by probing the declared health path, reconciled with the container state, cached | covered differently | Our packages run no server. Engines and sidecars are the Stack's and Home's, each with health items; a package declares what it `requires` | STATUS-SVC-01 |
| Enable and disable by renaming a compose file; uninstall keeps data; purge is a separate confirmed act | covered | PACKAGES.md "Uninstall, and a person's files" is stricter | PKG-UNINSTALL-01 (already filed) |
| Contributor path: copy a template, edit, run one audit command with stable finding codes, test | covered | The `new-package` skill and the catalog's `check` | no change |
| A generated catalog file with a freshness check, and a schema mirror checked byte for byte | covered | The catalog pins `spec`; no mirror exists to drift | no change |
| **Field we lack: footprint.** Nothing in our manifest says how much a package downloads or how much disk it will hold, outside models, style adapters and knowledge sets | adopt | A parent should see "about 2 GB" before tapping install, and the wizard needs it to size the default set | commons `manifest.schema.json` first, then catalog lint, then Home (PKG-FOOTPRINT-01) |
| **Field we lack: a plain sentence for a pattern.** Their schema refuses a validation pattern without words a person can read after "must be" | adopt | `settings-key` has `range` and `help` but nothing ties a format rule to its message | commons `settings-key.schema.json` (same item, second commit) |
| **Rule we lack: the backup decision is mandatory.** | adopt | See question 2 | PKG-BACKUP-DECL-01 |
| Refuse: ports, public URLs, host networking, container user ids | reject | A package never opens a port | PACKAGES.md (one line, UI-COPY-01's commit or its own) |
| Refuse: shell hooks run as the person at install, start and uninstall | reject | Tier 0 is declarative and tier 1 is sandboxed; a hook script is unreviewable host code | same |
| Refuse: free-text "setup time" (values such as "Ready" beside "~5 minutes") | reject | Time is computed from bytes and speed | same |
| Refuse: unknown keys allowed (their schema passes any extra field, and one library manifest carries one) | covered | Ours is closed (`additionalProperties: false`) | no change |
| Refuse: installing from any public repository by having the model read it and propose a recipe | reject | Unsigned, model-written install plans are the opposite of a signed index | no change |
| Refuse: a category that says "core" on a service the installer treats as optional | reject | One meaning per word | no change |

### 6. Chat

ODS has three chat surfaces (the dashboard's own agent, Open WebUI, and a phone page backed by a second agent), three assistant names and four identity mechanisms. Voice, pictures, search and documents are wired into Open WebUI by environment variables, and the default install on a qualified Linux host drops Open WebUI, so the default chat has none of them. Their own multi-user note says every signed-in person shares one agent's memory and history.

| Point | Verdict | Why | Lands in |
|---|---|---|---|
| Several chat surfaces, capabilities split between them | reject | One chat on assistant-ui, capabilities as packages inside it | covered |
| Shared memory and history across people | we do better | Per-person identity is the product | covered |
| Composer states said in words: connecting, unavailable while other apps still work, switching models with the draft kept | adopt | ENGINE-AVAIL-00 and 02 cover "chat is down"; add "your draft is kept" and the model-switch state to 02's acceptance | Home BACKLOG "Engine availability" (amend ENGINE-AVAIL-02) |
| A banner while the starter model is in use, with progress on the full one | adapt | Part of call 1 | SETUP-START-01 |
| First open: their own chat has no suggestions; Open WebUI gets four | covered | `/next/chat` has no suggestion adapter yet; already tracked in the chat program | no change |
| Dashboard to chat handoff by opening a bare URL in a new tab, with a token appended for one service | reject | Same app, same session, nothing to hand off | covered |
| A persona file of prose rules for spoken replies | reject | Voice is a layer over the full answer, never prompt prose (owner's rule) | covered |
| A promise that nothing leaves the machine written into a persona, while search, site icons and one tool call outside services | we do better | Our privacy table is generated, and the source icons already go through the hub's own route rather than a third party | PRIVACY-SWITCH-01 adds the missing proof |

### 7. Models

| Point | Verdict | Why | Lands in |
|---|---|---|---|
| One selector module used by the installer and the dashboard, offline and deterministic, so they cannot disagree | covered | The Stack's fit plan is the one answer; HOME-FIT-05 retires Home's own copy | no change |
| Every pick explained in one sentence with the memory broken into parts | covered | Home words the fit plan | no change |
| A pinned table of 65 hardware envelopes and the model each must get, with the rule that changing a row is a default change needing evidence | adopt | We have measured rows but no table that fails when a proposal changes by accident | Stack BACKLOG "Governor and sizing" (STACK-SIZE-GOLDEN-01) |
| An evidence ladder for speed: measured here, published exact, calibrated, or "benchmark required"; catalog estimates never shown as measured | covered | `source: measured, dry-run, estimated, unknown` on every figure | no change |
| A speed sparkline drawn from a hash of the model's name, beside that honest label | reject, and write the rule | A chart draws measured data or it is not drawn | UI.md patterns (UI-COPY-01) |
| A second, simpler estimator in the browser for when the API is silent | reject | HOME-FIT-05 | covered |
| 58 catalog models of which 14 can be auto-picked, each demoted model carrying a plain reason | adapt | A reason a person can read for "not recommended here" is useful; ours can come from the fit verdict and the catalog entry's `cons` | fit-verdict-ui-2026-09-30.md (HOME-FIT-02, one acceptance line) |
| Test results stored in the catalog with run ids, while the screen may show only a vetted short note | covered | Home words what the Stack reports; raw evidence stays in dev docs | no change |
| Model switch as a transaction, the screen believing only a readback | covered | The Stack's swap and identity check | no change |
| An update never silently replaces the model a person chose | covered | Models are `notify`; pins | no change |
| Tier names and models stated in five places that disagree | reject | A tier is a reference point; the proposal comes from the probe | covered |

### 8. Documentation

| Point | Verdict | Why | Lands in |
|---|---|---|---|
| 397 Markdown files, 109 in one flat folder, an index with an audience column and a "start here by job" table | adapt the index | We have the same disease at smaller scale: `home/docs/plans` holds about 58,000 lines with no index and no status. A generated index with one status line per note fixes finding things without a new system | Home BACKLOG "Cross-cutting" (DOCS-INDEX-01) |
| A status label per document (canonical, guide, historical, planned) | adopt | One `Status:` line under the title of every plan: current, superseded by X, or historical | STYLE.md tier 2 (DOCS-INDEX-01) |
| One non-technical document in the whole set; the README opens with six release-governance notices before the install command | we do better | Three tiers, the dad test, the calm README skeleton | no change |
| A test that fails the build when install docs lose exact phrases | adapt | Pinning sentences makes wording changes need a test edit. Ours generates the facts (the command, the minimum disk, the supported systems, what you need first) from the installer's own declarations and fails when a doc states a different one | STYLE.md "Docs upkeep and the drift check"; Home BACKLOG (DOCS-FACTS-01) |
| A link gate over every Markdown file | adopt, with no debt baseline | They tolerate 103 known broken links by hash. We are small enough to require zero | .github standards core (STD-LINKS-01) |
| Hand-written API tables | we do better | Generated from the route schemas | no change |
| No screenshots anywhere | we do better | Generated, and looked at | no change |
| A "current truths" section restating facts held elsewhere | reject | A second copy | no change |
| Counts written by hand in agent docs that are now wrong (24 services stated, 32 present; 9 workflows listed, 43 present) | reject, and note | Counts in `AGENTS.md` and `CLAUDE.md` are generated or left out | STYLE.md tier 2 (one line, with DOCS-INDEX-01) |

### 9. Quality and honesty

What we already do better: people install releases, never `main` (their quickstart installs the moving, unsigned development branch while a signed path waits unused); a restore drill and a clean-clone build on every release; evidence has to match the acceptance; a universal claim needs an inventory; measured numbers carry the build, the model file and the hardware.

| Point | Verdict | Why | Lands in |
|---|---|---|---|
| A support matrix with tiers, and a "truth table" of what is safe to claim, checked by a script against the manifest | adopt | Home has no support matrix and, as far as a search of `home/docs` shows, no battle-tested checklist in its dev docs, which the org's release rule expects. One page: each platform, its state (in daily use, installs and boots on a date, untested), the evidence | Home `docs/dev/support.md` and the release skill (SUPPORT-MATRIX-01) |
| The headline says three systems are "fully supported" while the release notes say none of the six required machines finished qualification, and the detailed table rates two of the three one tier lower | the mistake to avoid | The README status line and the user docs may claim only what the matrix marks verified, and the release check enforces it | SUPPORT-MATRIX-01 acceptance |
| A two-minute first-chat claim beside the installer's own estimates of eleven to twenty minutes | the mistake to avoid | No time claim without a measurement and its hardware | covered by Verification; restated in SUPPORT-MATRIX-01 |
| A version-consistency check across every place a version is written | adopt | Cheap, and catches a wrong tag | release skill (SUPPORT-MATRIX-01, second commit) |
| Pinned image digests in one lock file with a checker, hash-locked Python dependencies, a weekly advisory audit | covered | Pins with sha256, lockfiles, the monthly sweep | no change |
| A change-risk map from surface to required validation | covered | Scoped gates do this mechanically | no change |
| Experimental status said in the installer, the docs and the matrix | adopt the habit | Manifest `channel` and `quality_scale` exist; the card must show them in words | APP-STATE-01 |
| Regression tests named after the incident they came from | covered | Testing standards | no change |

### 10. Anything else

| Point | Verdict | Why | Lands in |
|---|---|---|---|
| A privacy switch that is written and never read (verified above) | the mistake to avoid | Each outbound switch gets a test that proves no request leaves when it is off | Home BACKLOG "Cross-cutting" (PRIVACY-SWITCH-01) |
| "Offline ready" marked only after every needed file is present and checked | adopt | Our manifest declares `offline`; what the offline page shows should be computed from the files actually present | noted for the PWA offline page; no item until that page is built |
| The browser's microphone works only on a secure origin, so their phone voice page degrades on plain LAN addresses | covered | The hub's own certificate authority and TLS are already designed (BACKLOG line 9597) | no change |
| A local-only, one-time link to reset the owner's password, made on the hub itself | adapt | Worth confirming the wizard's "trust this hub" and the emergency kit cover a locked-out owner; if not, this is the pattern | check during "The first-run wizard, end to end"; no new item yet |
| The installed copy carries no docs, so help needs the internet | reject | User docs ship inside the app | STYLE.md (one line, with DOCS-FACTS-01) |
| Uninstall removes the backup folder without asking | the mistake to avoid | Covered by SERVICES.md | no change |
| Wallpapers with unresolved rights in the product | the mistake to avoid | UI.md: a theme is never a wallpaper or a remote asset | covered |

### 11. How the repo itself is run (added at Jesse's request)

| Point | Verdict | Why | Lands in |
|---|---|---|---|
| Layout: the product nested one folder down, with two READMEs, two contributing guides, two security files and two FAQs that have drifted apart | reject | One front door per repo | no change |
| Size of single files: a 6,984-line shell CLI, a 4,800-line route file, a 5,800-line install script, about 80,000 lines of shell | the mistake to avoid | A shell installer grows without limit. Ours stays a thin fetch-verify-register script; the logic lives in the daemon where it is typed and tested | INSTALL-SIM-01 acceptance (line budget) |
| `.gitattributes`: line endings forced per file type so a Windows checkout cannot break a shell script, and byte-exact fixtures marked as such | adopt | Home and Stack have no `.gitattributes` and ship both `install.sh` and `install.ps1` | .github standards (STD-REPO-01) |
| `.gitignore`: secret file patterns (keys, certificates, any `.env` but the example) ignored everywhere | adopt | Ours ignores data folders but has no secret-file patterns | STD-REPO-01 |
| gitleaks: default rules explicitly kept on, because custom rules alone had replaced the defaults and missed real token shapes; a self-test builds never-issued markers and proves the scanner sees them | adopt the self-test | Our config already extends the defaults. We have no proof the scanner would catch a token | STD-REPO-01 |
| Two different gitleaks versions pinned (the hook and the CI doc) | the mistake to avoid | One pin, in the standards core | covered |
| The pre-commit framework: gitleaks, private key detection, a 500 KB file cap, shellcheck, one custom check | adapt | We do not add a second runner beside `check.sh`. We take the two checks we lack: a large-file cap (our "big files are release assets" rule is kept by memory today) and shellcheck on shipped scripts | STD-REPO-01 |
| CLAUDE.md: structure, commands, how to run one test, and a stated priority order for when principles conflict | covered | `AGENTS.md` per repo plus the org file. Their file's counts are stale, and its "no retries, no fallbacks" rule is contradicted by an installer full of retries: a rule nobody checks is a wish | no change |
| A Makefile whose `gate` runs lint, tests, smoke runs and an installer simulation that writes a checked summary | adopt the simulation | Our gate has no installer in it at all | INSTALL-SIM-01 |
| Eleven Linux distributions tested in containers on every change | adapt | One or two, locally, for the Linux install path; no hosted CI in private repos | INSTALL-SIM-01 |
| Releases: a signed-tag pipeline producing source archives, a software bill of materials, checksums and a provenance attestation, drafts only, never moving a published tag | adapt | We sign and checksum the asset. A bill of materials is cheap and useful; attestation needs a public tag workflow | Jesse's call 3 |
| Release notes that also carry qualification caveats | reject | Our notes are the changelog; caveats live in the support matrix | no change |
| AI review on every pull request, nightly AI jobs switched off for cost | not applicable | No pull requests outside the catalog | no change |
| Dependency update pull requests, grouped weekly | reject | The monthly local sweep | no change |

## Docker: a fresh view, set apart from our rules

Jesse asked for an opinion that does not start from our own standards. Here it is, judged only against the vision: a private family hub on hardware the family already owns.

**What Docker bought ODS.** Almost everything they have in breadth: about 200 installable services, each a manifest and a compose file; reproducible images pinned by digest; resource limits and reduced privileges per service; uninstall by removing a container. If the goal were "run any self-hosted app", Docker would be the answer and we would be wrong to avoid it.

**What it cost them, from their own code.** Nearly every first-run stuck point in the journey report is Docker: installing it, the group change that needs a new login, the GPU toolkit and driver floors, a Docker release that had to be downgraded for one GPU family, Docker Desktop's CPU allowance and file sharing on a Mac, WSL2 on Windows, a 10 GB image pull with no visible progress, a thirty minute image build for picture generation, files owned by container users that then break uninstall and backup. On a Mac they gave up on Docker for the model itself: inference runs as a native process because a container cannot reach Metal, picture generation is unavailable because no image exists, and the embedding service runs under emulation.

**Where that leaves us.**

1. *The engines must be native.* On Apple silicon there is no choice (no Metal, no MLX, no unified memory in a Linux container), and the hub is a Mac. This is physics, not preference.
2. *Docker's biggest gift, app breadth, works against this product.* A wrapped third-party app brings its own login, its own look and its own idea of who the user is. ODS ended up with four identity mechanisms and a note that one parent can read the other's chats. A family product needs one identity, one look and one set of child protections, which means features built as packages inside our shell. That is far more work, and it is the product.
3. *The blanket "never a container" is still too absolute in two places.*
   - **As packaging for Linux.** Home is a Bun server with SQLite; an image is a small build. The people who will try a pre-1.0 family hub first are self-hosters with a NAS or a home server, and a compose file is how they expect to receive software. SERVICES.md says a Linux image "may be offered later". I would move it earlier, with two conditions: it is built from the same release artifact and runs the same daemon (so it cannot drift the way ODS's three installers did), and it is labelled as the path for people who already run containers, never the main one. It also gives us a clean-machine install test for free.
   - **As a sandbox.** If the hub ever runs code written by a model or an unreviewed package, a container or a small virtual machine is the honest boundary. That is a later decision, but the design should not rule it out.
4. *For heavy third-party sidecars* (picture generation with its Python and GPU stack is the fragile one), containers are tempting on Linux and Windows. A pinned, locked Python environment managed by the Stack gives most of the reproducibility with one mechanism on all three systems, and works on the Mac where a container cannot. I would stay native there and revisit only if that proves unreliable in practice.

**Recommendation.** Native stays the architecture. Add a Linux image as a second, clearly labelled delivery of the same release, used first by us for install testing and published once the native installer is proven. Jesse's call 2.

## The assembled stack: Open WebUI, Qdrant, Tika, SearXNG, Infinity, Open Terminal, Ollama, in Docker

Jesse asked for the same fresh view on the stack most people assemble today: Open WebUI as the interface, Qdrant for vectors, Apache Tika for document extraction, SearXNG for web search, Infinity for reranking, Open Terminal as a sandbox, Ollama as the model runner, all under Docker. This was not part of the gathered evidence; it is judged from what the ODS reports show about the same parts and from general knowledge of the projects, and two points are marked as unchecked.

**What it is good at.** It works in a weekend. Every part is maintained by an active project, and Open WebUI alone covers chat, accounts with roles, per-person history, documents, web search, voice, pictures and tools. For one household that wants private AI now, nothing we could build this month beats it on features per hour spent.

**Why it is not the product.**

1. *It is a distribution, and ODS shows where that ends.* ODS began as almost exactly this stack (Open WebUI, Qdrant, SearXNG, a model server, an embedding server) and is now moving its default chat off Open WebUI onto its own, because it could not control the experience: settings that live in Open WebUI's database after first boot and ignore later configuration, a login the dashboard cannot hand a session to, a document feature whose vector store they never actually wired. Assembling seven upstreams makes us the maintainer of the seams, which is the least rewarding place to stand.
2. *The licence closes the door on a product.* ODS's own branding note records that Open WebUI's licence restricts removing its name beyond a small number of users, and that their install therefore shows the upstream name beside theirs. A product called MaiPai Home cannot be a renamed Open WebUI, and code written inside it does not stay solely ours.
3. *The family layer is missing, and it is the reason we exist.* Accounts and roles are there. A household is not: no child profiles with protections that cannot be turned off, no memory with per-person permissions, no people who have no account, no robot, no Apple TV client drawing the same pages. Those would have to be built outside it and kept in step with a weekly release train we do not control.
4. *On the hub it is not really "Docker with Ollama".* On a Mac the model runner must run outside Docker to reach the GPU, so the stack becomes a native Ollama plus containers, and the reranker in a container runs on the CPU. Whether Ollama's current release serves MLX well on a large Mac is unchecked here; our own measurements say MLX matters most on the Studio. Ollama also hides the engine settings our contract tests exist to pin (context size, cache type, how strictly a tool call is honoured), and its historical habit of a small default context that silently truncates is the kind of surprise a family cannot diagnose.

**What to take from it anyway.**

- **Run it as the yardstick.** The honest test of Home's chat is a parent using both for a week. Standing this stack up on the dev machine or the Studio costs an afternoon and gives a living bar for "the bare model's answer is the floor": if Open WebUI with the same model answers better, that is a finding. Jesse's call 6.
- **Adopt an Ollama that is already there.** ODS's installer detects a running Ollama or LM Studio and offers to reuse its model instead of downloading again. A family that already runs Ollama should be able to point a role at it. The Stack's URL tier is the place; STACK-ADOPT-01 below makes it a first-run offer.
- **Do not add a vector server.** A household's memories and documents are small. A vector index inside the existing SQLite store is one file to back up; Qdrant is a second store, a second backup decision and a second upstream, for scale we will not reach.
- **Reranking needs no new server.** The role vocabulary already has `rerank`, and the engine we run serves reranker models. Infinity would be a second runtime for one role.
- **Document extraction is a real gap.** Tika is the thorough answer and brings a Java runtime. For a family's PDFs and office files a lighter extractor run as a pinned sidecar is likely enough; this needs its own short evaluation before a documents package is built, not a decision here.
- **A sandbox is the right idea for code a model writes.** A container is the honest boundary on Linux; on a Mac it needs a small virtual machine. Not needed until Home runs such code, and the design should leave room for it (as said under Docker above).

**A harder point, since a fresh view was asked for.** The family layer is ours alone to build, and it is where the product is. The engine layer and generic chat features are commodities that other projects give away and maintain. We have built a good deal of commodity already: an engine supervisor, a sizer, search plumbing, chat wiring. The Stack earns its place only for what a runner like Ollama does not do: one address per role, admission across chat, voice and pictures on one machine, MLX, and an answer to "will it fit" before a download. Anything beyond that list is effort taken from the part nobody else will build. I would hold the Stack to that list and treat every new engine-management feature as needing a reason a runner cannot supply.

## Upstream churn: which approach survives it

Jesse asked whether our approach or theirs is set up to fail, given how fast the projects underneath both of us move. The honest answer has two halves.

**What churn did to ODS, from their own records.** They pin everything by digest in one lock file, which is right, and it still hurt them in four ways. Their pinned llama.cpp build cannot load a newer model family that needs a build about 1,600 tags later, so the catalog carries that model marked incompatible with a note telling the person to choose another. They once shipped a pin to a build tag that never existed. A speed feature they document was added in one upstream build and removed in the next. A Docker release broke one GPU family and the installer now downgrades Docker. On top of that, their speech service is a release candidate patched at start-up by rewriting upstream source, their chat app is pinned several versions behind and keeps settings in its own database where an update cannot reach them, and one agent runtime was deprecated and replaced within months. Each of about thirty bundled services is its own upstream. Their answer is human qualification on a private fleet of six machines, and the release notes admit that none of the six finished. Pins without a cheap way to re-prove them go stale, and people cannot re-prove thirty upstreams.

**Where our approach is stronger.** We depend on few things, and deeply: two engines (llama.cpp and MLX), a speech library, a picture engine, the runtime, and two vendored UI sources. No container layer, no operating system packages, no thirty web apps. Features are our own packages over our own spec, so an upstream app changing its settings format cannot break a family's evening. Engines and models are separate from the app release in the Stack's design (a signed engine index, apply, identity check, automatic rollback), which is exactly the joint ODS lacks. And we already write contract tests against engine behaviour, because we have been bitten (a tool-call option that one build honours and another treats as a hint).

**Where our approach can fail the same way, or worse.**

1. *Qualification by hand.* Our rule that a figure is "unknown until measured" and that each model needs a measured budget record is correct and expensive. ODS has 58 catalog models and could verify 14. We have one household's hardware. If every new engine build and model family waits for a person to run a bench, we will fall behind in weeks, the way their pin did.
2. *The monthly sweep is the wrong clock for engines.* Upstream ships builds many times a week and a new model family can need a new build within days. A month is fine for libraries and far too slow here.
3. *Vendored UI as a hand merge.* The shell and the chat Elements are snapshots merged by hand each month. One of those upstreams has already broken our tests across three patch versions. A hand merge that hurts gets skipped, and a skipped merge becomes a fork.
4. *Narrow hardware.* We can prove a Mac and one Linux laptop. Anything else is a claim. ODS's lesson is to say so, which SUPPORT-MATRIX-01 does.
5. *Our own weight.* A 35,000-line design log and a 10,000-line backlog are a cost every session pays. Process that makes a pin bump take a day will lose to upstreams that move hourly.

**What decides it.** Three things, all buildable:

- **A canary that re-proves engine pins without a person.** On a schedule, on our own machines, take the newest upstream build, run the engine contract suite, the sizing table and a short replay set, and write a proposed pin bump with the evidence, or a health note saying what broke. A person approves; nobody runs anything by hand. This is ENGINE-CANARY-01 below and it is the most important item in this record.
- **A deliberately tiny verified set.** One chat model per reference point, verified by the canary. Everything else installs as "not measured here, your choice", which the fit plan already knows how to say. Breadth comes from honesty about the unknown, never from a long list we cannot keep true.
- **A scripted update for each vendored source,** so the monthly merge is one command and a diff to read (VENDOR-UPDATE-01).

One contradiction in our own standard surfaced here: the table in UPDATES.md says an engine binary is pinned in the app release and "never updates alone", while the paragraph below it says engines update through the Stack from the Catalog's signed engine index on Home's schedule. The paragraph is the newer design and the right one for this problem; the table row should be corrected to match (folded into UI-COPY-01's commit).

Verdict: our structure is the one more likely to survive, because it has fewer moving parts and a real joint between app and engine. It will fail in the same way theirs did if re-proving a pin stays manual. Theirs fails by surface area; ours would fail by throughput.

## Open decisions that are Jesse's

1. **A starter model on first run.** The wizard downloads the floor chat model first so the family can talk within minutes, shows a plain banner while the proposed model downloads, then swaps. Recommended: yes. The cost is a weak first impression from a small model, which the banner has to own in words.
2. **A Linux container image of Home as a second delivery.** Recommended: build it now for our own install testing, publish it after the native installer is proven on all three systems.
3. **A software bill of materials on Home releases, and provenance attestation later.** Recommended: the bill of materials now, produced locally by the release skill (one new pinned tool); attestation when a public tag workflow exists.
4. **"Erase this hub".** Uninstall keeps the data folder by design, so a family that wants everything gone must delete a folder by hand. Recommended: a separate, typed-confirm action in Settings for the owner, not an uninstall flag.
5. **Which of the items below to file.** None is filed. Say "file them" or name the ones you want.
6. **Run the assembled Open WebUI stack beside Home as a yardstick.** Recommended: yes, for a week, on the same model, with a short written comparison. It is a measuring stick, never the product.

Resolved by reading, not asked: the environment editor, the pre-commit framework, shell hooks in manifests, several chat surfaces, and release notes carrying caveats are all rejected on existing rules. The LaunchAgent versus LaunchDaemon conflict is a measurement for the Studio runbook.

## Proposed BACKLOG items (not filed)

Each is in the org template. Sizes: S a session or less, M days. Lane and model floor are suggestions.

**Home, area "Hardware tiers" and the wizard**

- **SETUP-START-01: chat within minutes on a starter model** (M, Sonnet; after call 1 and STACK-START-01). Objective: the wizard downloads the floor profile's chat model first, opens chat, shows a banner with the full model's progress in plain words, and the swap is announced as a short pause. Files: the wizard routes and screens (`frontend/src/next/`), the banner from the template's alert as shipped. Mirror: ENGINE-AVAIL-01's derived state. Acceptance: on an empty data directory with a throttled download, a message is answered before the full model finishes; the banner names the starter and the percent; after the swap the banner is gone and a draft typed during the swap is still in the composer; a failed full download leaves chat working and raises one Repairs item. Out of scope: choosing models (SETUP-SIZE-01). Exit: `bash scripts/check.sh`.
- **INSTALL-PREFLIGHT-01: one preflight list for the installer and the wizard** (M, Sonnet; after DATA-LOCATION-01f). Objective: disk, memory, system version, a running instance (the lock file), a busy port and reach to the release host are returned as health-item-shaped rows with a severity and one fix, from one function the install scripts and the wizard both call. Files: `backend/src/lib/` beside `checkPlacement`, `scripts/install.sh`, `scripts/install.ps1`. Mirror: `commons/spec/schemas/health-item.schema.json`. Acceptance: each check has a fixture for pass, warning and blocker; a blocker stops the install with its fix; no check stops another program; `install.sh --check` prints the list and changes nothing. Out of scope: GPU driver installation. Exit: `bash scripts/check.sh`.
- **INSTALL-RESUME-01: an install killed at any step finishes on the next run** (M, Sonnet). Objective: a test kills the installer after each step and proves a re-run completes, keeps the data directory, resumes a partial download and re-verifies its checksum. Files: `scripts/install.sh`, a test under `backend/tests/` using a temp prefix. Mirror: DATA-LOCATION-02b. Acceptance: one case per step, all green; the re-run's output says what it kept. Out of scope: Windows. Exit: `bash scripts/check.sh`.
- **INSTALL-SIM-01: the installer runs in the gate, in a throwaway home** (M, Sonnet). Objective: `scripts/install.sh --prefix <temp> --no-service` installs a release artifact into a temp directory, boots it headless, answers a health check and uninstalls, on macOS directly and on Linux in a container; both the script path and any app-bundle path read one step list. Files: `scripts/install.sh`, `scripts/check.sh` (full scope only), a new `scripts/install-sim.sh`. Mirror: the release skill's clean-clone build. Acceptance: the simulation passes from a clean clone; it changes nothing outside its temp directory (checked by a before and after listing); `install.sh` stays under 600 lines. Out of scope: registering a real service on the dev machine (held with the real install plan). Exit: `bash scripts/check.sh`.

**Home, area "Status page"**

- **DIAG-REPORT-01: a diagnostics report an admin can save** (M, Sonnet). Objective: a button on the status page for owners and admins builds a zip with the health list, versions, the hardware probe and the last log lines, shows its contents first, and saves it locally; it never includes conversations, memories, people or secrets and is never sent anywhere. Files: `backend/src/routes/` (a new OpenAPI route), `@maipai/core`'s zip writer, the status page. Mirror: the Stack's diagnostics bundle. Acceptance: a redaction test seeds a secret, a person's name and a chat line and proves none is in the zip; a child or member cannot call the route; the page lists every file before saving. Out of scope: uploading, and the bug template's wording (a follow-up in `.github`). Exit: `bash scripts/check.sh`.
- **APP-STATE-01: one list of package states, shown in words** (S in commons, then M in Home; after STATUS-SVC-01). Objective: the spec declares the states a package can be in (ready, needs setup, starting, needs another package, will not run on this computer, update ready, has a problem, beta), and every app card and menu item shows the state with one sentence and one action, never in a tooltip alone. Files: `commons/spec/` (schema, fixtures, tag), Home's apps page and sidebar badge from shipped components. Mirror: `status-component.schema.json`. Acceptance: one fixture per state; a capture at 1440 and 390 shows the reason as visible text; the three pages that list packages use the same words. Out of scope: outside-service health (STATUS-SVC-03). Exit: commons then Home `bash scripts/check.sh`.

**Home, area "Cross-cutting"**

- **BACKUP-GATE-01: no backup, no update; and a preview before restore** (S, Codex). Objective: an update stops when its pre-update backup fails, and a restore shows what it will replace and asks for a typed confirmation. Files: `.github/docs/UPDATES.md`, `.github/docs/BACKUPS.md`, `backend/src/lib/backup.ts`, the updates apply path. Mirror: the existing restore route. Acceptance: a test forces the backup to fail and proves the update did not start; the restore route has a preview response and refuses without the confirmation. Out of scope: per-person restore. Exit: `bash scripts/check.sh`.
- **PRIVACY-SWITCH-01: every outbound switch is proven** (S, Sonnet). Objective: for each setting that turns an outbound call off (update checks first), a test runs the relevant code with the switch off against a stub that fails on any request. Files: `backend/tests/`, the update checker. Mirror: the privacy table's row list as the inventory. Acceptance: the commit lists every switch and its test; turning a switch's reader off makes its test fail. Out of scope: new switches. Exit: `bash scripts/check.sh`.
- **DOCS-FACTS-01: install facts come from one place** (M, Sonnet). Objective: the install command, minimum disk and memory, supported systems and "what you need" are declared once beside the installer and written into the README and the getting-started page by a script; the docs gate fails when a page states a different value. Files: `scripts/`, `README.md`, `docs/user/getting-started.md`, `scripts/check.sh --docs`. Mirror: the generated settings reference. Acceptance: changing the declared minimum changes both pages on regeneration; a hand edit fails the gate. Out of scope: screenshots. Exit: `bash scripts/check.sh --docs`.
- **DOCS-INDEX-01: an index of the design notes, each with a status** (S, Codex). Objective: every file in `docs/plans` and `docs/dev` carries a `Status:` line (current, superseded by a named file, historical) and a generated `docs/plans/README.md` lists them by area with date and status. Files: `docs/plans/*.md`, a script under `scripts/`, STYLE.md tier 2. Mirror: the Stack's generated components inventory. Acceptance: the index regenerates with no diff; a note without a status fails the docs gate. Out of scope: rewriting any note. Exit: `bash scripts/check.sh --docs`.
- **SUPPORT-MATRIX-01: what we can honestly say runs** (S doc, then S in the release skill; Sonnet). Objective: `docs/dev/support.md` lists each platform with its state, evidence and date, plus the battle-tested checklist; the release skill fails when the README status line or a user page claims a platform the matrix does not mark verified, or when version strings disagree. Files: `docs/dev/support.md`, `.github/plugin/skills/release/`. Mirror: hardware-tiers-2026-09-23.md for the rows. Acceptance: a fixture README claiming an unverified platform fails the check. Out of scope: running new hardware tests. Exit: `bash scripts/check.sh --docs` and the skill's own test.

**Commons and Catalog**

- **PKG-FOOTPRINT-01: a package says how big it is** (S, commons spec first, then catalog lint; Codex). Objective: the manifest gains `footprint` (download bytes, installed bytes), required for every kind that ships or fetches files, and `settings-key` requires a plain `pattern_help` whenever a pattern is declared. Files: `commons/spec/schemas/manifest.schema.json`, `settings-key.schema.json`, fixtures, the catalog's lint. Mirror: `knowledge_source.flavours[].approx_bytes`. Acceptance: fixtures round-trip in both interpreters; the lint fails a package with files and no footprint. Out of scope: showing it in Home (the wizard item). Exit: commons `scripts/check.sh`, then catalog `scripts/check.sh`.
- **PKG-BACKUP-DECL-01: a package with data must choose a backup mode** (S, Codex). Objective: the catalog lint fails a manifest that declares persistent state without `backup`. Files: the catalog's lint, PACKAGES.md definition of done. Mirror: the outputs shape check in PACKAGES.md. Acceptance: one failing and one passing fixture. Out of scope: Home's file set (DATA-LOCATION-06). Exit: catalog `scripts/check.sh`.

**Stack, area "Governor and sizing" and "Supervisor and engines"**

- **STACK-START-01: start on the floor model, swap when the chosen one lands** (M, Sonnet; after call 1). Objective: given a chosen chat model that is not yet downloaded, the Stack serves the floor profile's model, downloads the chosen one, and swaps through the existing drain and identity check, reporting each phase on the event feed. Files: `stack/backend/src/` supervisor and updates. Mirror: the update apply path's drain and rollback. Acceptance: with a throttled download a request is answered by the floor model; after the swap the chosen model answers; a failed download or failed identity check leaves the floor model serving with one health item. Out of scope: Home's banner. Exit: `scripts/check.sh` in `stack`.
- **STACK-SIZE-GOLDEN-01: a pinned table of machines and proposals** (M, Codex at raised reasoning). Objective: a fixture of hardware envelopes (the floor, the three tiers, and the common laptops between them) with the proposal each must receive; the test fails on any change, and the fixture's header says a change needs a measurement. Files: `stack/backend/tests/`, a fixture file. Mirror: the fit plan's parity test. Acceptance: every row's proposal fits by the Stack's own rule; changing a constant without updating the table fails. Out of scope: new measurements (SIZER-BENCH-01). Exit: `scripts/check.sh` in `stack`.

- **ENGINE-CANARY-01: engine pins re-prove themselves** (M, Sonnet for the design note, Codex for the runs; area "Health, readiness and updates"). Objective: a scheduled local job takes the newest upstream build of each engine, installs it into a scratch data directory, runs the engine contract tests, STACK-SIZE-GOLDEN-01 and a short replay set, and writes a report with a proposed pin bump or the failing check; nothing changes a pin without a person's approval. Files: `stack/scripts/`, the Catalog's engine index tooling, a report under `data-scratch/reports/`. Mirror: STUDIO-EVAL-01's chain. Acceptance: a run against a known-good newer build proposes the bump with its evidence; a run against a build with a seeded contract failure refuses and names the test; the job touches nothing outside its scratch directory and never runs beside a time-measuring bench. Out of scope: applying the bump, and models (a second item once this one is in use). Exit: `scripts/check.sh` in `stack`.

- **STACK-ADOPT-01: offer a model runner that is already running** (S, Sonnet; area "Roles and the router"). Objective: at first run and under Settings, the Stack detects a local Ollama or LM Studio, lists a model there that matches a role's choice, and offers to use it through the URL tier instead of downloading a second copy; nothing is stopped or changed on the other program. Files: `stack/backend/src/` hardware and roles routes, the fit plan for the adopted model. Mirror: the existing URL tier. Acceptance: with a stub runner on the default port the offer appears with the model's name; declining downloads as usual; accepting serves the role from the runner and a health item appears when the runner stops answering. Out of scope: managing the other runner's models. Exit: `scripts/check.sh` in `stack`.

**Commons, area for the kit**

- **VENDOR-UPDATE-01: updating a vendored UI source is one command** (S, Codex). Objective: one script per vendored source fetches the named upstream commit, reapplies the recorded strip list, and leaves a diff to read, so the monthly merge is never done by hand. Files: `commons/ui/scripts/`, `commons/ui/docs/dashboard-upstream.md`. Mirror: the strip list already recorded in the upstream note. Acceptance: running the script at the currently pinned commit produces no diff; running it at a newer commit produces a diff and updates the pin note. Out of scope: resolving what the new version breaks. Exit: commons `scripts/check.sh`.

**.github standards**

- **UI-COPY-01: five wording rules, written down** (S, docs only, Codex). Also corrects the engine row of the UPDATES.md table to match the Stack paragraph below it. Objective: ENGINEERING.md and UI.md gain: a failure message names the step, the cause when known, the next action and what was left untouched; unknown is never shown as zero; a chart draws measured data only; a state is said in visible words, never by hover alone; a manifest never declares a port or a shell hook. Files: `.github/docs/ENGINEERING.md`, `UI.md`, `PACKAGES.md`, `SERVICES.md`. Mirror: UI.md's "in one rule" paragraphs. Acceptance: the five rules exist once each with a good and a bad example in our own words. Out of scope: lint for them. Exit: `standards/bin/check-core.sh`.
- **STD-REPO-01: four repo checks in the standards core** (S, Codex). Objective: `check-core.sh` gains a large-file cap (500 KB outside an allowlist), a `.gitattributes` presence and content check (LF for shell, CRLF for PowerShell), secret-file patterns required in `.gitignore`, a gitleaks self-test with never-issued markers, and shellcheck on shipped scripts. Files: `.github/standards/bin/`, each repo's `.gitattributes` and `.gitignore`. Mirror: `prose-lint.test.sh`. Acceptance: each check has a failing fixture; every repo passes after its files are added. Out of scope: a pre-commit framework. Exit: `standards/bin/check-core.sh` in each repo.
- **STD-LINKS-01: no broken links in any Markdown file** (S, Codex). Objective: a relative-link and anchor check over tracked Markdown, with no baseline of tolerated failures. Files: `.github/standards/bin/`. Mirror: `prose-lint.sh`. Acceptance: a fixture with a broken link and a broken anchor fails; every repo passes. Out of scope: external URLs. Exit: `standards/bin/check-core.sh`.
- **STD-RETIRED-01: retired names stay retired** (S, Codex). Objective: the prose lint fails on a list of retired product and feature names outside changelogs and dated records. Files: `.github/standards/bin/prose-lint.awk`, a word list. Mirror: the banned-vocabulary list. Acceptance: a fixture using a retired name fails; changelogs and files with a `Status: historical` line are exempt. Out of scope: code identifiers. Exit: `standards/bin/check-core.sh`.

Amendments to items already filed, no new id: ENGINE-AVAIL-02 gains "the draft is kept and the composer says so" and the model-switch state; HOME-FIT-02 gains "a model that is not recommended here says why in one sentence"; STUDIO-RUNBOOK-01 gains the LaunchAgent versus LaunchDaemon measurement; "The first-run wizard, end to end" gains measured time per step and package sizes.

## What we already do better, in one list

Releases instead of a moving branch. One chat, one identity per person, child protections that cannot be switched off. A settings registry instead of an environment editor. Backups that are scheduled, encrypted, off the machine and restored on every release. A health list with one fix per item, notifications and a status history. Fit verdicts that say "unknown" instead of guessing. Generated API docs and screenshots. A privacy table generated from declarations. No prerequisite to install.

## Their mistakes, so we do not repeat them

1. A claim in the headline that the release notes contradict.
2. A privacy switch nobody reads.
3. Three installers and five tier tables that disagree.
4. Prerequisites that live only in the script.
5. A safety snapshot that skips the data and a failure that only warns.
6. The same status grouped three ways on three pages, and a reason hidden in a tooltip.
7. Decorative data beside an honest label.
8. Counts in docs kept by hand.
9. One product, three names.
10. A shell installer that grew to tens of thousands of lines.
