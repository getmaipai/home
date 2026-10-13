# The install wizard and its settings page (2026-10-13)

For Jesse. This is a draft design note, revision 4. It applies:

- your answers from 2026-10-13: recovery, Tailscale, children's tours, and your ruling on owner and admin (both roles stay as they are in the code; the person setting Home up creates the owner account)
- the architect's second verdict (`INSTALL-WIZARD-01`, REJECTED on rules 11, 6 and 6a), with its three fixes and three advisories

The note covers what a new household sees between the installer's last line ("Open that address in a browser to finish setup") and their first real answer from Home. It also says where each of those choices can be changed later in Home settings. The changes from today:

- Three short phases replace the ten numbered steps in `frontend/src/apps/setup/SetupWizard.tsx`.
- Downloads start in the background the moment the computer that runs the AI passes its checks.
- The person's time goes to the owner account and face set-up while the files download.
- Everything not needed for the first answer moves to a "Finish setting up" checklist.

The flow reuses parts Home already has:

- the kit's `Wizard` primitive (`commons/ui/src/primitives/Wizard.tsx`)
- `POST /api/setup/hardware` and `GET /api/setup/ca` (`backend/src/routes/setup.ts`)
- account creation through `POST /api/auth/setup` (`backend/src/routes/auth.ts`)
- the Stack's profile tiers (`stack/backend/src/profiles.ts`)
- the Stack's pinned and checksummed downloads (`stack/backend/src/lib/download.ts`)
- the face enrolment body (`frontend/src/apps/people/FaceEnrollmentBody.tsx`)
- the backup key file (`backend/src/lib/emergencyKit.ts`)

It adds three kit parts from the shadcn registry: a carousel, an alert, and the decision rows that come first. It also adds one spec schema (the setup state), one data file (the hero slides), and a `level` field on the Stack's tiers.

## Words used in this note

- **The hub:** the computer running MaiPai Home, the web app the family opens.
- **The engine computer:** the computer running MaiPai Stack, where the AI models load. It is usually the hub itself. It can also be a different, bigger machine on the home network, for example a desktop with two 8 GB graphics cards (`engines.stack.where`, `engines.stack.remote.host`, already in `commons/spec/settings/keys.json`).
- **Owner:** the person setting Home up, and what every screen calls them. The owner runs the core of Home and cannot be removed.
- **Admin:** a trusted helper the owner adds later, with less power than the owner (see "Owner and admin").

Two rules keep these apart:

1. **Setup runs only on the hub itself, from localhost.**
2. **Sizing is judged on the engine computer,** which may be somewhere else.

## Owner and admin

**Your ruling (2026-10-13): keep both roles exactly as the code has them.** The owner controls the core: who has which role, storage, backups, and other admins' settings, and the owner cannot be removed. An admin is a trusted helper with less. There is no data, spec or gate change. The account created in setup is the owner account (`POST /api/auth/setup` already gives the first person `owner`).

**What the code does today** (read from the source on 2026-10-13, not tried on a running hub):

- **Spec:** `person.schema.json` lists `owner` and `admin` as separate roles. `ROLE_LABELS` (`frontend/src/apps/people/roles.ts`) shows "Owner" and "Admin".
- **Sign-in:** both need a PIN, password or passkey (`ROLE_REQUIRES_CREDENTIAL`, `backend/src/lib/personAuthMethods.ts:57`).
- **Same for both:** neither can read anyone's private chats, memories or lists the other cannot (`canSeeAll` in `backend/src/lib/lists.ts:75`, `entities.ts:108`, `relationships.ts:168`). Both run engines, devices, people, Repairs, the scheduler, the status board, grants and partial restore.

| Only the owner can | Where in the code |
|---|---|
| Add an owner or admin | `CREATABLE_BY`, `backend/src/routes/people.ts:75` |
| Edit or delete an owner or admin profile | `MANAGEABLE_BY`, `backend/src/lib/personLifecycle.ts:68` |
| Change anyone's role | `backend/src/lib/personLifecycle.ts:163` |
| Change another admin's session lock or ease-of-use settings (nobody changes an owner's) | `assertOwnerAdminLadder`, `backend/src/lib/settings.ts:484`; `backend/src/lib/layeredScalar.ts:97` |
| Stage, view or cancel a factory reset | `backend/src/routes/storage.ts:138`, `:151`, `:170` |
| Stage or cancel a full restore (or someone granted `backups.restore`) | `backend/src/routes/backups.ts:81`, `:94`; `frontend/src/shell/pages/BackupsPage.tsx:68`, `frontend/src/apps/settings/BackupsSection.tsx:44` |
| See the backup key | `backend/src/routes/backups.ts:300` |
| Import from a legacy hub | `backend/src/routes/memory.ts:411` |
| Never be the last owner removed or demoted | `backend/src/lib/personLifecycle.ts:88`, `:166`, `:511`; `backend/src/routes/people.ts:369` |

**A gap that undercuts the ruling.** `POST /api/grants` accepts any owner or admin (`backend/src/routes/grants.ts:42`), and `createGrant` (`backend/src/lib/grants.ts:74`) checks only that the action is known. `backups.restore` is a known action (`commons/spec/vocab/grant-actions.json`). So, reading the code, an admin can grant themselves a full restore, which the ruling keeps for the owner. Nobody has tried this on a hub yet. GRANT-AUTHORITY-01 fixes it: a grant never gives more than the granter holds.

**What the setup person is told** (on screen 4, below): one short card in plain words, so they know what they are becoming and what an admin will be later.

**Where roles are changed later:** People, on each person's profile (the existing role menu, owner only). Handing the owner role to someone else is the existing path: the owner makes another person owner, then may step down; the last-owner guard stops a household from ending up with none.

## The promise, in one paragraph

The person clicks twice before the install starts and gives well under two minutes of attention to the default path. They see three phases, never a count of ten steps. The person's "Set up my Home" click is their choice to install, and from that moment downloads may start. They start in the background once the engine computer is reachable and passes its checks. The person then spends that waiting time on things only they can do: their owner account and their face. Home answers them on a small starter model as soon as that model has arrived, without waiting for the full model. Anything optional says "Do this later" and goes to a checklist in Home settings.

## Perceived length

You asked that a new household never see "20 steps" and quit on step 2. This section sets the budget, and every other section follows it.

### What the research says

| Finding | Source (read 2026-10-13 unless marked) | What we do with it |
|---|---|---|
| People do not read tutorials shown before use. A deck of tips before use made tasks feel harder (70 users; ease 4.92 vs 5.49, p=0.047). | NN/g, "Mobile Tutorials", 2020-03-08, https://www.nngroup.com/articles/mobile-tutorials/ | No teaching screens before the install. Hero slides only fill real waiting time and are never required. |
| Show a little and defer the rest (progressive disclosure). | NN/g, "Progressive Disclosure", https://www.nngroup.com/articles/progressive-disclosure/ (not fetched: UNVERIFIED) | The default plan is one button. Custom is folded behind "Choose for myself". |
| Waiting of unknown length is worse than waiting itself. Show percent done for waits over about 10 seconds. | Jakob Nielsen, "Progress Indicators", https://www.uxtigers.com/post/progress-indicators (date not shown: UNVERIFIED) | Show minutes left and percent, never a spinner alone. |
| A bar that moves steadily feels shorter than one that stalls. | Amer and Johnson, Int. J. of Technology and Human Interaction 12(4), 2016, https://ideas.repec.org/a/igg/jthi00/v12y2016i4p1-14.html | One overall bar across all files, smoothed. Never one bar per file that resets. |
| Bars that speed up near the end feel faster. | Harrison, Yeo and Hudson, "Faster Progress Bars", 2010, https://www.figlab.com/research/2010/faster-progress-bars | Not used. We show honest numbers. Listed so the choice is on record. |
| A head start raises completion (endowed progress). | Nunes and Drèze, J. of Consumer Research 32(4), 2006, https://ideas.repec.org/a/oup/jconrs/v32y2006i4p504-512.html | The phase strip starts with real work already shown as done: the installer's own checks. |
| Effort rises as the goal gets closer (goal gradient). | Kivetz, Urminsky and Zheng, J. of Marketing Research 43(1), 2006, doi 10.1509/jmkr.43.1.39 | Three phases, so the person is a third of the way through after one screen. |
| Unfinished tasks stay on the mind (Zeigarnik effect). | General knowledge, no source fetched: UNVERIFIED | The checklist shows a count ("3 things left"), without nagging. |
| Home Assistant asks for the admin account, then location, then analytics opt-in (off by default). It offers restore beside account creation. | Home Assistant, "Onboarding", https://www.home-assistant.io/getting-started/onboarding/ | Restore is on the second screen. Nothing is shared, so there is no analytics question. Location is inferred, not asked. |
| Plex asks you to sign in, add libraries, and has "Skip" at the top right. Library scanning continues after the wizard ends. | Plex, "Basic Setup Wizard", https://support.plex.tv/articles/200288896-basic-setup-wizard/ | Long work continues after the wizard. The wizard never waits for it. |
| Synology DSM installs from the browser with progress, then creates the admin. | https://kb.synology.com/en-global/DSM/tutorial/How_to_install_DSM_on_Synology_NAS (did not render: UNVERIFIED) | The same order: the install starts first, and the account is made while it runs. |
| Make onboarding fast and skippable, and ask for permissions when they are needed. | Apple HIG, "Onboarding", https://developer.apple.com/design/human-interface-guidelines/onboarding (did not render: UNVERIFIED) | Camera and microphone are asked for only on the face step. |

### Background downloads while the person sets up: normal practice

Your decision 4 is to download in the background once the engine computer is reachable and checked, and to use that time for the account and face set-up. This is how large installs usually work when there is something for the person to do:

- **PlayStation 4 "PlayGo":** a game downloads "just a portion of the overall data", the player starts, and "the rest downloads in the background" (Mark Cerny, reported by GamesBeat, https://gamesbeat.com/how-playstation-4s-play-as-you-download-feature-works/, and PSU, https://www.psu.com/news/how-ps4s-playgo-lets-you-play-games-while-they-download-or-install/; 2013 coverage, read 2026-10-13).
- **Xbox "Ready to start" and FastStart:** a game can be launched once its essential files are in, while the rest installs (Windows Central, https://www.windowscentral.com/hands-incredible-xbox-fast-start, read 2026-10-13). One reviewer found some game modes locked until the install finished. That is the same trade-off as our starter model.
- **iPhone and iPad restore from iCloud:** the device finishes setup first, then apps and media download in the background with progress under each icon, and the person can tap one to move it up the queue (Apple support's restore guide, as summarised by https://www.simplified.guide/_export/xhtml/iphone-ipad/backup-icloud-restore; Apple's own page was not fetched: UNVERIFIED).
- **Plex:** library scanning continues after the wizard (cited above).
- **The counter-example:** Home Assistant OS shows "Preparing Home Assistant" on first boot and makes the person wait before onboarding begins (general knowledge, not fetched: UNVERIFIED). That is the pattern this design avoids.

**When the first reply has to wait.** The starter chat model is 1.83 GB.

| Line speed | Starter arrives in about | Person's account and face take about | Result |
|---|---|---|---|
| 300 Mbit/s or faster | 50 seconds | 75 seconds | The starter usually arrives first, and Hello follows at once. |
| 50 Mbit/s | 5 minutes | 75 seconds | The person waits about 3.75 minutes at Hello. |

During that wait, the Hello screen shows the hero carousel and one honest line: "Home will say hello in about 4 minutes. You can close this page; it keeps going." "Continue" stays available. A person who leaves gets the greeting the next time they open Home.

### The budget

- **At most three screens before the install starts, one click each.** The second screen needs no click when everything is green. The three are Welcome, Checks and Your plan.
- **Under two minutes of attention on the whole default path,** not counting slides the person chooses to read.
- **Progress as time and outcome, never a long step count.** The kit `Wizard` strip shows three phases: Check, Install, Meet your Home. There is no numbering inside a phase. While files download, every screen says, for example, "About 6 minutes left. You can close this page; Home keeps going."
- **Downloads start the moment the engine computer passes its checks.** The ones every plan needs start first, and the plan screen adds the rest.
  - Nothing downloads before the person has pressed "Set up my Home" on Welcome. That click is the person choosing the ability, which SERVICES.md requires before an on-demand download.
  - Nothing downloads before the engine computer has been checked either. You ruled that out because the engine computer may be a different machine.
- **The checks page passes itself.** When everything is green, it shows the green list for about 1.5 seconds and moves on. It stops only on amber or red.
- **Every answer is pre-filled.** Language, time zone and units come from the browser. The hub name defaults to "Home". The plan defaults to the best level the engine computer meets.
- **Human-time tasks come first.** The owner account and face come before Hello. They use the waiting time instead of adding to it.
- **Every optional step says "Do this later"** and adds an item to the "Finish setting up" checklist in Home settings.
- **Resume where they left off,** from the server's setup state, never from the browser's session storage.

### Every screen, with its cost

Seconds are the person's attention, estimated. They are UNVERIFIED until SETUP-TIME-01 measures five people on the seeded flow.

| # | Screen | Phase | Required or optional | Seconds | Clicks | Skip or default |
|---|---|---|---|---|---|---|
| 1 | Welcome | Check | Required | 15 | 1 | Nothing to answer. "Restore from a backup" is a secondary link. |
| 2 | Checks | Check | Required | 3 when green | 0 when green | Moves on by itself when green. Amber needs one click ("Continue anyway"). Red stops. |
| 3 | Your plan | Check | Required | 15 | 1 | The best level for the engine computer is pre-selected. "Choose for myself" opens Custom. |
| 4 | Create your owner account | Meet your Home | Required | 30 | 1 | The name has no default. The owner-or-admin card is read here. A PIN is required (`ROLE_REQUIRES_CREDENTIAL`). |
| 5 | Your face | Meet your Home | Optional | 0 (skipped) to 45 | 1 | "Do this later" adds it to the checklist. |
| 6 | Hello | Meet your Home | Required, and it is the reward | 15 (plus any wait for the starter) | 1 | The person can type a question or press "Continue". |
| 7 | You're all set | Meet your Home | Required | 10 (25 if the backup key is saved now) | 1 (2 with the key) | "Open my Home". The backup key row (Download, Print) sits here; leaving it adds a checklist item. |
| (2) | Web search check | Check | A row on Checks, never a screen | 0 | 0 | Defaulted. Amber never stops the flow (see "Web search (SearXNG)"). |
| (3) | Web search line | Check | One line on Your plan, never a screen | 0 (3 if read) | 0 (1 to accept a SearXNG found on this computer) | Defaulted to "Home's own private search". A SearXNG found on this computer is offered with "Use it", never switched on by itself. |
| (2) | Away-from-home access | Check | An info row on Checks, never a screen | 0 | 0 | Off by default. |
| (7) | Away-from-home line | Meet your Home | One line on You're all set, never a screen | 0 (3 if read) | 0 | "Want Home on your phone when you're out? Set up Tailscale (recommended)." The button opens the Away from home page; the line also becomes a checklist item. |
| (7) | Phones and tablets (HTTPS) | Meet your Home | One row on You're all set | 0 | 0 | The household certificate is made here. "Add a phone or tablet" shows the QR that installs it (see "Secure connections for every device"). |
| | **Default path total** | | | **about 90 seconds and 6 clicks with face skipped; about 135 seconds with face; plus 15 seconds if the backup key is saved on the spot** | | |

Web search, HTTPS and away access add no screen and no required click to the default path:

- **Web search** is a defaulted line, because a working default needs no decision.
- **HTTPS for other devices** is made ready on the last screen. The hub's own browser is on localhost, which browsers already treat as secure, so nothing in setup waits for it.
- **Away access** is one recommended line on the last screen, not a step. Setting it up happens outside the browser: an app install and a sign-in with a third party. A step would stall the flow on work the browser cannot do.

Before the install starts: screens 1 to 3, two clicks, about 33 seconds. The Install phase has no screen of its own. It is the strip at the top of screens 4 to 7, plus the hero carousel that fills any wait.

### Screens from today's wizard that do not belong in the first run

| Today's step (`SetupWizard.tsx`) | Verdict | Where it goes |
|---|---|---|
| Household | Not needed. The name is optional and defaults to "Home". | `household.family_name` in Home settings, General (the key exists, `lives_in: household.system`) |
| Before you start (the unrestricted acknowledgment) | Not needed on first run. SAFETY.md makes it per adult: one dialog when that adult first turns unrestricted mode on. | The unrestricted switch's own confirmation (the grant with `acknowledged_at`). The AI-outputs disclaimer is a different thing and stays on Welcome. |
| Hardware | Merged into Checks and Your plan. | Screens 2 and 3 |
| Trust this hub | Not needed as a screen. The hub's own browser is on localhost, already secure. | The certificate is made on You're all set; its row "Add a phone or tablet", the checklist item of the same name and the family-invite QR flow carry it (`GET /api/setup/ca`) |
| Packages | Not needed. The default set installs on its own. | Store, and the checklist item "Add apps" |
| Remote access | Not needed. It is off by default under PRIVACY.md. | Home settings, Network and access, and the checklist |
| Backups | Not needed as a screen. A local nightly backup runs from first boot (BACKUPS.md). | The checklist item "Choose where backups go" |
| Emergency kit | Not a screen (your decision). The household backup key is the one Home-level secret a person must keep. | A row on You're all set (Download, Print), and Home settings, Storage and backups. Each person's own recovery stays in that person's own setup. |

## The flow

```
installer ends ──► open http://localhost:<port> on the hub
   [1 Welcome] ──► [2 Checks: hub + engine computer] ──auto on green──► [3 Your plan] ──Install──►
                       │ red: stop with the fix
                       └ "Restore from a backup" ──► restore flow (BACKUPS.md)
                       (downloads every plan needs start the moment checks pass)

The Install phase runs in the background from here on. Its strip sits on top of every screen below.

[4 Create your owner account] ──► [5 Your face]? ──► [6 Hello] ──► [7 You're all set] ──► Home
                                                     ▲ hero carousel fills any wait for the starter
```

### Back, skip and leave rules

- **Back** works on every screen before Install. After Install, Back moves between the account screens but never returns to Checks or Plan. The plan is changed in Home settings, AI, which is safe while downloads run.
- **Skip** appears only on optional screens, and it says what it does: "Do this later" adds the item to the checklist.
- **Leaving** is always safe. Closing the tab never cancels a download. Reopening the address resumes at the first unfinished screen, read from `GET /api/setup/state`.
- **The kit `Wizard`** takes the three phases as its `steps` (`check`, `install`, `meet`), with `completedCount` from the setup state, so the strip never grows past three. Its own Back, Continue and Skip props are the buttons. There is no hand-built footer.

## Setup works only on the hub itself

You decided that the wizard and owner account creation work only from the hub's own loopback address (127.0.0.1 or ::1). There is no setup code. Before an owner exists, anyone who can reach the address could otherwise claim the hub, for example a guest on the Wi-Fi.

**This is separate from the engine computer.** The hub's setup is local only. The engine computer can still be another machine on the network, which the hub connects to, and the wizard sizes the plan on that machine (see Checks).

**How the server enforces it** (one middleware on every `/api/setup/*` route and on `POST /api/auth/setup`):

1. **The peer address of the socket must be a loopback address.** In Bun this is `server.requestIP(request)` (Hono's `getConnInfo` on the Bun adapter). The check never trusts a header: not `Host`, `X-Forwarded-For`, `Forwarded`, `X-Real-IP` or `CF-Connecting-IP`.
2. **A request that carries any forwarding header is not local, whatever its peer address.** A reverse proxy on the same machine connects from 127.0.0.1, so without this rule every request through it would look local. With it, a proxied request is refused, and nothing can be bypassed by adding or forging `X-Forwarded-For`. A proxy that strips those headers before forwarding would still look local. The install docs therefore say: finish setup before putting Home behind a proxy.
3. **The `Host` header must be `localhost`, `127.0.0.1` or `[::1]`, with any port.** This is an extra guard against DNS rebinding (a web page making the person's own browser call the hub under a different name). It is never the only check.
4. Tests cover a loopback peer, a LAN peer, a loopback peer with `X-Forwarded-For: 127.0.0.1`, a loopback peer with `Forwarded`, and a loopback peer with a foreign `Host`.
5. **Tailscale serve also connects from loopback.** `tailscale serve` proxies a tailnet HTTPS name to `http://127.0.0.1:<port>` (Tailscale kb/1312), so its requests arrive from a loopback peer. Check 3 refuses them, because their `Host` is the `*.ts.net` name. Whether serve also adds `X-Forwarded-For` is not confirmed: UNVERIFIED. A test fixture with a loopback peer and a `*.ts.net` `Host` proves the refusal either way (SETUP-HTTPS-01).

**What a browser elsewhere sees** (any address other than loopback, before setup is done). It gets one plain page with no form, built from the kit `Card` and `Page`:

> **Finish setting up on the computer running MaiPai Home**
>
> For safety, Home's first setup only works on that computer. Open **http://localhost:3000** in a browser on it.
>
> No screen on that computer? On your laptop, open a terminal and run this one line, then open **http://localhost:3000** on your laptop:
>
> `ssh -L 3000:localhost:3000 you@your-hub`
>
> Replace `you@your-hub` with how you usually sign in to that computer.

The port in the copy is the hub's real port. The installer may have moved it from 3000 (`find_free_port`). An SSH port forward reaches the hub from its own loopback address, so it passes check 1 honestly. The installer's last line points to the same page: "Open http://localhost:3000 in a browser on this computer to finish setup. On a computer with no screen, see the line above for the ssh command."

**After the owner exists, the setup routes close:**

- `POST /api/auth/setup` returns 409 with "Home is already set up. Sign in instead."
- `POST /api/setup/:step` for the steps before the account (`welcome`, `checks`, `plan`) returns the same.
- The steps after the account (`face`, `hello`, `done`) need the signed-in owner's session, as every other settings action does. In practice that is the same browser, still on localhost.
- `GET /api/setup/state` returns only `{ done }` to anyone who is not signed in.
- "Run setup again" in Repairs is an ordinary signed-in page for the owner and admins, not the setup routes. It works from any device, because by then sign-in protects it.

## The downloads every plan needs

Every plan includes these files, so starting them before the person chooses a plan wastes nothing. They start when check 2 passes on the engine computer. Byte counts come from `stack/backend/src/lib/modelCatalog.ts` (`approx_bytes`).

| File | Role | Bytes |
|---|---|---|
| `qwen3-1.7b-q8-0` (the starter chat model) | chat, until the full model is in | 1,834,426,016 |
| `moonshine-tiny-en-int8` | stt | 107,600,538 |
| `silero-vad` | stt | 643,854 |
| `pocket-tts-english`, plus its tokenizer and voice `alba` | tts | 225,282,959 |
| `nomic-embed-text-v1-5-q4-k-m` | embed | 84,106,624 |
| openWakeWord melspectrogram, embedding, `trained-hey-maipai-v2` | wakeword | 3,351,779 |
| Home's own SearXNG (pinned release plus its Python packages, through `uv`), once STACK-SEARCH-01 lands. The packages are hash-locked (`uv` with `--require-hashes`, or a `uv.lock` with hashes), and every host they are fetched from (the PyPI index and file host, the release host) gets its `/stack/v1/privacy` row in the same commit (RELEASES-AND-DEPENDENCIES.md, PRIVACY.md) | web search | not measured: UNVERIFIED, likely tens to a few hundred MB |
| **Total** | | **about 2.26 GB, plus SearXNG** |

The engine binaries come with them: the llama.cpp build and the Python tool `uv` (about 17 to 20 MB, `stack/backend/src/lib/engineCatalog.ts`). The size of the llama.cpp archive was not found in the catalog: UNVERIFIED.

The starter is what SETUP-START-01 and STACK-START-01 already decided. The Stack serves the starter while the chosen model downloads, then swaps over through its drain and identity check. This note only sets when the starter download begins: at check 2, not at the plan click.

## Hardware levels and sizing

Your decision 2 sets three levels: Recommended, Moderate and Minimal. Anything below Minimal is refused. **Every number is judged on the engine computer.** That is the machine that runs the Stack, not the device showing the browser and not the hub when the engine is elsewhere. The Stack reports its own hardware (`GET /api/engines/hardware`, through the engine link when remote), and Home only words what the Stack says.

**AI memory** is the memory the models load into:

| Engine computer | AI memory is |
|---|---|
| Apple silicon | its unified memory |
| Computer with NVIDIA or AMD graphics | the graphics memory added up across all its cards (two 8 GB cards make 16 GB) |
| No supported graphics | none. AI memory is zero, and the computer is refused. |

System memory is a separate minimum on non-Apple machines, because the hub, the embedder and the operating system live there.

| Level | AI memory | System memory (non-Apple) | Free disk on the engine computer | Processor and graphics | Stack tier | Runs all the time | Loads when needed | Not available | Download |
|---|---|---|---|---|---|---|---|---|---|
| **Recommended** | 64 GB or more | 32 GB or more | 40 GB | Apple M-series, or NVIDIA with current drivers | p64, p128 | chat, judge, router, embed, rerank, stt, tts (coding too at p64) | image (p64); coding, vision, image, video, music (p128) | vision, video, music (p64); none (p128) | about 9.78 GB, plus the image model (4,265,146,304 bytes) the first time someone makes a picture |
| **Moderate** | 32 to 63 GB | 32 GB or more | 25 GB | the same | p32 | chat, coding, judge (its own 4B), router, embed, stt, tts | rerank | vision, image, video, music | about 9.78 GB |
| **Minimal** | 16 to 31 GB (for example a 16 GB or 24 GB Mac, or a box with two 8 GB cards) | 16 GB or more | 20 GB | the same | p16 | chat (8B), coding, judge (shares chat), router, stt, tts | embed | rerank, vision, image, video, music | about 7.28 GB |
| **Below Minimal** | under 16 GB, or no supported graphics | | | Intel Mac, or a PC with no supported graphics card | none | refused | | | |

Where the numbers come from:

- **Tiers, roles and labels:** the Stack's `PROFILE_TIERS` and `PROFILE_MODEL_BINDINGS` (`stack/backend/src/profiles.ts`).
- **Download sizes:** the model catalog.
- **What fits on Minimal, measured in stack `docs/dev.md`:**
  - The 8B chat needs 8,436,858,360 bytes plus the 4 GiB p16 margin, so about 12.73 GB available to start.
  - Live, it held about 8.1 GiB at a 40,960-token context, on llama.cpp b10797, on an Apple M4 Pro laptop with 24 GB.
  - Vision does not fit beside the 8B on 24 GB (measured 2026-10-06).
- **Disk figures:** twice the download (the Stack keeps the old model beside the new one during a swap), plus `storage.critical_free_gb`'s 2 GB default, rounded up. They are proposed: UNVERIFIED.
- **System memory figures:** proposed, not measured: UNVERIFIED.
- **Speed ranges** in `profiles.ts` are not shown to families until a bench backs them.

**Two things must change in the Stack for this table to be one definition** (org principle 4). Both are filed below as STACK-LEVELS-01:

1. **The level names live on the tier.** Add `level: "minimal" | "moderate" | "recommended"` to `ProfileTier` in `profiles.ts`, so Home and the robot word the same field instead of keeping their own mapping.
2. **The graphics-memory thresholds disagree with your levels.** Today `minVramGb` is 8 for p16, 16 for p32 and 24 for p64. Under that rule a box with two 8 GB cards would count as p32 (Moderate), if `primaryBudgetBytes` adds the cards together (UNVERIFIED), and a single 8 GB card would count as Minimal. Your rule makes the two-card box Minimal, which puts the threshold at 16 GB of total graphics memory. The Stack's thresholds should follow your levels, or a bench should show they need not. Open question 2 asks how system memory counts.

This replaces the earlier draft's "8 GB red line" and its "floor" plan, where the 1.7B model was the household's only chat model. The 1.7B model stays as the starter on every level and stays the robot's own model. It is no longer a hub plan.

**Refusal copy** (red on check 4, and on the plan screen):

> **This computer is too small for MaiPai Home's AI**
>
> The computer running Home's AI has 12 GB of memory for AI. Home needs at least 16 GB. Use a computer with more memory (a Mac with 16 GB or more, or a PC with graphics cards that add up to 16 GB or more). Or run Home's AI on a bigger computer on your network and connect it under "Use another computer".

"Use another computer" opens the engine-computer pairing (`/api/engine-link`, `engines.stack.where`), the same page as in Home settings, AI.

## Install options

Shown on screen 3. The best level the engine computer meets is pre-selected and labelled "(Best for this computer)". Levels it does not meet are not shown.

| Option | Who it is for | Total download | At 50 Mbit/s | At 300 Mbit/s | At 1 Gbit/s |
|---|---|---|---|---|---|
| **Recommended** (64 GB AI memory and up) | Big machines | about 9.78 GB now, plus 4.27 GB on first picture | about 26 min | about 4.5 min | about 1.5 min |
| **Moderate** (32 to 63 GB) | Larger desktops and Macs | about 9.78 GB | about 26 min | about 4.5 min | about 1.5 min |
| **Minimal** (16 to 31 GB) | Most families' existing computers | about 7.28 GB | about 19 min | about 3 min | about 1 min |
| **Choose for myself** (Custom) | People who want control | sized live | | | |
| **Restore from a backup** | A household moving computers or recovering | whatever the backup's pins name (BACKUPS.md: model weights are rebuilt from pins, never carried in the backup) | | | |

Times are size divided by line speed, rounded, and leave out the checksum time (not measured: UNVERIFIED). On screen, the estimate uses the measured speed of the running download, never this table.

A person may pick a level below the best one, for example to keep a shared computer light. They can never pick one above it: the Stack refuses a plan that does not fit.

Pictures, video, music and photo understanding are never in the first download. Where a tier offers them, they are "on demand" in `profiles.ts`. The model downloads the first time someone asks for one, with its own progress shown in the conversation.

**Every download, every option:**

- fetched by the Stack on the engine computer, from a pinned address, never by the browser
- checked against its SHA-256 before use (`download.ts`); a failed check retries once, then raises one Repairs item
- resumed from its `.part` file with an HTTP range request after an interruption
- a stall is reported in plain words: "The download stopped. Home will keep trying; check the internet connection of the computer running Home's AI."
- progress is one overall bar plus "about N minutes left"

### Choose for myself (Custom)

Custom opens in place on screen 3 when the person picks "Choose for myself". It is the same page SETUP-SIZE-01 builds for Home settings, AI (one card per role, SETTINGS.md rule 3), not a second copy:

- **Models:** for each role, the Stack's proposal, a smaller choice, "when needed" or off. Sizing comes from the Stack's fit plan (`POST /api/fit-plan`), worded by the fit-verdict module (`docs/plans/fit-verdict-ui-2026-09-30.md`).
- **Where files are kept:** the per-class storage choice from DATA-LOCATION-01c (models, media, backups), with free space shown per disk.
- **Offline library:** the KS-REF-WIZARD-01 choice (Full, Moderate, Minimum, or none), shown here as one more card, off by default. On the default path it is never a screen. It is the checklist item "Add the offline library" (see Supersedes).
- **Web search:** "Home's own private search" (the default), "Use my own SearXNG" (an address, checked on save), or "No web search, offline library only". The same card as Home settings, Web search (see "Web search (SearXNG)").
- **Network:** "Only this computer" or "Everyone on my home network" (the default). The port is shown, not asked; the installer already found a free one.
- **Voice and vision:** two switches. "Talk to Home with your voice" is on. "Let Home look at photos" is off, and unavailable on tiers that list vision as not available, with the reason taken from the tier label.

## Page by page

Every part is a kit part from `@maipai/ui/src/ui/*` or `@maipai/ui/src/primitives/*`, used as it ships and restyled only by tokens (rules 9 and 9b). Two parts the kit lacks, `alert` and `carousel`, are added from the shadcn registry first (KIT-ALERT-01, KIT-CAROUSEL-01). The wireframes name the parts.

### 1. Welcome

**Purpose:** say what Home is and what it promises, then start.

```
Page (primitive)
└ Wizard (phases: Check · Install · Meet your Home; current = Check)
  └ Card
    ├ brand image: maipai-home-logo-light.png / -dark.png (from brand/, chosen by theme)
    ├ heading:  "Welcome to MaiPai Home"
    ├ text:     [COPY.md key "home"]
    ├ Separator
    ├ List (primitive; three rows, icon + text)
    │   • "Nothing leaves your house."
    │   • "No account with us, no subscription, no tracking."
    │   • "Kids get their own safe profiles. Parents decide what they can access."
    ├ text (small): the AI-outputs disclaimer, below
    ├ Button (primary): "Set up my Home"
    └ Button (link variant): "Restore from a backup"
```

**The disclaimer** (SAFETY.md, "AI-outputs disclaimer ... in the product's first-run"). It carries every required point: the models come from third parties the user chooses to download; outputs can be wrong, offensive or harmful; they are not medical, legal or professional advice; the user is responsible for how they use them.

> "Home's answers come from AI models you choose to download. They can be wrong, offensive or harmful, and they are not medical, legal or professional advice. You are responsible for how you use them."

**Jesse: please read this wording** (open question 4). It is proposed copy and the only legal-facing line in the flow.

**Copy sources:**

- The Home sentence is read from COPY.md's "home" entry by key (see Hero data), never retyped.
- "Nothing leaves your house" is PRIVACY.md's phrase.
- "Parents decide what they can access" follows SAFETY.md's "parents decide what kids can access".
- The other promise line is proposed.

**Stored:** only that `welcome` is done, with the time.

**This click is the person's choice that starts downloads.** SERVICES.md lets a service download when the person chooses an ability. "Set up my Home" is that choice: the person has asked for Home's AI. Nothing downloads before it. Check 2 then decides whether this machine can take the files, and the downloads every plan needs begin the moment it passes.

**Errors:** none can occur here. If the setup state cannot be read: "Home can't read its setup progress. Refresh this page. If it keeps happening, restart MaiPai Home on this computer or run the installer again."

### 2. Checks

**Purpose:** prove that the hub and the engine computer can run Home, without asking anything.

```
Wizard (current = Check)
└ Card
  ├ heading: "Checking your computers"   ("Checking this computer" when the engine is local)
  ├ text: "Home's AI runs on: this computer"  or
  │       "Home's AI runs on: another computer (192.0.2.20). 2 graphics cards, 16 GB for AI, 32 GB memory."
  ├ List (primitive; one row per check: status pill from ui/status + name + one-line result)
  ├ AsyncState (primitive) while the rows stream in
  ├ text (tip, changes per check): e.g. "Home runs in your house, so chat works even when
  │                                     your internet is down."
  ├ Alert (kit, new) only on amber or red: what is wrong, what to do, and an action Button
  ├ Button (primary, only on amber): "Continue anyway"
  └ Button (link): "Restore from a backup instead"
```

BACKUPS.md wants restore offered on the second screen of onboarding. This is that screen.

**Which machine each check is about.** The engine-computer line at the top is read from the Stack, never from the browser. If the installer was run with a remote engine (`engines.stack.where` = remote), or the person picks "Use another computer" on a red check, the hub pairs with that Stack through the existing engine link. The memory, graphics, driver and model-disk checks then describe that machine. The hub's own disk, port, clock and network checks still describe the hub.

**The checks, in the order they run.** The cheapest and most blocking run first, so a red shows within a second. This page calls INSTALL-PREFLIGHT-01's one preflight function; it does not copy it.

| # | Check | On | Green | Amber (warning, can continue) | Red (blocker) | Copy for amber or red |
|---|---|---|---|---|---|---|
| 1 | Engine service | engine computer | The Stack answers `/healthz` | | The Stack does not answer | "Home's AI engine isn't running. Press Repair. If that fails, run the installer again on the computer that runs Home's AI." Action: "Repair" (`POST /api/engines/{name}/install`), then "Try again". |
| 2 | Memory and graphics | engine computer | Minimal level or higher (table above) | | Below Minimal | The refusal copy above. **When this passes, the downloads every plan needs start.** |
| 3 | System | engine computer | macOS on Apple silicon, Linux on arm64 or x64 with supported graphics, Windows through `install.ps1` | | Intel Mac, or no supported graphics | Folded into check 2's refusal. |
| 4 | Free disk for models | engine computer | at least the level's figure in the table | between the download plus 2 GB and the level's figure | less than the download plus 2 GB (`storage.critical_free_gb`) | Red: "There isn't room for the AI models. Free up about N GB on the computer that runs Home's AI, or choose another disk under Choose for myself." |
| 5 | Graphics driver (NVIDIA only) | engine computer | Driver present, CUDA devices listed | The CUDA "system memory fallback" policy is on (ported from the old wizard's guard; detail UNVERIFIED) | | "Your graphics driver may slow chat down by borrowing system memory. Open NVIDIA Control Panel, Manage 3D settings, and set CUDA Sysmem Fallback Policy to Prefer No Sysmem Fallback." |
| 6 | Download host | engine computer | The pinned model host answers | Slow (under about 5 Mbit/s on the first megabytes; proposed threshold, UNVERIFIED) | No answer, and the model files are not already there | Red: "Home can't reach the internet to download its AI models. Check the internet connection of the computer that runs Home's AI, then press Try again." Amber: "Your connection is slow, so the download will take about N minutes." |
| 7 | Hub disk | hub | room for Home's data plus 2 GB | | under 2 GB free | "This computer is almost out of space. Free up at least 2 GB, then press Try again." |
| 8 | Clock | hub and engine computer | browser, hub and engine computer agree within 2 minutes | they differ by more | | "This computer's clock is off by N minutes. Turn on automatic time in its system settings." The household certificate and the records' clock stamps depend on it. Threshold proposed: UNVERIFIED. |
| 9 | Home network | hub | Home answers on an address other devices in the house can reach | It answers only on this computer (a firewall, or bound to loopback) | | "Phones and tablets in your house can't reach Home yet. Allow MaiPai Home in this computer's firewall." Whether the hub binds to every interface today: UNVERIFIED. |
| 10 | Engine link (remote engine only) | between the two | The engine link (REMOTE-STACK-LINK-01) reports `ready` | `degraded`: median probe round trip over the last 6 probes above 500 ms, the link's own threshold | No route | "Home can't reach the computer that runs its AI at 192.0.2.20. Check that it's on and on the same network, then press Try again." Over Tailscale, see "Away from home (Tailscale)" for the extra rows. |
| 12 | Web search | engine computer | Home's own SearXNG passes the SearXNG checker. A SearXNG found on this computer is reported here and offered on Your plan, never used without the click (rule 11) | Not reachable yet, or the checker finds a problem | never red | "Web search isn't ready yet, so Home will answer from its offline library and what the AI already knows. You can fix this later in Home settings, Web search." Never stops the flow. |
| 13 | Away from home | hub | (grey, info only) "Tailscale found on this computer. You can turn on access from away later." or "Off. You can set this up later." | | | Never stops the flow. Never installs or signs in to anything. |
| 11 | Camera and microphone | | Not checked here. The row reads "Checked when you set up your face." (grey, Idle) | | | Asking for a permission before it is needed is the pattern Apple's HIG warns against. |

**Ports** are not a check row. The installer's `find_free_port` already chose the hub's port, and the Stack's base port is 8770. If the Stack's port is taken, check 1 turns red.

**Stored:** each result as a health-item row (code, severity, title, text, fix; `commons/spec/schemas/health-item.schema.json`) in the setup state, so the same rows show again under Home settings, Health. An amber the person continued past stays as a Repairs item.

**On pass:** Home records the engine computer's hardware facts, asks the Stack for its proposed tier, and asks the Stack to start the downloads every plan needs. Repeating that request is safe.

### 3. Your plan

**Purpose:** one click to accept the right level for the engine computer.

```
Wizard (current = Check, next = Install)
└ Card
  ├ heading: "Here's the plan for your Home"
  ├ text: the tier's own label from profiles.ts, e.g. "This computer can run chat and voice,
  │       with embeddings when needed. Images, video, and music are not available."
  ├ ToggleGroup (single): Recommended · Moderate · Minimal (only levels that fit; best one
  │                        selected and marked "(Best for this computer)") · Choose for myself
  ├ text: "Web search: Home's own private search." + Button (link): "Change" (opens the Custom card)
  │   only when one was found: "Found a SearXNG on this computer." + Button (secondary): "Use it"
  │   (the click writes search.searxng_url; without it Home's own stays the default)
  ├ text: "Download: about 7.3 GB. About 6 minutes on your connection. Already started."
  ├ text (small): "Downloads come from a fixed address and are checked before use.
  │                If the internet drops, Home picks up where it left off."
  ├ Collapsible (opens for "Choose for myself"): the SETUP-SIZE-01 role cards, storage,
  │   offline library, network, voice and vision switches
  └ Button (primary): "Install"
```

**Stored:** `plan.option` (`recommended`, `moderate`, `minimal` or `custom`), the tier id, and, for each role, the choice. The choices are written as the per-role Setting records SETUP-SIZE-01 names (`engines.<role>.choice`, spec first). The wizard never keeps a second copy of the allocation.

**Errors:** the Stack refuses a Custom set that does not fit and names the roles to turn down. Its `fitRefusalMessage` is worded by Home: "This set needs about 3 GB more memory than the computer running Home's AI has. Turn off photos, or pick a smaller chat model."

### The Install phase (no screen of its own)

From "Install" on, every screen carries the install strip at the top:

```
Card (compact)
├ Progress (primitive): one overall bar, percent
├ text: "Installing. About 6 minutes left. You can close this page; Home keeps going."
└ Button (link): "Details" → Sheet with one row per file (name in words, size, state)
```

| State | Text |
|---|---|
| Running | "Installing. About N minutes left. You can close this page; Home keeps going." |
| Stalled | "The download paused. Home will keep trying. Check the internet connection of the computer running Home's AI." |
| Checksum failed twice | "A downloaded file was damaged. Press Try again. If it fails again, Home will show a fix under Settings, Repairs." |
| Out of space | "The computer running Home's AI ran out of space. Free up N GB, then press Try again." |
| Starter ready, full model still coming | "You can start talking now. Home will switch to its full AI in about N minutes, with a short pause." |
| Done | "Everything is installed." (then the strip goes away) |

### Hero carousel

The carousel shows only when the person has nothing left to do and something is still downloading: on Hello while the starter is not ready, and on screen 7 if the full model is still coming. It never shows before Install, never replaces a question, and is never a reason to wait longer.

```
Carousel (kit, new: shadcn Carousel on Embla, KIT-CAROUSEL-01)
├ CarouselContent
│ └ CarouselItem × 5 to 7, each a Card: brand image (from brand/, never redrawn) · heading · one sentence
├ CarouselPrevious · CarouselNext (labelled "Previous slide", "Next slide")
├ dots (one Button per slide, aria-label "Slide 2 of 6")
└ Button: "Pause" / "Play" (always visible, WCAG 2.2.2)
```

**The slides.** Where the text comes from COPY.md it is referenced by key, never retyped. "Proposed" means new copy for you to accept.

| id | Picture (from `brand/`) | Heading | Text | Teaches |
|---|---|---|---|---|
| `hero.home` | `maipai-home-logo-light.png` / `-dark.png` | "Your own AI at home" (proposed, echoing the org line) | COPY.md key `home` | What Home is |
| `hero.privacy` | `maipai-home-icon-light.png` / `-dark.png` | "Nothing leaves your house" (PRIVACY.md) | Proposed: "What your family says, asks and makes stays in your house. No account with us, and nothing is tracked." | Privacy promise |
| `hero.try` | `maipai-brand-icon.png` | "Ask it anything" (proposed) | Proposed: "Try \"What can you do?\" or \"What's a quick dinner with eggs and rice?\" when Home says hello." | What to try first |
| `hero.kids` | `maipai-brand-logo-light.png` / `-dark.png` | "Safe for the whole family" (proposed) | Proposed: "Everyone gets their own profile. Kids get gentle answers by default, and parents decide what kids can access." | Kids' protections |
| `hero.apps` | `maipai-ecosystem.png` | "Add apps when you want them" (proposed) | COPY.md key `catalog` | How to add apps |
| `hero.offline` | `maipai-stack-icon-light.png` / `-dark.png` | "Works when the internet doesn't" (proposed) | Proposed: "Chat and voice run in your house, so they keep working when your internet is down." | Offline |
| `hero.bot` (only when a robot package is in the catalog) | `maipai-bot-logo-light.png` / `-dark.png` | "Meet MaiPai Bot" (proposed) | COPY.md key `bot` | The robot, once it ships |

`hero.bot` stays hidden unless the product is available. Promoting something a family cannot get is the kind of nag this design rules out.

**Behavior.** These follow the WAI-ARIA carousel pattern (https://www.w3.org/WAI/ARIA/apg/patterns/carousel/), WCAG 2.2 criterion 2.2.2 (https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) and Embla's autoplay options (https://www.embla-carousel.com/plugins/autoplay/). None of the three was fetched in this session: UNVERIFIED.

- **Pace:** autoplay every 8 seconds, looping. NN/g's auto-forwarding guidance argues for slow (https://www.nngroup.com/articles/auto-forwarding/, not fetched: UNVERIFIED).
- **Pausing:** pauses on hover and on keyboard focus anywhere inside. Any manual move stops it for good.
- **Pause button and reduced motion:** a Pause button is always visible. With `prefers-reduced-motion`, the carousel starts paused and slides change without animation.
- **Keyboard:** arrow keys move between slides when focus is inside. Previous, Next and the dots are real buttons.
- **Screen readers:**
  - The region has `aria-roledescription="carousel"` and a label: "What Home can do".
  - Each slide is a group labelled "N of M".
  - The live region is `off` while playing and `polite` when paused.
  - Where the shadcn part lacks one of these, it is added in commons as a prop that changes nothing for existing users (rule 9).
- **Phone width:** one slide fills the card, swipe works, and the controls sit under the slide.
- **Fully offline:** pictures are bundled at build time from `brand/`. The carousel makes no network request and records nothing about who saw which slide.
- **No dark patterns:** no countdown, no "upgrade", no "rate us".

**Hero data, declared once.** The slides are a data file, `frontend/src/content/hero.json` in Home, validated by a new spec schema, `hero-slide.schema.json`. Fields:

| Field | Meaning |
|---|---|
| `id` | e.g. `hero.privacy` |
| `image` | a brand file name |
| `heading` | proposed text, or a `copy_ref` |
| `copy_ref` | a COPY.md key, e.g. `home` or `catalog`, resolved at build time from `.github/brand/COPY.md`, so the line exists only there (org principle 4) |
| `text` | only when the copy is proposed |
| `copy_source` | `copy:<key>`, `doc:<file>` or `proposed`, kept for review |
| `teaches` | what the slide is for |
| `audience` | `all`, `adult` or `admin` |
| `available_when` | optional condition |
| `order` | sort position |

The build fails if a `copy_ref` names a key COPY.md does not have.

Three readers use the file:

1. this carousel
2. the guided tour, whose steps may name a slide by id in `hero_slide` (the shell tour's last step uses `hero.privacy`; see `docs/plans/guided-tour-2026-10-13.md`)
3. a Home settings view, "What Home can do" (System section), that lists the slides as cards

A child or teen sees only slides whose `audience` is `all`.

### 4. Create your owner account

**Purpose:** create the owner, and say in plain words what that means. This is where "Meet your Home" starts. It is the existing account creation, not a new form.

```
Wizard (current = Meet your Home)
├ install strip
└ Card
  ├ heading: "Create your owner account"
  ├ Card (inner, small; the kit Card as shipped): "Owner or admin?"
  │   text: "You're the owner. You're in charge of this Home: who's in the family,
  │          who helps run it, where things are stored, and the backups. Nobody can
  │          remove you."
  │   text: "Later you can add admins. An admin is a trusted helper, like another
  │          parent. They can add apps and look after settings, but they can't
  │          change who's in charge, reset Home or bring back a whole backup."
  ├ Label + Input: "Your name"
  ├ Label + Input (password type; numeric keypad allowed): "PIN or password"
  ├ text (small): "You'll use this to sign in and to change Home's settings."
  ├ (the standard new-person recovery step follows, as every person gets it in their own setup;
  │  this wizard adds nothing of its own for it)
  └ Button (primary): "Continue"
```

The card's wording is proposed copy (open question 4), checked against the owner-only table in "Owner and admin": roles, people, storage (factory reset), backups (restore and the backup key) and other admins' settings are owner only. "Add apps and look after settings" matches what admins can do today. It is one card on the account screen, not a screen of its own, so it adds no click; reading it is about 8 seconds, counted inside screen 4's 30.

- **Route:** calls `POST /api/auth/setup`, which creates the name and secret together. The old wizard learned to do this atomically the hard way (commit 24402f86).
- **Role:** `owner`, as `POST /api/auth/setup` already sets it.
- **Localhost only:** this screen exists only on localhost (see "Setup works only on the hub itself").
- **PIN masking:** follows UI-OTP-MASK-01 when that lands.

**Errors:**

- "That PIN is too short. Use at least 4 digits." The real minimum comes from the auth route's validation: UNVERIFIED value.
- "Home is already set up. Sign in instead." This shows with a button to `/sign-in`.
- "Home couldn't save your account. Press Continue again. If it keeps failing, restart MaiPai Home on this computer."

**Not asked:** language, time zone and units (taken from the browser's `Intl` settings into `household.locale`), and the hub name (defaults to "Home").

### 5. Your face (optional, while the downloads run)

This reuses `FaceEnrollmentBody` as it is, with the pose sequence frontal, left, right, up, down from `frontend/src/lib/vision/enrollmentSession.ts`. The camera permission is asked here and only here. It comes before Hello on purpose: it takes the person's time, and their time is free while the files download.

```
Card
├ heading: "Let Home recognise you"
├ text: "Home can greet you by face. Your face is stored as numbers on this computer only."
├ FaceEnrollmentBody (as shipped)
├ Button (primary): "Start"
└ Button (secondary): "Do this later"
```

- "Do this later" adds "Set up face sign-in" to the checklist.
- No camera: "Home can't find a camera on this computer. You can set this up later from your profile on any device with a camera." with a "Continue" button.

### 6. Hello (the first win)

**Purpose:** Home answers, for real.

```
Wizard (current = Meet your Home)
├ install strip
└ Card
  ├ the chat thread Element (kit, as shipped), one assistant message streaming:
  │   e.g. "Hi Nova, I'm your Home. I'm running right here in your house..."
  ├ suggestion chips (kit chat Elements): "What can you do?" · "Plan a quick dinner"
  ├ composer Element (the person can type a question)
  └ Button (primary): "Continue"
```

The starter model generates the greeting from a fixed system prompt plus the owner's name. It is a real turn through the turn engine with the owner's profile, so it also proves the engine works.

**If the starter is not ready yet** (a slow line, see the timing table), the card shows the hero carousel and one line: "Home will say hello in about N minutes. You can close this page; it keeps going." "Continue" stays available, and the greeting then appears on screen 7 or on the home screen.

**Errors:** a failed turn never blocks. "Home couldn't answer yet. It will try again when the download finishes. Press Continue." If it still fails after the starter is ready, Home raises one Repairs item.

### 7. You're all set

```
Card
├ heading: "Your Home is ready"   ("Almost ready", with the install strip, while still downloading)
├ text: "Try these first:"
├ List (primitive; three rows, each a Button that opens the thing):
│   • "Ask Home a question" → chat
│   • "Add your family" → People
│   • "Add apps" → Store
├ Separator
├ row: "Save your backup key"
│   text (small): "If this computer breaks, this file brings your Home back on a new one.
│                  Keep it somewhere other than this computer."
│   Button (secondary): "Download" · Button (secondary): "Print"
├ row: "Add a phone or tablet"
│   Button (secondary): "Show the code" (opens the QR that installs the household certificate)
├ row: "Want Home on your phone when you're out?"
│   Button (link): "Set up Tailscale (recommended)" (opens Home settings, Network and access, Away from home)
├ text (small): "N things left to finish setting up. You'll find them in Home settings."
└ Button (primary): "Open my Home"
```

**What this screen does on load:**

- **Mints the household certificate** (SETUP-HTTPS-01). It calls the same code as `GET /api/setup/ca`, so the leaf for `maipai.local` and the hub's addresses exists from here on, and other devices can use HTTPS (see "Secure connections for every device").
- **Shows the backup key row.** The key is the one Home-level secret a person must keep (`backend/src/lib/emergencyKit.ts`, `GET /api/backups/emergency-kit`; the file holds the backup key, the hub id and the hub name). Download and Print reuse that route. The same row lives in Home settings, Storage and backups, so leaving it here costs nothing but a checklist item. Each person's own sign-in recovery is not here: it stays in that person's own setup, the standard new-person flow.
- **The other Home-level secrets are never shown**: the household certificate's private key and the key store's pepper stay on the hub, and the backup key is what restores them (BACKUPS.md).

**Errors:** "Home couldn't make your backup key. Press Download again. If it fails again, Home will show a fix under Home settings, Repairs." and "Home couldn't make the certificate for your other devices. Phones and tablets can still use Home from this computer's address for now. Open Home settings, Repairs to fix it."

Pressing "Open my Home" marks setup done and starts the shell tour automatically (`docs/plans/guided-tour-2026-10-13.md`).

## Web search (SearXNG)

**What exists today** (read 2026-10-13):

- `search.searxng_url` (household, advanced, default empty, `commons/spec/settings/keys.json`) is the only address Home searches. Its help text says "Leave empty to use the search service MaiPai runs for you", **but that service does not exist yet.** With the key empty, `requireSearxngSettings()` in `backend/src/lib/packageHost.ts` throws "Web search isn't set up yet", so **a new household has no web search today.** The Stack-owned SearXNG is STACK-SEARCH-01 in the Stack backlog, not started. That row is the wizard's real dependency for the default path.
- The checker exists: `backend/src/lib/searchInstanceCheck.ts` (SEARXNG-SET-03) with `GET /api/search/instance`, `/snippet`, `/preview`, `POST /apply`, `/revert`. It checks reachability, JSON output, the limiter, version, web engines, Wikipedia, pictures, safe search for children and teens, news, video, engine errors, privacy-flagged engines and the default safe-search level, in at most four requests through the shared `searxng` bucket.
- `search.web_sources` (SearXNG on by default; children and teens only ever use SearXNG), `search.source_mode` (`live`, `offline` or `mix`; "Library only" is offline), `search.safe_search` per person, and the hosted-key setting (THIN-4H, adults only, off by default).
- The settings page is planned as SEARXNG-SET-05 (Settings, Household, Web search) and the Stack's engine groups as SEARXNG-SET-02.
- Health: `searxngHealth.ts` and `searchHealthState.ts` already tell "limited" from "down" (SEARCH-HEALTH-01 and 02).

**What the homelab taught us** (Jesse's private homelab notes on the household's own SearXNG, read for the proven settings only; no address is carried here). Each lesson becomes a default of Home's own instance:

1. JSON output is off upstream by default (`search.formats: [html]`). Home's instance turns `json` on.
2. The bot-detection limiter blocks a machine caller. Home's instance passes only its own loopback caller.
3. An instance behind a single sign-on page returns a sign-in page, not JSON. The checker already catches that (`looksLikeSignInPage`).
4. A machine with no working IPv6 route but AAAA answers in DNS made every engine time out. Home's instance prefers IPv4 when the machine has no global IPv6 address (behaviour to confirm in STACK-SEARCH-01: UNVERIFIED how SearXNG exposes this).
5. From one home address, Google, DuckDuckGo, Qwant and Wikidata scraping was blocked or CAPTCHA'd. Brave, Google CSE, Yahoo and Wikipedia gave good results, with Bing at a low weight. The engine set is pinned with `keep_only` so an update never switches a new engine on unreviewed.
6. Live benchmarks got the engines suspended for hours. Home's per-host limiter, the person's-pace rule (THIRD-PARTY-SERVICES.md) and the per-request safe-search level stay in force.
7. The first query after a restart can time out while connections warm up. Home's health check sends one warm-up query after each start and does not count its failure.
8. Updates broke silently for months. Home's instance updates only by pinned version, with a health check after and automatic rollback.

### Best design on merit, then the rules

**Best experience:** web search works with no question asked, privately, from the first answer, and the admin never has to know the word SearXNG. Anyone who already runs one can point Home at it. A family that wants nothing to leave the house can choose the offline library only.

**How:** Home's own SearXNG, installed and run by the Stack (STACK-SEARCH-01) on the engine computer, as a pinned, checksummed release run in a Python environment through `uv` (the runtime the Stack already ships). It is never a container: Docker would be an extra program for a family to install and keep running, and the Stack already has the runtime it needs. That is also SERVICES.md's rule ("never as a container"), so here merit and rule agree. A family that already runs SearXNG in Docker uses it through "Use my own SearXNG".

**Checked against the rules:**

- PRIVACY.md (owner's ruling 2026-10-11): the household's own SearXNG passes a query's text to public search engines, with no identity or household data, and a child's or teen's query is checked first. The default is within the rule. The plan line says it, and the privacy page row exists.
- PRIVACY.md, the hosted provider: off by default, the owner's own key, never for a child or teen. It is not in the wizard. It needs an account and a key, and is a Settings choice only. On merit it would add coverage for some households, but nobody should be signing up for a paid service during first setup, so the rule costs nothing here.
- THIRD-PARTY-SERVICES.md: SearXNG is the default path, not a fallback. It runs at a person's pace and backs off on the first signal. The limiter, the shared bucket and quiet mode already do this.
- No conflict found, so no rule change is proposed.

### Where it sits in the flow

- **Checks, row 12.** Never red, never a screen. Amber says what happens instead and where to fix it.
- **Your plan, one line:** "Web search: Home's own private search." with "Change", which opens the Custom card.
- **Downloads:** SearXNG is in the downloads every plan needs, so it starts at check 2 with the starter model.

**Detection, in order.** It stops at the first that passes the checker:

1. `search.searxng_url` is already set (an unattended install or a restore). The checker runs on it.
2. Home's own instance, once the Stack reports the search service `ready`.
3. A SearXNG already answering on loopback on the hub or the engine computer, at the common ports 8888 and 8080 (one request each, then the checker). If found, it is **offered, never used on its own**: the plan line adds "Found a SearXNG on this computer." with a "Use it" button, and only that click writes `search.searxng_url`. Without the click, Home's own instance stays the default (RULES.md rule 11).

Home does not scan the home network for other SearXNG instances. On merit, a scan is slow, cannot tell a SearXNG from any other web server without many requests, and looks like an attack to routers and security software. A family that runs one elsewhere types its address in the Custom card or in Settings.

### Install options

| Option | What happens | Default |
|---|---|---|
| Home's own private search | The Stack installs SearXNG from a pinned release with its checksum, fetched on demand, and runs it with the defaults below. | Yes |
| Use my own SearXNG | The admin types its address. The checker runs on save and names the one-line fix for each failing check (`/snippet`). An unreachable instance is reported, never silently replaced (THIN-4G). | |
| No web search, offline library only | `search.source_mode` = `offline`. Chat answers from the offline library and the model's own knowledge. | |

### Safe defaults for Home's own instance

- **Binding:** 127.0.0.1 only, on the engine computer. When the engine computer is remote, Home reaches search through the Stack, not through a second open port. The Stack forwards search on its own API, so the engine link stays one SSH port forward (a STACK-SEARCH-01 design point, not yet written there: UNVERIFIED).
- **No query logging:** no access log and a warning-level application log. Whether SearXNG writes queries anywhere at its default log level is not confirmed: UNVERIFIED, and STACK-SEARCH-01 must prove it with a test that greps the logs after a query.
- **Formats:** `html` and `json`.
- **Limiter:** on, with only the loopback caller passed.
- **Engines:** the proven set above, pinned with `keep_only`. Children and teens use only safe-search-capable engines (SEARXNG-SET-04), with the per-person level (child strict, teen moderate, adult off) sent per request.
- **Rate:** Home's per-host limiter and the shared `searxng` bucket, as today.
- **Secret key:** generated at install and kept in the Stack's own secrets, never in a file under the repo (CREDENTIALS.md).
- **Updates:** by pinned version only, with a health check and rollback.

### Failure states

| State | Who sees it | Copy |
|---|---|---|
| Home's own search still installing | admin, row 12 | "Web search is still installing. Home will use it as soon as it's ready." |
| Own instance fails the checker | admin, row 12 and Settings | The checker's own title and fix, e.g. "Search results don't come back in a form Home reads. Turn on the JSON format in your SearXNG settings (`search.formats`), then press Check again." |
| Unreachable | admin | "Home can't reach your search service at http://192.0.2.30:8888. Check that it's running and that this address is right, then press Check again." |
| Engines suspended (limited) | everyone, in chat | The existing banner: "Search is limited right now." |
| Down, or set to offline only | everyone, in chat | The existing search health state, shown as a banner (the kit `Alert`, KIT-ALERT-01, or the banner SEARCH-HEALTH-02 already draws), never inside the reply. Admins' banner carries "Fix web search", which opens Settings, Web search. |

**The degrade path, mirroring the plan.** A failed tool never fails the answer (RULES.md, chat rules). When web search is off or unreachable:

- The turn answers from the offline library when one is installed (`search.source_mode`, KS-MODE).
- Otherwise it answers from the model's own knowledge. The model is told the tool failed and words the reply itself; there is no fixed sentence in the chat (RULES.md rule 6).
- The only fixed wording is the health-state banner above the thread, never an error bubble. Whether today's banner already covers "web search is off or down" is not confirmed: UNVERIFIED. SEARCH-HEALTH-BANNER-01 checks first and adds the state only if missing.

### Settings counterpart: Web search (admins only)

This is SEARXNG-SET-05's page (Settings, Household, Web search), not a new one. This note asks it to carry:

| Part | Key or route | Kit part |
|---|---|---|
| Provider choice: Home's own, my own SearXNG, offline only; extra sources | `search.web_sources`, `search.source_mode`, `search.searxng_url` | generic renderer (`ToggleGroup`, `Input`) |
| Health and checks | `GET /api/search/instance` | `List` with `ui/status` pills, `Alert` (KIT-ALERT-01) |
| Check again (60-second cooldown) | the same route | `Button` |
| Engine groups on or off | `stack.search.groups.*`, `stack.search.engines.*` (SEARXNG-SET-02, `needs_restart`) | generic renderer (`Switch`) |
| Test query | `GET /api/search/preview` | `Input`, `Button`, `List` of results |
| Hosted search key | THIN-4H's keys, adults only, write-only secret | generic renderer |
| Privacy note | the privacy page rows | text: "Your search words go to public search engines, without your name or anything about your household. Children's and teens' searches are checked for personal details first." |

## Away from home (Tailscale)

**What exists today** (read 2026-10-13):

- `backend/src/lib/tailscale.ts` runs `tailscale status --json` and reports `not_installed`, `stopped` or `running`, with the MagicDNS name and tailnet addresses. It "detects an existing daemon and never installs one silently".
- `hubEndpoints.ts` adds the tailnet address to the hub's address book. `robot.offlan.tailnet` lets a paired robot use it (ROBOT-ENDPOINTS-01). Tailscale API keys and stored OAuth credentials were dropped by owner decision (no hub-held key).
- The engine link may cross the household's Tailscale network only with `engines.stack.remote.allow_tailnet` on (household, admins only, default off). Tailscale only carries packets; the SSH key and the pinned host key stay the only authentication (REMOTE-STACK-DESIGN, PRIVACY.md).
- Today's wizard has a "Remote access" step that says "This isn't built yet - skip it for now." It goes.

**Two different jobs, kept apart:**

1. **Reaching the hub from away**, for a phone or laptop outside the house.
2. **The hub reaching a remote engine computer.** At home this never needs Tailscale: the engine link uses the home network. Tailscale is needed only when the hub itself travels (a laptop running Home), with `allow_tailnet` on.

### Best design on merit, then the rules

**Best experience for away access:** the admin installs the Tailscale app on the hub and on their phone, signs in once, and Home is reachable at its MagicDNS name, from their devices only, with nothing opened on the router. Among the options, this is the easiest that keeps content private:

| Option | Content seen by a third party | What leaves the home | Family effort |
|---|---|---|---|
| Home network only (default) | none | nothing | none |
| Tailscale | none. Traffic is end-to-end WireGuard; relays "never" can decrypt it (Tailscale, "How Tailscale works", https://tailscale.com/blog/how-tailscale-works, read 2026-10-13) | each device's public key, name, operating system, current public address, and the account used to sign in, held by Tailscale's coordination server, which "carries virtually no traffic" (same source; the exact list of stored fields is UNVERIFIED) | low: one app, one sign-in |
| Headscale (self-hosted coordination server) | none | nothing to a third party; the family runs the coordination server on a machine reachable from the internet (https://headscale.net/stable/, "a single tailnet", read 2026-10-13) | high: a server with a public address to run and update |
| Router WireGuard or VPN | none | nothing | medium to high: router-specific |
| Tailscale Funnel, or any public tunnel | Funnel relays forward TLS without decrypting it, but **anyone on the internet with the address** reaches Home's sign-in page (https://tailscale.com/kb/1223/funnel, read 2026-10-13) | the same as Tailscale, plus a public DNS name | low, but unsafe |

**Checked against the rules:**

- PRIVACY.md: no MaiPai-operated service is in the path (Tailscale is the owner's own account), and outbound connections are user-serving and opt-in. Tailscale identifies the user, so it stays opt-in, off by default. No conflict.
- The coordination metadata leaves the house. That is the cost, and the setting says so in plain words. Headscale removes it, at a real effort cost, so it is offered as "Use your own Headscale server" text, not as a Home feature: Home reads the Tailscale app's status, and Headscale uses the same app (that detection works with Headscale is UNVERIFIED).
- Home never installs Tailscale or signs anyone in. Installing it adds a network extension and changes system networking, which is the admin's own act on their own machine. This is also the existing design (`tailscale.ts`).
- **Funnel is never turned on by Home**, and if Home sees that the hub's port is exposed through Funnel, it raises a red Repairs item (see open question 6).

### Where it sits in the flow

- **Not a screen, never required.** Away access is not needed for the first answer, it needs a third-party account and sign-in (minutes, possibly on a phone), and it sends device details out of the house. Asking for that during first setup would break the budget and push a privacy choice on someone who has not used Home yet.
- **Checks, row 13:** info only, grey.
- **You're all set, one line:** "Want Home on your phone when you're out? Set up Tailscale (recommended)." The button opens the Network and access page's away section. Recommended, not required: see "Secure connections for every device".
- **The checklist item "Reach Home when you're away"** opens the same section.

**Detection:** `tailscale status --json`: not installed, stopped (installed but signed out or off) or running, with the MagicDNS name and whether Funnel serves the hub's port (`tailscale funnel status`; the exact command output is UNVERIFIED).

### When the engine computer is reached over Tailscale

This happens only when the hub travels, or when the admin entered a tailnet address for the engine computer. Checks adds these rows to row 10:

- **The address is on the Tailscale network but `allow_tailnet` is off.** Amber, with one action: "This computer reaches Home's AI through your Tailscale network. Allow that?" and a Button "Allow" that sets `engines.stack.remote.allow_tailnet` (its privacy row shows from then on). No other path turns it on.
- **Tailscale on both computers:** the hub's `tailscale status --json` must list the engine computer as a peer that is online. If not: "The computer that runs Home's AI isn't on your Tailscale network right now. Open Tailscale on it and sign in with the same account, then press Try again."
- **Direct or relayed:** if the peer is reached only through a relay, the row is amber: "Home reaches its AI through a Tailscale relay, so answers may be slower. This usually fixes itself; if it doesn't, see Tailscale's help on direct connections." (The status field that shows relay versus direct is UNVERIFIED.)
- **Latency:** the engine link's own probe decides: `ready` passes, `degraded` (median over 500 ms) is amber with "Answers may be slow because the connection to the computer running Home's AI is slow."

### Failure states

| State | Copy |
|---|---|
| Not installed | "Tailscale isn't on this computer. To reach Home away from home, install Tailscale from tailscale.com/download on this computer and on your phone, sign in with the same account, then press Check again." |
| Stopped or signed out | "Tailscale is installed but not connected. Open Tailscale on this computer and sign in, then press Check again." |
| Running, away access off | "Tailscale is connected. Turn on 'Reach Home away from home' to let your devices on Tailscale open Home." |
| Funnel exposes Home | Red Repairs item: "Home can be reached by anyone on the internet through Tailscale Funnel. Turn it off by running `tailscale funnel off` on this computer, then press Check again." (exact command UNVERIFIED) |
| Peer offline (engine computer) | as above |

### Settings counterpart: Network and access, "Away from home" (admins only)

| Part | Source | Kit part |
|---|---|---|
| Status: not installed, stopped, connected; MagicDNS name and tailnet address | `getTailscaleStatus()` | `ui/status`, `List` |
| Reach Home away from home: on or off (Home answers on its tailnet address, or not) | new key `network.tailnet_access` (household, admin, default off, `needs_restart` if it changes what Home listens on: UNVERIFIED) | generic renderer (`Switch`) |
| Connect or disconnect | Home does not control Tailscale. The section says "Open Tailscale to sign in or out" and shows Check again. | `Button` |
| Who can reach it | text: "Everyone on your Tailscale network can open Home's sign-in page. They still need their own PIN. Children's devices on your Tailscale network follow the same rules as at home." | text |
| Tailnet only vs Funnel warning | the Funnel check | `Alert` (KIT-ALERT-01) |
| The engine computer from away | `engines.stack.remote.allow_tailnet` (exists; drawn on the Engines page, linked from here) | link |
| What leaves the house | the privacy page row: "Tailscale: your devices' names, keys and addresses, and the account you sign in with, go to Tailscale so your devices can find each other. What you say and see in Home does not." | text |
| Headscale | text: "Prefer to run your own? Tailscale's app also works with Headscale, a server you run yourself." | text |

**No list of who signed in from away on this admin page** (RULES.md rule 6a: an admin page never shows a person's activity). Each person sees only their own devices that signed in from away, in their own Account (ACCOUNT-AWAY-DEVICES-01).

## Secure connections for every device

**Why it matters.** Talking to Home and showing it your face need the browser's camera and microphone. Browsers allow those only in a secure context: "can only be used in secure contexts; in insecure contexts, navigator.mediaDevices is undefined" (MDN, `MediaDevices.getUserMedia()`, read 2026-10-13). A secure context is an HTTPS page, or a page on the same machine: `localhost`, 127.0.0.0/8 and `::1` are "potentially trustworthy", while a private network address over plain http is not (W3C Secure Contexts, section 3.1, read 2026-10-13). So:

- **The hub's own browser needs nothing.** Setup runs on `http://localhost:<port>`, which is already secure. Face on screen 5 works there.
- **Every other device needs HTTPS** to use voice or face: a phone, a tablet, a laptop in another room.

**How Home serves HTTPS today** (read 2026-10-13):

- `backend/src/lib/householdCa.ts` makes a household certificate authority and a leaf certificate for `maipai.local` and the hub's network addresses (`currentAltNames()`), all on the hub. Nothing leaves the house.
- The leaf is made only when someone calls `GET /api/setup/ca`, which also serves the authority file, a QR code for the hub's network address and install hints for macOS, Windows, iOS and Android (`backend/src/routes/setup.ts`).
- `backend/src/index.ts` turns TLS on at boot only if a leaf already exists ("TLS only when a leaf certificate already exists"), and rebinds the listener in place when a leaf is renewed.
- The phone or tablet installs the authority once and trusts it. On iPhone and iPad that is one extra switch: Settings, General, About, Certificate Trust Settings (Apple support article 102390, read 2026-10-13).

**Two gaps this note found** (from reading the code, not exercised; SETUP-HTTPS-01 proves each with a test):

1. **A new household never gets the leaf** unless someone opens the old "Trust this hub" step, which this flow removes. So You're all set mints it, and the hub then rebinds to TLS without a restart (the same rebind the renewal uses; today the first leaf takes effect only on the next restart).
2. **The leaf does not name `localhost`, and the hub has one port.** Once TLS is on, `http://localhost:<port>` would stop answering and `https://localhost:<port>` would show a name warning (UNVERIFIED, inferred from `currentAltNames()` and the single `Bun.serve`). Setup, Repairs on the hub and the `ssh -L` path all use localhost. The fix is either `localhost`, `127.0.0.1` and `::1` in the leaf, or a second plain-http listener bound to loopback only. Recommended: the loopback listener, because the hub's own browser then never needs the authority installed, and loopback http is already a secure context.

**The options, best on merit first:**

| Option | Works for | What leaves the house | Family effort | Rule cost |
|---|---|---|---|---|
| Household certificate (exists) | every device on the home network, by `maipai.local` or address | nothing | scan a QR, install, tap Allow once per device (one extra switch on iPhone) | none |
| Tailscale serve with a Tailscale certificate | only devices on the household's Tailscale network, by its `*.ts.net` name | the machine names and the network name, in public Certificate Transparency logs: "Do not enable the HTTPS feature if any of your machine names contain sensitive information" (Tailscale kb/1153, read 2026-10-13); plus the coordination details in "Away from home" | every device installs Tailscale and signs in to the household's account; the admin turns on MagicDNS and HTTPS in Tailscale's admin console (kb/1153); `tailscale serve <port>` proxies to `http://127.0.0.1:<port>` (kb/1312, read 2026-10-13) | opt-in only (PRIVACY.md: an identified outbound service); a child's tablet would need an account sign-in |
| A real certificate for a name MaiPai runs (the way some media servers do it) | every device, no install step | each hub's address to a MaiPai-run naming service | none | **breaks zero phone-home** (PRIVACY.md: no MaiPai-operated service in a user data path). Named here because it is the smoothest; not proposed |
| Caddy or another local proxy with its own internal authority | the same as the household certificate | nothing | the same, plus one more service to run | none, but it duplicates `householdCa.ts` (principle 1) |
| Plain http on the network address | text chat only; no voice, no face on other devices | nothing | none | none, but half the product is missing on phones |

**Should Tailscale be required?** Recommended: **no. Make it the strongly recommended way to reach Home from away, with the household certificate as the no-account default for HTTPS at home.** The reasons:

- Its certificate only covers the `*.ts.net` name, which only answers on the Tailscale network. Required HTTPS through it means every family device, including a child's tablet, the TV and the robot, must install Tailscale and sign in to the household's Tailscale account. The household certificate needs no account and works for all of them.
- It publishes the machine names and the network name in public logs, and it sends device details to a third party. PRIVACY.md keeps that kind of connection opt-in.
- It needs work outside the browser (an app install, a sign-in, two switches in Tailscale's console) that the wizard cannot do or check step by step.
- Requests through `tailscale serve` arrive from loopback, so the setup guard must refuse them by their `Host` (see "Setup works only on the hub itself", check 5).

**Effect on perceived length and the dad test:** zero added screens and zero required clicks on the default path. HTTPS at home is "scan this code, tap Allow" per device, which passes the dad test. Tailscale, when chosen, is about 5 to 10 minutes outside the browser (an estimate, UNVERIFIED), done later from one recommended line on You're all set and the checklist.


## Handing off to people and profiles

**There is no single new-person wizard in Home today** (research for this note, 2026-10-13). A new person is made in three places:

- the create form in `frontend/src/apps/settings/UsersSection.tsx` (`POST /api/people`)
- the profile fields in `frontend/src/apps/people/ProfileForm.tsx` (`PATCH /api/people/:id`)
- face enrolment in `FaceEnrollmentPage.tsx` and `FaceEnrollmentBody.tsx`

Voice prints (SPEAK-01) and avatars do not exist yet.

The "Meet your Home" phase reuses those pieces in this order, without redesigning any of them:

1. **Name and secret:** the owner variant of creation (`POST /api/auth/setup`), with the same fields as the create form.
2. **Face:** `FaceEnrollmentBody`, with its gate (`faceEnrollmentGate.ts`: the owner may enrol their own face).
3. **Hello:** the chat Elements.
4. **Not asked:** accent colour and bio from `ProfileForm`. They stay on the profile page.

**Additions for the owner's setup only:** the backup key and certificate rows on screen 7, and the checklist. A second person added later goes through People as today. When a single new-person flow is built, screens 4 and 5 should become its owner variant, so there is one flow, not two.

## The "Finish setting up" checklist

The checklist sits at the top of Home settings, General, while anything is left. The home screen also shows one quiet line to the owner and admins only: "3 things left to finish setting up". Each item is done when the fact behind it is true, not when someone ticks a box, so it can never drift.

| Item | Done when | Opens |
|---|---|---|
| Set up face sign-in | the admin has a face print | profile, face |
| Add your family | more than one person exists | People |
| Choose where backups go | a backup target other than the local default exists | Storage and backups |
| Add a phone or tablet | a second device has signed in (device tokens) | the QR invite with the certificate |
| Reach Home when you're away | `network.tailnet_access` is on and Tailscale is connected, or the item is dismissed | Network and access, Away from home |
| Fix web search (only while row 12 was amber) | the SearXNG checker passes, or the admin chose offline only | Web search |
| Add apps | any package beyond the default set is installed, or dismissed | Store |
| Add the offline library | a KS-REF-WIZARD-01 set is installed, or dismissed | Home settings, Reference library |
| Save your backup key (only if not saved on You're all set) | the key file was downloaded or printed | Storage and backups, backup key |

Each item has "Not now", which hides it for that person only. There is never a badge count on the rail and never a notification.

## Settings counterpart (Home settings, admins only)

Everything the wizard sets can be changed here, through the generic settings renderer and the existing areas in `commons/spec/settings/areas.json`. No setting is declared twice: the wizard writes the same keys.

| Wizard choice | Home settings place (SETTINGS.md rule 2 name) | Key, and where it is declared | Level |
|---|---|---|---|
| Plan and models per role | AI (area `ai`), one card per role | `engines.<role>.choice`: new, declared in `commons/spec/settings/keys.json` by SETUP-SIZE-01, `lives_in: household.ai` | basic |
| Which computer runs the AI | AI | `engines.stack.where`, `engines.stack.remote.*` (existing) | as declared |
| Voice on or off | AI, the stt and tts cards | the same per-role choice (off) | basic |
| Photos on or off | AI, the vision card | the same per-role choice; the tier label says when it is not available | basic |
| Where files are kept | Storage and backups (area `storage`) | DATA-LOCATION-01's per-class keys (existing plan) | basic |
| Offline library | Reference library | KS-REF-WIZARD-01's keys | basic |
| Who can reach Home | Network and access | new `network.lan_exposure` (`loopback` or `lan`), `needs_restart`, declared in keys.json; plus a new area `network` in areas.json | advanced |
| Hub port | Network and access | new `network.hub_port`, `needs_restart`, with a confirm that names the new address | expert |
| Web search provider, own SearXNG, engines, test query | Web search (SEARXNG-SET-05's page) | `search.web_sources`, `search.source_mode`, `search.searxng_url` (existing); `stack.search.*` (SEARXNG-SET-02) | advanced for the URL, basic for the rest |
| Away from home | Network and access, Away from home | new `network.tailnet_access`; existing `engines.stack.remote.allow_tailnet`, `robot.offlan.tailnet` | advanced |
| Who is owner, who is admin; handing over the owner role | People, each person's profile (owner only) | `role` on the person record (existing); the change goes through `personLifecycle.ts`, with the last-owner guard | basic |
| Hub name, language | General (area `general`) | `household.family_name`, `household.locale` (existing) | basic |
| Check my computers again | Repairs (area `maintenance`) | an action, not a key: re-runs the Checks list and writes the results to Health | n/a |
| Repair or reinstall the engine | Repairs | the existing `POST /api/engines/{name}/{action}` (install) and the Repairs fixes | n/a |
| Run setup again | Repairs | an action that opens review mode (below) | advanced |
| What Home can do | System | the hero slides, read only | basic |

Stack-side keys (`stack.*`, with `needs_restart`, `in_effect` and `pending`) are drawn on the Engines page exactly as SETTINGS.md describes. The wizard never writes them directly.

**Running setup again, safely.** Review mode is an ordinary signed-in admin page and shows Checks and Your plan only. It never:

- creates a new owner
- makes a new backup key without its own confirm (a new key replaces the old one, so the old printout stops working; the confirm says so)
- deletes a model until its replacement is checked and swapped in by the Stack

**Teens and children:**

- Home settings is for admins only (SETTINGS.md rule 2). A teen or child never sees the checklist, the install strip, the Network and access area, or a hero slide whose `audience` is not `all`.
- The setup flow never creates a child or teen profile. That happens in People, with its age bands.
- Enrolling someone else's face keeps its gate: a child cannot enrol themselves, and a teen only themselves (`faceEnrollmentGate.ts`).
- Per the 2026-09-30 ruling, an admin can reach a child's settings, never a teen's.

## Data

Every record carries an id, provenance and a clock stamp (org principle 3). **The spec change comes first**, in commons, then Home, then the robot.

**Spec changes (commons):**

1. **`setup-state.schema.json` (new).** One record per hub, household scope. Fields:
   - `id`
   - `source` (provenance): `wizard` or `restore`
   - `steps`: an array of `{ id, status, at, error? }`, where `status` is `pending`, `running`, `done`, `skipped`, `deferred` or `failed`, and `error` is a health item
   - `phase`: `check`, `install`, `meet` or `done`
   - `engine`: `{ where, hardware }`, the facts the Stack reported
   - `plan`: `{ option, tier, roles }`, holding references to the per-role Setting records, never a copy
   - `checks`: health items
   - `started_at`, `completed_at`, `hlc`
2. **`hero-slide.schema.json` (new),** as in the carousel section, including `copy_ref`.
3. **New settings keys in `keys.json`:**
   - `engines.<role>.choice` (owned by SETUP-SIZE-01)
   - `network.lan_exposure`
   - `network.hub_port`
   - `network.tailnet_access` (household, admin, default off)
   - the `network` area in `areas.json`
   - The help text of `search.searxng_url` changes once STACK-SEARCH-01 lands; until then it promises a service that does not exist.
4. **No new person field.** The adult acknowledgment is the existing grant with `acknowledged_at`. Checklist dismissals are a person-scope Setting value, `setup.checklist.dismissed` (a list of item ids).
5. **Stack (its own repo):** the `level` field on `ProfileTier`, and thresholds aligned with the levels (STACK-LEVELS-01).

**Routes.** The wave-2 contract finally lands, with the new step ids and the localhost rule:

- `GET /api/setup/state`: `{ done }` for anyone; the full record for localhost before an owner exists and for a signed-in owner or admin after.
- `POST /api/setup/:step` for `welcome`, `checks`, `plan`, `owner`, `face`, `hello` and `done`. Each is safe to repeat on its step id.

The session-storage resume (`maipai:setup-wizard-step` and friends) is deleted.

## Resume, re-runs and edge cases

- **Resume.** The state lives on the hub. A refresh, another browser on the hub, or a reboot lands on the first unfinished step. Downloads resume from their `.part` files on the engine computer. A file that fails its checksum is fetched again once, then raised as a Repairs item.
- **Unattended plan.** `install.sh --plan recommended|moderate|minimal` (or `MAIPAI_PLAN=...`) records the plan. It is applied once checks pass, so only the owner's name and PIN remain for the browser. Downloads still wait for the checks.
- **Re-running after a failure.** A failed step keeps its error (a health item with the fix) and shows "Try again", which re-runs that step only. Re-running the installer upgrades in place, keeps the data, and leaves a finished setup finished (`install.sh` is already idempotent).
- **Repeating a step is safe.** Account creation answers "already set up" when an owner exists. A download request for a model already queued attaches to the running job, keyed by model id and checksum.
- **Another device during setup** gets the "Finish setting up on the computer running MaiPai Home" page.
- **The robot or a second hub** asking `hello` before setup is done gets `setup_incomplete`, and shows "Your Home is still setting up. Try again in a few minutes." After setup is done, pairing is the normal flow.
- **Restore** replaces steps 3 to 5 with BACKUPS.md's sequence: verify, unpack beside the live data, migrate, swap, health check. The Stack then reinstalls what the restored pins name, under the same install strip. Restore also works only on localhost. Signing in uses the restored owner's PIN.

## Research and standard parts

The research findings are in the Perceived length section. This table says which standard part each piece uses.

| Piece | Standard part | Deviation and reason |
|---|---|---|
| Phase strip, Back, Continue, Skip | kit `Wizard` primitive (exists) | Used with three phases instead of ten steps. The part itself does not change. |
| Every page frame | kit `Page` primitive and `Card` | none |
| Check rows | kit `List` primitive, `ui/status` pill, `AsyncState` | none |
| Warnings and errors | **kit `Alert` (missing today; there is no `alert.tsx` in `commons/ui/src/ui/`)** | Added from the shadcn registry by KIT-ALERT-01, whose first step is the UI-DECISIONS row (rule 9b). Until then, nothing is hand-built in its place. |
| Plan choice | kit `ToggleGroup` | none |
| Custom details | kit `Collapsible`, SETUP-SIZE-01's role cards, `Switch`, `Select` | none |
| Name and PIN | kit `Input`, `Label`, `Button` | The hand-built `StepFields` div and `ErrorText` paragraph in today's wizard are removed (rule 9b). |
| Download progress | kit `Progress` primitive | none |
| File details | kit `Sheet` | none |
| Hero carousel | **new kit part:** shadcn Carousel (https://ui.shadcn.com/docs/components/carousel), on Embla with `embla-carousel-autoplay` | The kit has no carousel. KIT-CAROUSEL-01 adds it, after its UI-DECISIONS row. |
| Hello | assistant-ui chat Elements from the kit | none |
| Face | `FaceEnrollmentBody` (exists) | none |
| Not-on-this-computer page | kit `Page` and `Card` | none |
| Checklist | kit `List` primitive and `Button` | none |
| Settings pages | kit `SettingsShell` and the generic renderer | none |

**Precondition for KIT-ALERT-01 and KIT-CAROUSEL-01.** Rule 9b sends every kit addition through `docs/design/UI-DECISIONS.md`, and that file does not exist in Home yet; `docs/design/` holds only `RULES.md`, `ELEMENTS-DECISIONS.md` and `home-pages-2026-09-20.md`. Its first commit creates the file with two rows, one for `carousel` and one for `alert`. Each row says what is added, from which registry, who decided it, and why no existing kit part does the job. Neither kit row may be dispatched before that commit lands.

## What the old wizard did right and wrong

These verdicts come from the archived repo (`loki-doki`, read only):

- `frontend/src/pages/SetupWizard.tsx`: 2,038 lines, with the steps welcome, profile, pin, consent, area, components, download
- `components/onboarding/GuidedTour.tsx`
- `components/shared/BackgroundSetupWidget.tsx`
- commits 24402f86, 93db7536, 136c43ee, 388a12c2, 896cf43c, e1b8e705 and ae3e6524

Each idea is judged under org principle 8: logic may be ported, UI code never is.

| Idea | Verdict | Why |
|---|---|---|
| Seven numbered steps in a vertical rail with sub-labels | Drop | This is the perceived-length problem itself. Three phases replace it. |
| Two-pane shell with a brand panel and value props beside every step | Rebuild on standard parts | The value props live on in Welcome and the hero slides. A permanent side panel does not fit a phone. |
| "What you get" feature showcase before anything happens | Rebuild on standard parts | It moves into the hero carousel, shown only during waiting (NN/g). |
| Owner account and PIN created atomically (24402f86) | Keep | Hard-won: a half-made first account locked people out. `POST /api/auth/setup` already does this. |
| Admin PIN as its own step | Drop | The PIN is merged with the name on one screen. |
| Consent step with toggles (uncensored, internet, companions, liability) blocking Continue | Drop | Unrestricted mode becomes a per-adult acknowledgment later (SAFETY.md). Internet use is listed on the privacy page. Liability becomes the disclaimer on Welcome. |
| Location and units step | Drop | Inferred from the browser and editable in General. |
| Tier selector, model sets, per-role rows with details and alternatives | Rebuild on standard parts | Becomes Custom, which is SETUP-SIZE-01's page. The three levels come from the Stack, not a Home table. |
| Coding model shown in the wizard (896cf43c) | Drop from first run | Custom only. It is not needed for a first answer. |
| Base applications list with sizes | Drop | Apps are catalog packages added later. The offline library is a checklist item and a Custom card. |
| Blocking first run until every selected download finishes (93db7536) | Drop the blocking, keep the durable queue | The starter model gives a first answer in minutes. The queue, crash resume, and re-showing the wizard after a crash are kept as the setup state. |
| Parallel download lanes per host, aria2 segmented downloads, `.part` resume, stall detection, size and SHA-256 checks (136c43ee) | Keep the checks; measure the speed-ups | The Stack's `download.ts` already does `.part` resume, a stall timeout and SHA-256 with one retry. Parallel lanes and segmenting become a bench, not an assumption. |
| NVIDIA system-memory fallback guard (388a12c2) | Keep (port the check) | Becomes amber check 5. |
| OS-wipe restore flow (e1b8e705) | Keep | Becomes "Restore from a backup" on screen 2. |
| Wake words seeded on fresh installs (ae3e6524) | Keep | Already true: wakeword is `installedOnly` and is among the downloads every plan needs. |
| Starter home layout generated from installed apps (5aed9216) | Keep the idea, out of scope here | Belongs to the home screen design. |
| Background setup widget, minimisable, with per-job cancel | Rebuild on standard parts | Becomes the install strip and its Details sheet. Per-file cancel is dropped. |
| Hand-built inputs (`inputCls`) and custom toggles | Drop | Rule 9b. |
| No going back from the download step | Keep | Same rule here: after Install, no Back to Checks or Plan. |
| Four-card tour, once per person, every dismissal marks it done, replay from settings (b0559f35) | Keep the logic | Carried into the guided-tour note. |

**How this shaped the design:** four screens left the page list (consent, area, PIN, components), check 5 exists, restore moved to screen 2, and "wait for everything" was reversed in favour of the starter model.

## Open questions for Jesse

1. **Answered: owner and admin stay as they are** (your ruling, 2026-10-13). One thing in it needs your yes: GRANT-AUTHORITY-01 closes the gap that lets an admin grant themselves a full restore. Recommended: yes, since it is what your ruling already says.
2. **How memory counts on a PC (hardware).** For a PC with graphics cards, the levels count the cards' memory added together (two 8 GB cards make 16 GB, so Minimal), with system memory as a separate minimum. Is that what you meant, or should system memory count toward the total too? Recommended: graphics memory only. Models run in graphics memory; using system memory is the slow path the NVIDIA check warns about.
3. **The backup key may be shown again (an org-doc wording call).** BACKUPS.md says the emergency kit is "shown once". The route already says re-viewing an unchanged key is safe (`backend/src/routes/backups.ts`, emergency-kit route), and your answer puts the key on You're all set and in Storage and backups. Recommended: amend BACKUPS.md to "shown at setup with a print step, and again on request to an admin", since only a new key, not a re-view, is the risky act.
4. **Disclaimer and proposed copy (taste and legal).** Please read the Welcome disclaimer word for word. The promise lines and slides `hero.privacy`, `hero.try`, `hero.kids` and `hero.offline` are proposed too. Recommended: accept them, and add the ones you like to COPY.md, so the slides can point to them by key.
5. **Tailscale: strongly recommended, not required (privacy; your direction was "required").** See "Secure connections for every device". Required would mean every family device, a child's tablet included, signs in to the household's Tailscale account, and the machine names go into public certificate logs. Recommended: HTTPS at home comes from the household certificate with no account (scan a code, tap Allow), and Tailscale is the recommended away-from-home choice: one line on You're all set and a checklist item. Home never installs it or signs anyone in.
6. **Tailscale Funnel (safety).** If the hub's port is reachable from the public internet through Funnel, should Home only warn (a red Repairs item), or also refuse sign-in on requests that arrive that way? Recommended: warn now, and refuse once a test proves Home can tell Funnel requests apart (how is UNVERIFIED). Home itself never turns Funnel on.
7. **Web search with no Stack search yet (a build-order call).** Today a new household has no web search at all, because STACK-SEARCH-01 is not built and `search.searxng_url` is empty. Should SETUP-FLOW-01 wait for STACK-SEARCH-01, or ship first with row 12 amber and "offline library only" until then? Recommended: ship first; the degrade path already answers without web search, and row 12 tells the admin.

## Supersedes

- **The step list and session-storage resume** in `frontend/src/apps/setup/SetupWizard.tsx`, and the wave-2 step ids in `docs/plans/wave-2.md` (lines 223 to 226). The route names stay; the step ids change as listed in Data.
- **The step list in the backlog row "The first-run wizard, end to end"** (`docs/BACKLOG.md`, around line 8613). Locale, the household name, the adult acknowledgment, trust, packages, Tailscale and the backup target all move out of the first run, as described above.
- **SETUP-LOOK-01** (`docs/BACKLOG.md`, around line 8611), in part. That row builds the wizard from the template's `auth2` and `authforms` views, with plan 12's steps one per screen and a progress rail on the left. This note keeps its look goal and its acceptance (captures at 1440 and 390 judged beside the sign-in page, restore as the second screen, real routes only). It replaces the step list and the left rail with the kit `Wizard`'s three phases. The page frame may still use the `auth2` card layout around the `Wizard`, if that layout composes the same kit `Card`; the architect rules on that when SETUP-FLOW-01 is dispatched. SETUP-LOOK-01 should be amended to point here rather than closed.
- **KS-REF-WIZARD-01's "Offline library" first-run wizard step** (`docs/BACKLOG.md`, around line 9605). It is not a first-run screen. It lands in two places: as a card in "Choose for myself" (Custom) on screen 3, and as the checklist item "Add the offline library". The settings page that row describes (Home settings, Reference library) is unchanged.
- **Today's "Remote access" wizard step** ("This isn't built yet - skip it for now"). Away access is one recommended line on You're all set, the checklist item and the Network and access section.
- **Today's "Trust this hub" step and the separate emergency-kit screen** (your answer, 2026-10-13). The certificate is made on You're all set; the backup key is a row there and in Storage and backups; each person's own recovery stays in their own setup.
- **ROLE-LABEL-01 ("Main admin") and ROLE-ADMIN-01 (one word "Admin")** from earlier revisions of this note. Both dropped by your ruling: owner and admin stay as the code has them.
- **THIN-4G and SEARXNG-SET-05 are reused, not replaced.** THIN-4G's one setting and save-time check is the "Use my own SearXNG" option; SEARXNG-SET-05 is the Web search settings page, with the parts listed under "Settings counterpart: Web search".
- **The earlier draft of this note:** its "8 GB red line" and floor plan, its install-time early download, its offer-or-code question for other devices, and its "owner" copy.
- Nothing else. SETUP-SIZE-01, SETUP-START-01, STACK-START-01, INSTALL-PREFLIGHT-01, INSTALL-RESUME-01 and DATA-LOCATION-01c stand and are reused.

## Backlog rows to file

- **UI-DECISIONS-01: create `docs/design/UI-DECISIONS.md` with the `alert` and `carousel` rows** (S, docs). Who decided, why no kit part does it, which registry. This is the precondition of KIT-ALERT-01 and KIT-CAROUSEL-01, and the guided-tour note adds a `tour` row in the same commit.
- **KIT-ALERT-01: add the shadcn `alert` to commons ui** (S, after UI-DECISIONS-01).
- **KIT-CAROUSEL-01: add the shadcn Carousel (Embla, autoplay) to commons ui** (S, after UI-DECISIONS-01). Precondition: the UI-DECISIONS row is committed first. Includes the pause button, reduced motion, carousel ARIA, and new props only (never changing existing ones).
- **SPEC-SETUP-STATE-01: setup state and hero slide schemas, plus the network keys and area, in commons spec** (S, first).
- **STACK-LEVELS-01: the `level` field on Stack tiers, and graphics-memory thresholds aligned with Recommended, Moderate and Minimal** (S, Stack repo, after open question 2). Includes fixtures for a two-card 16 GB box, a single 8 GB card, an Intel Mac and a 24 GB Mac.
- **SETUP-LOCAL-ONLY-01: setup and owner-account routes answer only on loopback, never via forwarding headers; the "finish on the computer itself" page** (S, medium review: auth route). Tests for every case in the note.
- **SETUP-STATE-01: `GET /api/setup/state` and `POST /api/setup/:step` on the new step ids** (M, after SPEC-SETUP-STATE-01 and SETUP-LOCAL-ONLY-01). Server-side resume, repeatable steps, session storage removed.
- **SETUP-FLOW-01: the three-phase wizard on the kit Wizard** (M, after SETUP-STATE-01). Screens 1 to 7, stubs removed, hand-built fields replaced, the owner copy and the owner-and-admin card.
- **SETUP-CHECKS-01: the Checks screen on INSTALL-PREFLIGHT-01's list, judged on the engine computer** (M, after INSTALL-PREFLIGHT-01 and STACK-LEVELS-01). Thirteen rows, moves on by itself when green, starts the downloads every plan needs on pass, results go to Health.
- **SETUP-NVIDIA-01: port the CUDA system-memory fallback check** (S). Amber row with the fix; fixtures for on, off and no NVIDIA.
- **SETUP-PLAN-FLAG-01: `install.sh --plan` records a plan to apply after checks** (S).
- **SETUP-HELLO-01: the first-win greeting on the starter model, with the wait state** (S, after SETUP-START-01).
- **SETUP-CHECKLIST-01: "Finish setting up", from facts, in General and on the home screen for the owner and admins** (M).
- **SETUP-REVIEW-01: run setup again in review mode from Repairs** (S).
- **SETUP-NETWORK-01: the Network and access area with LAN exposure and the hub port** (M, after SPEC-SETUP-STATE-01).
- **HERO-01: hero slides as data with `copy_ref` to COPY.md, the carousel during install, and "What Home can do" in System** (M, after KIT-CAROUSEL-01 and SPEC-SETUP-STATE-01).
- **SETUP-TIME-01: measure the default path's attention time with five people on the seeded flow** (S). The measured seconds replace the estimates in this note.
- **INSTALL-DL-BENCH-01: measure parallel lanes and segmented downloads against the Stack's single stream** (S). Keep only what a three-run bench shows is faster.
- **PEOPLE-ADULT-SECRET-01: the Users page asks for a PIN for adults, as the backend requires** (S). The backend's `ROLE_REQUIRES_CREDENTIAL` (`backend/src/lib/personAuthMethods.ts`, enforced in `backend/src/routes/people.ts`) covers `owner`, `admin` and `adult`, but the frontend's `requiresSecret` (`frontend/src/apps/people/roles.ts`) covers only `owner` and `admin`, so creating an adult likely fails with a 400. Confirm the 400 in the UI first, then add a regression test on `requiresSecret`.
- **GRANT-AUTHORITY-01: a grant never gives more than the granter holds** (S, medium review: guard). `createGrant` (`backend/src/routes/grants.ts`) checks only that the caller is an admin or holds `people.grant`, so an admin can grant themselves `backups.restore`, which the owner ruling keeps for the owner (found by reading the code, not exercised). Regression test: that exact grant is refused.
- **SETUP-HTTPS-01: the household certificate on You're all set, and localhost keeps working** (S, medium review: TLS and the setup guard). Mint the leaf on the last screen and rebind to TLS without a restart; keep a plain-http listener on loopback only (or add the loopback names to the leaf); a fixture proves a loopback peer with a `*.ts.net` `Host` is refused by the setup guard. Regression tests: after the first mint, `http://localhost:<port>` still answers and the network address answers on HTTPS.
- **SETUP-BACKUP-KEY-01: the backup key row on You're all set and in Storage and backups** (S). Reuses `GET /api/backups/emergency-kit`; Download and Print; the checklist item when not saved. Waits on open question 3 for the BACKUPS.md wording.
- **SETUP-SEARCH-01: web search row 12, the plan line, loopback detection on 8888 and 8080, and the Custom card** (S, after SETUP-CHECKS-01; uses SEARXNG-SET-03's checker, never a second one). A found instance is only offered: the "Use it" click writes `search.searxng_url`, and without it Home's own stays the default (rule 11). Regression test: detection alone leaves the key empty. No network scan.
- **STACK-SEARCH-01 amendment (Stack repo): the homelab-proven defaults** (S, docs, before STACK-SEARCH-01 is dispatched). JSON format on, limiter with loopback pass, IPv4 preference without a global IPv6 route, the curated and `keep_only`-pinned engine set, warm-up query after start, no query logging proven by a log test, pinned updates with rollback, search forwarded on the Stack's own API so the engine link stays one port. The SearXNG Python packages are hash-locked, and the `/stack/v1/privacy` rows for every fetch host (the PyPI index and file host, the release host) land in the same commit.
- **SEARCH-HEALTH-BANNER-01: the search health state shows as a banner when web search is off or down** (S). A kit `Alert` or the existing banner, above the thread, never fixed wording inside the reply (rule 6); the reply stays the model's. Check SEARCH-HEALTH-02 and KS-MODE first; add only what is missing. Regression test: search down, the answer arrives model-worded and the banner shows.
- **SETUP-AWAY-01: Network and access, "Away from home"** (M, after SETUP-NETWORK-01). `network.tailnet_access`, status from `tailscale.ts`, the privacy row, the Headscale line, the line on You're all set, the checklist item. No list of other people's devices (rule 6a). Home never installs Tailscale.
- **ACCOUNT-AWAY-DEVICES-01: each person sees their own devices that signed in from away, in their own Account** (S, after SETUP-AWAY-01). Never on an admin page.
- **SETUP-FUNNEL-01: a red Repairs item when Funnel exposes the hub's port** (S, waits on open question 6; medium review: exposure).
- **SETUP-ENGINE-TAILNET-01: the Tailscale rows of check 10** (S, after SETUP-CHECKS-01). The `allow_tailnet` prompt, peer online, relay versus direct, the link's own 500 ms degraded threshold. Fixtures from synthetic `tailscale status --json` output.
