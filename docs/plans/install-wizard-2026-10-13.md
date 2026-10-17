# The install wizard and its settings page (2026-10-13)

For Jesse. This is a draft design note, revision 5. It applies:

- your answers from 2026-10-13: recovery, children's tours, and your ruling on owner and admin (both roles stay as they are in the code; the person setting Home up creates the owner account)
- your ruling of 2026-10-13 on Tailscale and the opening order: Tailscale is a setup step of its own, with the downloads running behind it, and the first questions are where Home's AI runs and where its files live; nothing downloads until both are answered
- your addition of 2026-10-13: a preview mode that walks every screen, including errors, with no effect on the machine (see "Preview mode")
- the architect's second verdict (`INSTALL-WIZARD-01`, REJECTED on rules 11, 6 and 6a), with its three fixes and three advisories

The note covers what a new household sees between the installer's last line ("Open that address in a browser to finish setup") and their first real answer from Home. It also says where each of those choices can be changed later in Home settings. The changes from today:

- Three short phases replace the ten numbered steps in `frontend/src/apps/setup/SetupWizard.tsx`.
- The person first says where Home's AI runs (this computer or another one) and where its files live. Only then is the engine computer checked, and downloads start in the background the moment it passes.
- The person's time goes to Tailscale (so the family can reach Home away from home), the owner account and face set-up while the files download.
- Everything not needed for the first answer moves to a "Finish setting up" checklist.

The flow reuses parts Home already has:

- the kit's `Wizard` primitive (`commons/ui/src/primitives/Wizard.tsx`)
- `POST /api/setup/hardware` and `GET /api/setup/ca` (`backend/src/routes/setup.ts`)
- account creation through `POST /api/auth/setup` (`backend/src/routes/auth.ts`)
- the Stack's profile tiers (`stack/backend/src/profiles.ts`)
- the Stack's pinned and checksummed downloads (`stack/backend/src/lib/download.ts`)
- the face enrolment body (`frontend/src/apps/people/FaceEnrollmentBody.tsx`)
- the backup key file (`backend/src/lib/emergencyKit.ts`)
- the engine link pairing (`/api/engine-link`, REMOTE-STACK-LINK-01) and DATA-LOCATION-01c's storage choice
- Tailscale status (`backend/src/lib/tailscale.ts`)

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

**What the setup person is told** (on screen 7, below): one short card in plain words, so they know what they are becoming and what an admin will be later.

**Where roles are changed later:** People, on each person's profile (the existing role menu, owner only). Handing the owner role to someone else is the existing path: the owner makes another person owner, then may step down; the last-owner guard stops a household from ending up with none.

## The promise, in one paragraph

Before anything downloads, the person answers two questions with pre-filled answers: where Home's AI runs, and where its files live. Their "Set up my Home" click is the choice to install; the downloads start in the background once the engine computer is known, has a place for its files, and passes its checks. The person then spends the waiting time on things only they can do. First comes Tailscale, so their phone and the family's tablets reach Home from anywhere; it is the natural pause, because it happens in other apps while the files arrive. Then come their owner account and their face. Home answers them on a small starter model as soon as that model has arrived, without waiting for the full model. Anything optional says "Do this later" and goes to a checklist in Home settings. They see three phases, never a count of eleven screens.

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

Your decision 4 is to download in the background once the engine computer is reachable and checked, and to use that time for Tailscale, the account and face set-up. This is how large installs usually work when there is something for the person to do:

- **PlayStation 4 "PlayGo":** a game downloads "just a portion of the overall data", the player starts, and "the rest downloads in the background" (Mark Cerny, reported by GamesBeat, https://gamesbeat.com/how-playstation-4s-play-as-you-download-feature-works/, and PSU, https://www.psu.com/news/how-ps4s-playgo-lets-you-play-games-while-they-download-or-install/; 2013 coverage, read 2026-10-13).
- **Xbox "Ready to start" and FastStart:** a game can be launched once its essential files are in, while the rest installs (Windows Central, https://www.windowscentral.com/hands-incredible-xbox-fast-start, read 2026-10-13). One reviewer found some game modes locked until the install finished. That is the same trade-off as our starter model.
- **iPhone and iPad restore from iCloud:** the device finishes setup first, then apps and media download in the background with progress under each icon, and the person can tap one to move it up the queue (Apple support's restore guide, as summarised by https://www.simplified.guide/_export/xhtml/iphone-ipad/backup-icloud-restore; Apple's own page was not fetched: UNVERIFIED).
- **Plex:** library scanning continues after the wizard (cited above).
- **The counter-example:** Home Assistant OS shows "Preparing Home Assistant" on first boot and makes the person wait before onboarding begins (general knowledge, not fetched: UNVERIFIED). That is the pattern this design avoids.

**When the first reply has to wait.** The starter chat model is 1.83 GB. Tailscale is the long human task: installing the app on this computer, signing in, two switches in Tailscale's own console and, if they like, the app on their phone. That is estimated at 5 to 8 minutes (UNVERIFIED until SETUP-TIME-01 measures it).

| Line speed | Starter arrives in about | Tailscale, account and face take about | Result |
|---|---|---|---|
| 300 Mbit/s or faster | 50 seconds | 6 to 9 minutes | The whole Minimal plan (about 3 minutes) is usually in before the person reaches Hello. |
| 50 Mbit/s | 5 minutes | 6 to 9 minutes | The starter is in before Hello; the full model (about 19 minutes for Minimal) keeps going behind Hello and You're all set. |
| 50 Mbit/s, Tailscale set up later | 5 minutes | 75 seconds | The person waits about 3.75 minutes at Hello, as in revision 4. |

During any wait, the Hello screen shows the hero carousel and one honest line: "Home will say hello in about 4 minutes. You can close this page; it keeps going." "Continue" stays available. A person who leaves gets the greeting the next time they open Home.

### The budget

- **Four short screens before the install starts, one click each, all pre-filled.** Welcome, Where Home's AI runs, Where files are kept and Your plan. Checks sits between the third and fourth and needs no click when everything is green.
- **About two and a half minutes of attention in the browser on the default path,** plus the Tailscale minutes, which are spent in other apps while the files download.
- **Progress as time and outcome, never a long step count.** The kit `Wizard` strip shows three phases: Your computers, Away from home, Meet your Home. There is no numbering inside a phase. While files download, every screen says, for example, "About 6 minutes left. You can close this page; Home keeps going."
- **Nothing downloads until the browser is open and both questions are answered.**
  - Nothing downloads before the person has pressed "Set up my Home" on Welcome. That click is the person choosing the ability, which SERVICES.md requires before an on-demand download.
  - Nothing downloads before the person has said where the AI runs and where its files live, and before that engine computer has passed its checks on that disk. You ruled this order (2026-10-13), and it means no file ever lands on a disk or machine the person did not pick.
  - Then the files every plan needs start at once, and Your plan adds the rest.
- **The checks page passes itself.** When everything is green, it shows the green list for about 1.5 seconds and moves on. It stops only on amber or red.
- **Every answer is pre-filled.** "This computer" and the disk with the most room are pre-selected. Language, time zone and units come from the browser. The hub name defaults to "Home". The plan defaults to the best level the engine computer meets.
- **Human-time tasks come after the install starts.** Tailscale, the owner account and face come before Hello. They use the waiting time instead of adding to it.
- **Every optional step says "Do this later"** and adds an item to the "Finish setting up" checklist in Home settings. Tailscale's is marked more strongly: "Set up later (Home works only at home until then)".
- **Resume where they left off,** from the server's setup state, never from the browser's session storage.

### Every screen, with its cost

Seconds are the person's attention in the browser, estimated. They are UNVERIFIED until SETUP-TIME-01 measures five people on the seeded flow.

| # | Screen | Phase | Required or optional | Seconds | Clicks | Skip or default |
|---|---|---|---|---|---|---|
| 1 | Welcome | Your computers | Required | 15 | 1 | Nothing to answer. "Restore from a backup" is a secondary link. |
| 2 | Where Home's AI runs | Your computers | Required | 8 | 1 | "This computer" is pre-selected. "Another computer on my network" asks for its address and pairs (REMOTE-STACK-LINK-01). |
| 3 | Where files are kept | Your computers | Required | 8 | 1 | The disk with the most room on the engine computer is pre-selected, with free space shown. |
| 4 | Checks | Your computers | Required | 3 when green | 0 when green | Moves on by itself when green. Amber needs one click ("Continue anyway"). Red stops. **The downloads every plan needs start when it passes.** |
| 5 | Your plan | Your computers | Required | 15 | 1 | The best level for the engine computer is pre-selected. "Choose for myself" opens Custom. |
| 6 | Reach Home from anywhere (Tailscale) | Away from home | Offered, default path ("Set up later" leaves it off) | 30 in the browser, plus about 5 to 8 minutes in other apps | 2 (Turn on, Continue) | Ticks itself as Home sees each part done. "Set up later" leaves Home working at home only (see "If the person cannot or will not set up Tailscale"). |
| 7 | Create your owner account | Meet your Home | Required | 30 | 1 | The name has no default. The owner-or-admin card is read here. A PIN is required (`ROLE_REQUIRES_CREDENTIAL`). |
| 8 | Your face | Meet your Home | Optional | 0 (skipped) to 45 | 1 | "Do this later" adds it to the checklist. |
| 9 | The rest of your profile | Meet your Home | As the standard new-person flow says | that flow's own | that flow's own | The standard new-person steps that follow name and face (recovery and anything else it holds), as every person gets them; this wizard adds nothing. Until that flow exists, this screen is absent. |
| 10 | Hello | Meet your Home | Required, and it is the reward | 15 (plus any wait for the starter) | 1 | The person can type a question or press "Continue". |
| 11 | You're all set | Meet your Home | Required | 10 (25 if the backup key is saved now) | 1 (2 with the key) | "Open my Home". The backup key row (Download, Print) sits here; leaving it adds a checklist item. |
| (4) | Web search check | Your computers | A row on Checks, never a screen | 0 | 0 | Defaulted. Amber never stops the flow (see "Web search (SearXNG)"). |
| (5) | Web search line | Your computers | One line on Your plan, never a screen | 0 (3 if read) | 0 (1 to accept a SearXNG found on this computer) | Defaulted to "Home's own private search". A SearXNG found on this computer is offered with "Use it", never switched on by itself. |
| | **Default path total** | | | **about 2.5 minutes and 10 clicks in the browser with face skipped (about 3.25 minutes with face), plus about 5 to 8 minutes of Tailscale in other apps while the files download; without Tailscale, about 2 minutes and 9 clicks** | | |

**The cost of your two rulings, said plainly.** Revision 4's default path was 7 screens, about 90 seconds and 6 clicks. This one is 11 screens (10 until the new-person flow exists), about 2.5 minutes and 10 clicks in the browser, plus the Tailscale minutes. The extra browser time is small, because screens 2 and 3 are pre-filled single clicks. The real cost is screen 6: it sends the person to other apps, to a third-party sign-up and to Tailscale's own console, which is where a setup is most likely to be abandoned. Three things keep it from feeling long:

- the phase strip still shows three phases, and screen 6 is a whole phase of its own, so finishing it visibly moves the person two thirds of the way
- the downloads bar keeps moving on screen 6, so the time spent there is visibly not wasted
- the screen ticks itself as each part is done, so the person never has to come back and press "Check"

Before the install starts: screens 1 to 5, four clicks, about 50 seconds. The Install phase has no screen of its own. It is the strip at the top of screens 6 to 11, plus the hero carousel that fills any wait.

### Screens from today's wizard that do not belong in the first run

| Today's step (`SetupWizard.tsx`) | Verdict | Where it goes |
|---|---|---|
| Household | Not needed. The name is optional and defaults to "Home". | `household.family_name` in Home settings, General (the key exists, `lives_in: household.system`) |
| Before you start (the unrestricted acknowledgment) | Not needed on first run. SAFETY.md makes it per adult: one dialog when that adult first turns unrestricted mode on. | The unrestricted switch's own confirmation (the grant with `acknowledged_at`). The AI-outputs disclaimer is a different thing and stays on Welcome. |
| Hardware | Split into the two questions you ruled (where the AI runs, where files live), then Checks and Your plan. | Screens 2 to 5 |
| Trust this hub | Not needed as a screen. Tailscale's certificate is the HTTPS path; the household certificate is the fallback. | Screen 6 for Tailscale. The household certificate is made on You're all set, and Home settings, Network and access, "Devices without Tailscale" carries its QR (`GET /api/setup/ca`) |
| Packages | Not needed. The default set installs on its own. | Store, and the checklist item "Add apps" |
| Remote access | Rebuilt as a step of its own (your ruling, 2026-10-13). Today's step says "This isn't built yet". | Screen 6, then Home settings, Network and access |
| Backups | Not needed as a screen. A local nightly backup runs from first boot (BACKUPS.md). | The checklist item "Choose where backups go" |
| Emergency kit | Not a screen (your decision). The household backup key is the one Home-level secret a person must keep. | A row on You're all set (Download, Print), and Home settings, Storage and backups. Each person's own recovery stays in that person's own setup. |

## The flow

```
installer ends ──► open http://localhost:<port> on the hub
 Phase 1, Your computers
   [1 Welcome] ──► [2 Where Home's AI runs] ──► [3 Where files are kept]
       └ "Restore from a backup" ──► restore flow (BACKUPS.md)
   ──► [4 Checks: hub + engine computer, on the chosen disk] ──auto on green──► [5 Your plan] ──Install──►
           │ red: stop with the fix          (downloads every plan needs start the moment checks pass)

The Install phase runs in the background from here on. Its strip sits on top of every screen below.

 Phase 2, Away from home
   [6 Reach Home from anywhere (Tailscale)] ──► ("Set up later": Home works at home only)
 Phase 3, Meet your Home
   [7 Create your owner account] ──► [8 Your face]? ──► [9 The rest of your profile] ──► [10 Hello] ──► [11 You're all set] ──► Home
                                                                             ▲ hero carousel fills any wait for the starter
```

### Back, skip and leave rules

- **Back** works on every screen before Install. After Install, Back moves between screens 6 to 9 but never returns to screens 2 to 5. The plan, the engine computer and the disk are changed in Home settings, which is safe while downloads run.
- **Skip** appears only on optional screens, and it says what it does: "Do this later" adds the item to the checklist. Screen 6 says "Set up later" and states the consequence on the button's own line.
- **Leaving** is always safe. Closing the tab never cancels a download. Reopening the address resumes at the first unfinished screen, read from `GET /api/setup/state`. Leaving screen 6 half done is safe too: what Home already sees (app installed, signed in) is ticked when the person comes back.
- **The kit `Wizard`** takes the three phases as its `steps` (`computers`, `away`, `meet`), with `completedCount` from the setup state, so the strip never grows past three. Its own Back, Continue and Skip props are the buttons. There is no hand-built footer.

## Setup works only on the hub itself

You decided that the wizard and owner account creation work only from the hub's own loopback address (127.0.0.1 or ::1). There is no setup code. Before an owner exists, anyone who can reach the address could otherwise claim the hub, for example a guest on the Wi-Fi.

**This is separate from the engine computer.** The hub's setup is local only. The engine computer can still be another machine on the network, which the hub connects to, and the wizard sizes the plan on that machine (see Checks).

**How the server enforces it** (one middleware on every `/api/setup/*` route and on `POST /api/auth/setup`):

1. **The peer address of the socket must be a loopback address.** In Bun this is `server.requestIP(request)` (Hono's `getConnInfo` on the Bun adapter). The check never trusts a header: not `Host`, `X-Forwarded-For`, `Forwarded`, `X-Real-IP` or `CF-Connecting-IP`.
2. **A request that carries any forwarding header is not local, whatever its peer address.** A reverse proxy on the same machine connects from 127.0.0.1, so without this rule every request through it would look local. With it, a proxied request is refused, and nothing can be bypassed by adding or forging `X-Forwarded-For`. A proxy that strips those headers before forwarding would still look local. The install docs therefore say: finish setup before putting Home behind a proxy.
3. **The `Host` header must be `localhost`, `127.0.0.1` or `[::1]`, with any port.** This is an extra guard against DNS rebinding (a web page making the person's own browser call the hub under a different name). It is never the only check.
4. Tests cover a loopback peer, a LAN peer, a loopback peer with `X-Forwarded-For: 127.0.0.1`, a loopback peer with `Forwarded`, and a loopback peer with a foreign `Host`.
5. **Tailscale's address never counts as local.** Screen 6 turns on the Tailscale HTTPS address before the owner exists, so this matters during setup itself. When Home serves the `*.ts.net` name itself (the recommended way, see screen 6), the peer is a tailnet address and check 1 refuses it. **Tailscale serve also connects from loopback.** `tailscale serve` proxies a tailnet HTTPS name to `http://127.0.0.1:<port>` (Tailscale kb/1312), so its requests arrive from a loopback peer. Check 3 refuses them, because their `Host` is the `*.ts.net` name. Whether serve also adds `X-Forwarded-For` is not confirmed: UNVERIFIED. A test fixture with a loopback peer and a `*.ts.net` `Host` proves the refusal either way (SETUP-HTTPS-01).

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
- `POST /api/setup/:step` for the steps before the account (`welcome`, `engine_location`, `storage`, `checks`, `plan`, `away`) returns the same.
- The steps after the account (`face`, `profile`, `hello`, `done`) need the signed-in owner's session, as every other settings action does. In practice that is the same browser, still on localhost.
- `GET /api/setup/state` returns only `{ done }` to anyone who is not signed in.
- "Run setup again" in Repairs is an ordinary signed-in page for the owner and admins, not the setup routes. It works from any device, because by then sign-in protects it.

## The downloads every plan needs

Every plan includes these files, so starting them before the person chooses a plan wastes nothing. They start when Checks (screen 4) passes on the engine computer and the disk chosen on screen 3, never earlier. Byte counts come from `stack/backend/src/lib/modelCatalog.ts` (`approx_bytes`).

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

The starter is what SETUP-START-01 and STACK-START-01 already decided. The Stack serves the starter while the chosen model downloads, then swaps over through its drain and identity check. This note only sets when the starter download begins: when Checks passes, after both opening questions, not at the plan click.

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
> The computer running Home's AI has 12 GB of memory for AI. Home needs at least 16 GB. Use a computer with more memory (a Mac with 16 GB or more, or a PC with graphics cards that add up to 16 GB or more). Or run Home's AI on a bigger computer on your network: press "Use another computer".

"Use another computer" goes back to screen 2 with "Another computer on my network" selected. That is the engine-computer pairing (`/api/engine-link`, `engines.stack.where`), the same part as in Home settings, AI.

## Install options

Shown on screen 5. The best level the engine computer meets is pre-selected and labelled "(Best for this computer)". Levels it does not meet are not shown.

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

Custom opens in place on screen 5 when the person picks "Choose for myself". It is the same page SETUP-SIZE-01 builds for Home settings, AI (one card per role, SETTINGS.md rule 3), not a second copy:

- **Models:** for each role, the Stack's proposal, a smaller choice, "when needed" or off. Sizing comes from the Stack's fit plan (`POST /api/fit-plan`), worded by the fit-verdict module (`docs/plans/fit-verdict-ui-2026-09-30.md`).
- **Where files are kept** is no longer here. It is screen 3, asked of everyone before anything downloads (your ruling, 2026-10-13).
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
└ Wizard (phases: Your computers · Away from home · Meet your Home; current = Your computers)
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

**This click is the person's choice to install.** SERVICES.md lets a service download when the person chooses an ability. "Set up my Home" is that choice: the person has asked for Home's AI. Nothing downloads on this click, though. Two questions come first (where the AI runs, where its files live), then Checks, and the downloads every plan needs begin the moment Checks passes.

**Errors:** none can occur here. If the setup state cannot be read: "Home can't read its setup progress. Refresh this page. If it keeps happening, restart MaiPai Home on this computer or run the installer again."

### 2. Where Home's AI runs

**Purpose:** know which computer gets the AI models before anything is checked or downloaded. You ruled this is the first question (2026-10-13).

```
Wizard (current = Your computers)
└ Card
  ├ heading: "Where should Home's AI run?"
  ├ RadioGroup (kit):
  │   ● "This computer" (pre-selected)
  │       small: "Simplest. Home and its AI share this computer."
  │   ○ "Another computer on my network"
  │       small: "For a bigger computer elsewhere in the house, like a gaming PC or a Mac Studio."
  ├ (only for "Another computer") the engine-link pairing part from Home settings, AI, as shipped:
  │   address, the pairing code the installer printed on that computer, "Connect"
  └ Button (primary): "Continue"
```

- **One definition.** "Another computer" is the existing engine link (REMOTE-STACK-LINK-01, `/api/engine-link`, `engines.stack.where`). The wizard renders the same pairing part Home settings, AI renders; it never builds its own.
- **Pre-filled from the installer.** If the installer was run with a remote engine, "Another computer" is pre-selected with its address filled in and already paired, so this is still one click.
- **The other computer needs the Stack installed on it** (the installer's engine-only mode). The small text under the choice says so and links the install page. On the same home network it does not need Tailscale; on a different network it does, before this screen can connect (see "The engine computer and Tailscale").
- **Stored:** `engine_location` done, with `local` or `remote` and the link id. The setting itself is `engines.stack.where`, written by the pairing route, never a second copy in the setup state.

**Errors:** "Home can't reach a MaiPai engine at 192.0.2.20. Check that the computer is on, that the MaiPai installer finished on it, and that the address is right, then press Connect again." and "That pairing code doesn't match. Look at the last lines the installer printed on the other computer and type the code shown there."

### 3. Where files are kept

**Purpose:** pick the disk for the big files before any land. This is DATA-LOCATION-01c's per-class storage choice, moved out of Custom onto the default path by your ruling.

```
Wizard (current = Your computers)
└ Card
  ├ heading: "Where should Home keep its files?"
  ├ text: "AI models are big (7 to 10 GB). Pick a disk with room to spare."
  ├ RadioGroup (kit): one row per disk on the engine computer, with free space,
  │   the one with the most room pre-selected and marked "(Most room)"
  ├ Collapsible: "Keep photos and backups somewhere else" (models, media, backups,
  │   the DATA-LOCATION-01c classes; closed by default)
  └ Button (primary): "Continue"
```

- **One definition.** The rows and the per-class choice are DATA-LOCATION-01c's part, the same one Home settings, Storage and backups shows. Disk facts for a remote engine come from the Stack through the engine link.
- **Pre-filled.** The disk with the most free space, so a person who reads nothing still makes a safe choice with one click.
- **Stored:** `storage` done; the locations themselves are DATA-LOCATION-01's setting records.

**Errors:** "Home can't write to that disk. Pick another one, or check that it is plugged in and not read-only." A disk that is too small for even Minimal is shown greyed out with its free space, never hidden, so the person sees why.

### 4. Checks

**Purpose:** prove that the hub and the engine computer can run Home, on the disk just chosen, without asking anything new.

```
Wizard (current = Your computers)
└ Card
  ├ heading: "Checking your computers"   ("Checking this computer" when the engine is local)
  ├ text: "Home's AI runs on: this computer"  or
  │       "Home's AI runs on: another computer (192.0.2.20). 2 graphics cards, 16 GB for AI, 32 GB memory."
  ├ List (primitive; one row per check: status pill from ui/status + name + one-line result)
  ├ AsyncState (primitive) while the rows stream in
  ├ text (tip, changes per check): e.g. "Home runs in your house, so chat works even when
  │                                     your internet is down."
  ├ Alert (kit, new) only on amber or red: what is wrong, what to do, and an action Button
  ├ Button (primary): "Continue" (green or amber), "Try again" on red
  └ Button (link): "Restore from a backup instead"
```

BACKUPS.md wants restore offered early in onboarding. Welcome offers it, and so does this screen.

**Which machine each check is about.** The engine-computer line at the top is read from the Stack, never from the browser. If the person chose "Another computer" on screen 2, the hub is already paired with that Stack through the existing engine link. A red check offers "Use another computer", which goes back to screen 2. The memory, graphics, driver and model-disk checks then describe that machine. The hub's own disk, port, clock and network checks still describe the hub.

**The checks, in the order they run.** The cheapest and most blocking run first, so a red shows within a second. This page calls INSTALL-PREFLIGHT-01's one preflight function; it does not copy it.

| # | Check | On | Green | Amber (warning, can continue) | Red (blocker) | Copy for amber or red |
|---|---|---|---|---|---|---|
| 1 | Engine service | engine computer | The Stack answers `/healthz` | | The Stack does not answer | "Home's AI engine isn't running. Press Repair. If that fails, run the installer again on the computer that runs Home's AI." Action: "Repair" (`POST /api/engines/{name}/install`), then "Try again". |
| 2 | Memory and graphics | engine computer | Minimal level or higher (table above) | | Below Minimal | The refusal copy above. **When the whole list passes (no red), the downloads every plan needs start.** |
| 3 | System | engine computer | macOS on Apple silicon, Linux on arm64 or x64 with supported graphics, Windows through `install.ps1` | | Intel Mac, or no supported graphics | Folded into check 2's refusal. |
| 4 | Free disk for models | engine computer | at least the level's figure in the table | between the download plus 2 GB and the level's figure | less than the download plus 2 GB (`storage.critical_free_gb`) | Checked on the disk chosen on screen 3. Red: "There isn't room for the AI models on that disk. Free up about N GB, or press Back and choose another disk." |
| 5 | Graphics driver (NVIDIA only) | engine computer | Driver present, CUDA devices listed | The CUDA "system memory fallback" policy is on (ported from the old wizard's guard; detail UNVERIFIED) | | "Your graphics driver may slow chat down by borrowing system memory. Open NVIDIA Control Panel, Manage 3D settings, and set CUDA Sysmem Fallback Policy to Prefer No Sysmem Fallback." |
| 6 | Download host | engine computer | The pinned model host answers | Slow (under about 5 Mbit/s on the first megabytes; proposed threshold, UNVERIFIED) | No answer, and the model files are not already there | Red: "Home can't reach the internet to download its AI models. Check the internet connection of the computer that runs Home's AI, then press Try again." Amber: "Your connection is slow, so the download will take about N minutes." |
| 7 | Hub disk | hub | room for Home's data plus 2 GB | | under 2 GB free | "This computer is almost out of space. Free up at least 2 GB, then press Try again." |
| 8 | Clock | hub and engine computer | browser, hub and engine computer agree within 2 minutes | they differ by more | | "This computer's clock is off by N minutes. Turn on automatic time in its system settings." The household certificate and the records' clock stamps depend on it. Threshold proposed: UNVERIFIED. |
| 9 | Home network | hub | Home answers on an address other devices in the house can reach | It answers only on this computer (a firewall, or bound to loopback) | | "Phones and tablets in your house can't reach Home yet. Allow MaiPai Home in this computer's firewall." Whether the hub binds to every interface today: UNVERIFIED. |
| 10 | Engine link (remote engine only) | between the two | The engine link (REMOTE-STACK-LINK-01) reports `ready` | `degraded`: median probe round trip over the last 6 probes above 500 ms, the link's own threshold | No route | "Home can't reach the computer that runs its AI at 192.0.2.20. Check that it's on and on the same network, then press Try again." Over Tailscale, see "Away from home (Tailscale)" for the extra rows. |
| 12 | Web search | engine computer | Home's own SearXNG passes the SearXNG checker. A SearXNG found on this computer is reported here and offered on Your plan, never used without the click (rule 11) | Not reachable yet, or the checker finds a problem | never red | "Web search isn't ready yet, so Home will answer from its offline library and what the AI already knows. You can fix this later in Home settings, Web search." Never stops the flow. |
| 11 | Camera and microphone | | Not checked here. The row reads "Checked when you set up your face." (grey, Idle) | | | Asking for a permission before it is needed is the pattern Apple's HIG warns against. |

**Ports** are not a check row. The installer's `find_free_port` already chose the hub's port, and the Stack's base port is 8770. If the Stack's port is taken, check 1 turns red.

**Stored:** each result as a health-item row (code, severity, title, text, fix; `commons/spec/schemas/health-item.schema.json`) in the setup state, so the same rows show again under Home settings, Health. An amber the person continued past stays as a Repairs item.

**On pass:** Home records the engine computer's hardware facts, asks the Stack for its proposed tier, and asks the Stack to start the downloads every plan needs, into the screen 3 location. Repeating that request is safe. Tailscale is not a check row any more; it is screen 6.

### 5. Your plan

**Purpose:** one click to accept the right level for the engine computer.

```
Wizard (current = Your computers)
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
  ├ Collapsible (opens for "Choose for myself"): the SETUP-SIZE-01 role cards,
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

The carousel shows only when the person has nothing left to do and something is still downloading: on Hello while the starter is not ready, and on screen 11 if the full model is still coming. It never shows before Install, never on screen 6 (the person has a task there), never replaces a question, and is never a reason to wait longer.

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

### 6. Reach Home from anywhere (Tailscale)

**Purpose:** let the family use Home away from the house (a child on a tablet at a friend's, a parent at the grocery store), and give every device a real HTTPS address. You ruled it a setup step of its own (2026-10-13). It is the natural pause: it happens in other apps (Tailscale's installer, its sign-in, its console) while the files download, so the waiting time is used.

```
Wizard (current = Away from home)
├ install strip (downloads running)
└ Card
  ├ heading: "Reach Home from anywhere"
  ├ text: "Tailscale is a free app that links your family's phones and tablets to Home,
  │        privately, wherever they are. Your conversations go straight between your
  │        devices and this computer; Tailscale can't read them."
  ├ List (primitive; three rows that tick themselves, status pill from ui/status):
  │   1 "Install Tailscale on this computer"      Button (link): "Get Tailscale" (tailscale.com/download)
  │   2 "Sign in to Tailscale"                     text: "Use the account the family's devices will use."
  │   3 "Turn on secure addresses in Tailscale"    Button (link): "Open Tailscale settings"
  │                                                 (its admin console DNS page: MagicDNS and HTTPS)
  ├ text (small, before the click): "Turning this on publishes this computer's Tailscale name
  │        (home.tail1234.ts.net) in public certificate logs. Pick a plain computer name,
  │        not a family name." + Button (link): "How to rename it"
  ├ Button (primary, enabled when all three are ticked): "Turn on"
  ├ (after Turn on) QR code (kit) of https://home.tail1234.ts.net + text:
  │        "On your phone: install Tailscale, sign in with the same account, then scan this."
  ├ Button (primary): "Continue"
  └ Button (secondary): "Set up later"
      text (small, beside it): "Until you do, Home works only on your home Wi-Fi."
```

**How Home knows each row is done.** The existing `backend/src/lib/tailscale.ts` reads `tailscale status --json` on the hub. Row 1 ticks when the command exists, row 2 when the state is `Running` with a signed-in user, row 3 when the tailnet reports MagicDNS and HTTPS certificates as enabled (which field says so: UNVERIFIED; if none does, row 3 ticks when a trial `tailscale cert` succeeds). The screen re-reads every few seconds while it is open, and when the window regains focus. The person never presses "Check".

**What "Turn on" does.** Home runs `tailscale cert` for its `*.ts.net` name, stores the certificate beside the household one, and serves HTTPS on that name itself. It sets `network.tailnet_access` on. Let's Encrypt certificates last 90 days, so Home renews them the same way it renews the household leaf, with a Repairs item if renewal fails. **Renewal runs only while `network.tailnet_access` is on;** turning it off stops renewal, and no further request goes to Let's Encrypt.

- **The private key (CREDENTIALS.md).** The `*.ts.net` certificate's private key gets the same treatment as the household leaf's: listed in Home's `secretPaths`, written with permissions that only the service account can read, never in a backup in clear text, never logged.
- **The sign-in link is never logged.** The `tailscale up` sign-in URL that Home reads and shows on a hub with no screen lets whoever opens it add a machine to the family's Tailscale account. Home shows it on the setup page only; it never writes it to a log, the setup state, a health item or an error message.

- **Why Home serves the name itself, not `tailscale serve`.** `tailscale serve` proxies to `http://127.0.0.1:<port>` (kb/1312), so every request would arrive from loopback. That breaks per-address rate limits and anything that reasons about where a request came from, and it leans entirely on the Host check to keep setup closed. Serving the name directly keeps the real tailnet peer address. `tailscale serve` stays a fallback for a system where Home cannot read the certificate, and the Host check and its fixture stay either way.
- **UNVERIFIED, to settle in SETUP-AWAY-01:** that `tailscale cert` works on the macOS App Store build of Tailscale (the standalone build is known to ship the CLI); that one Bun server can present two certificates by name (the household leaf and the `ts.net` one); the exact JSON fields for row 3.

**Home never installs Tailscale, never signs anyone in and never touches the Tailscale account.** It links out and reads status. The account is between the family and Tailscale.

**A hub with no screen.** The person is on their laptop through the `ssh -L` forward. Row 1 then says "Install Tailscale on the computer running Home" and shows the one command for that system; row 2 shows the sign-in link that `tailscale up` prints on the hub, read by Home and shown as a link (Home never runs `up` on its own).

**Time.** About 30 seconds in this browser, plus about 5 to 8 minutes in other apps for a person who has never used Tailscale (UNVERIFIED; SETUP-TIME-01 measures it). The downloads (2.26 GB plus the plan's 7 to 10 GB) take 3 to 4.5 minutes at 300 Mbit/s and 19 to 26 minutes at 50 Mbit/s, so on most lines this step is fully covered by the wait.

**Privacy.** Tailscale is a third-party account. PRIVACY.md says anything that identifies the user stays opt-in. A clearly offered step with "Set up later" is opt-in; a step with no way past it is not (see "If the person cannot or will not set up Tailscale"). Tailscale carries only encrypted traffic between the family's own devices (its coordination server sees device names and addresses, not content), so no MaiPai-operated service enters the path. The privacy page (`/stack/v1/privacy` and Home's) gains two rows, shown only when it is on, in the same commit as the code (PRIVACY.md):

| Who receives it | What | When |
|---|---|---|
| Tailscale's coordination server | each device's public key, name, operating system, current public address, and the sign-in account | while Tailscale runs on a device |
| Let's Encrypt, and the public Certificate Transparency logs | this computer's Tailscale machine name and the tailnet name (`<computer>.<tailnet>.ts.net`), published permanently | at the "Turn on" click, and again at every renewal, about every 90 days, until `network.tailnet_access` is turned off |

You accepted the certificate-log publication (2026-10-13) on condition it is shown before the click, which screen 6 does.

**Stored:** `away` done, with `on` or `later`. The setting is `network.tailnet_access`; its default stays off, and only this click or the settings page turns it on.

**Errors and edge states:**

| State | Copy |
|---|---|
| Tailscale installed but its service isn't running | "Tailscale is installed but not running. Open the Tailscale app on this computer and turn it on." |
| Signed in, row 3 not done after the console link | "Tailscale still shows secure addresses as off. In Tailscale's settings, turn on MagicDNS and HTTPS Certificates, then come back here." |
| `tailscale cert` fails | "Tailscale couldn't make a secure address for this computer. Check that this computer is online, then press Turn on again. You can also press Set up later and finish it in Home settings, Network and access." |
| No internet on the hub | "This computer is offline, so Tailscale can't be set up now. Press Set up later; Home will remind you in Finish setting up." |
| Tailscale signed in to a different account than the phones will use | Not detectable. The QR step's text names the account Home sees: "Signed in as nova@example.com. Your phone must use the same account." |
| Funnel (public internet) found on for Home's port | Amber: "Tailscale Funnel makes Home reachable by anyone on the internet. Turn it off in Tailscale; Home is meant for your family only." (open question 5) |

### 7. Create your owner account

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
  └ Button (primary): "Continue"
```

The card's wording is proposed copy (open question 4), checked against the owner-only table in "Owner and admin": roles, people, storage (factory reset), backups (restore and the backup key) and other admins' settings are owner only. "Add apps and look after settings" matches what admins can do today. It is one card on the account screen, not a screen of its own, so it adds no click; reading it is about 8 seconds, counted inside screen 7's 30. The account is created after Tailscale on purpose: by then the person has seen the downloads running and the account step is short.

- **Route:** calls `POST /api/auth/setup`, which creates the name and secret together. The old wizard learned to do this atomically the hard way (commit 24402f86).
- **Role:** `owner`, as `POST /api/auth/setup` already sets it.
- **Localhost only:** this screen exists only on localhost (see "Setup works only on the hub itself").
- **PIN masking:** follows UI-OTP-MASK-01 when that lands.

**Errors:**

- "That PIN is too short. Use at least 4 digits." The real minimum comes from the auth route's validation: UNVERIFIED value.
- "Home is already set up. Sign in instead." This shows with a button to `/sign-in`.
- "Home couldn't save your account. Press Continue again. If it keeps failing, restart MaiPai Home on this computer."

**Not asked:** language, time zone and units (taken from the browser's `Intl` settings into `household.locale`), and the hub name (defaults to "Home").

### 8. Your face (optional, while the downloads run)

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

### 9. The rest of your profile (the standard new-person steps)

Whatever the standard new-person flow asks every person after name and face (sign-in recovery and anything else it holds) comes here, rendered by that flow's own screens. The wizard adds nothing and keeps no copy. Today there is no single new-person flow, so this screen is absent until one exists; the person's recovery stays reachable from their own profile and the checklist.

### 10. Hello (the first win)

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

**If the starter is not ready yet** (a slow line, see the timing table), the card shows the hero carousel and one line: "Home will say hello in about N minutes. You can close this page; it keeps going." "Continue" stays available, and the greeting then appears on screen 11 or on the home screen.

**Errors:** a failed turn never blocks. "Home couldn't answer yet. It will try again when the download finishes. Press Continue." If it still fails after the starter is ready, Home raises one Repairs item.

### 11. You're all set

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
│   text (small): "Install Tailscale on it, sign in with the same account, and scan this."
│   Button (secondary): "Show the code" (the ts.net QR from screen 6)
│   Button (link): "A device without Tailscale?" (the household-certificate QR; home Wi-Fi only)
├ row (only when screen 6 was set up later): "Home works only at home for now"
│   Button (link): "Set up Tailscale" (opens Home settings, Network and access, Away from home)
├ text (small): "N things left to finish setting up. You'll find them in Home settings."
└ Button (primary): "Open my Home"
```

**What this screen does on load:**

- **Mints the household certificate** (SETUP-HTTPS-01), whether or not Tailscale is on. It calls the same code as `GET /api/setup/ca`, so the leaf for `maipai.local` and the hub's addresses exists from here on. It is the fallback HTTPS path for devices without Tailscale and for a family that set Tailscale up later (see "Secure connections for every device").
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
- **Downloads:** SearXNG is in the downloads every plan needs, so it starts when Checks passes, with the starter model.

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
- Today's wizard has a "Remote access" step that says "This isn't built yet - skip it for now." It is rebuilt as screen 6.

**Two different jobs, kept apart:**

1. **Reaching the hub from away**, for a phone or laptop outside the house.
2. **The hub reaching a remote engine computer.** At home this never needs Tailscale: the engine link uses the home network. Tailscale is needed only when the hub itself travels (a laptop running Home), with `allow_tailnet` on. See "The engine computer and Tailscale".

### Best design on merit, then the rules

**Best experience for away access:** the owner installs the Tailscale app on the hub and on their phone, signs in once, and Home is reachable at its MagicDNS name, from their devices only, with nothing opened on the router. Among the options, this is the easiest that keeps content private:

| Option | Content seen by a third party | What leaves the home | Family effort |
|---|---|---|---|
| Home network only (the "Set up later" state) | none | nothing | none |
| Tailscale | none. Traffic is end-to-end WireGuard; relays "never" can decrypt it (Tailscale, "How Tailscale works", https://tailscale.com/blog/how-tailscale-works, read 2026-10-13) | each device's public key, name, operating system, current public address, and the account used to sign in, held by Tailscale's coordination server, which "carries virtually no traffic" (same source; the exact list of stored fields is UNVERIFIED) | low: one app, one sign-in |
| Headscale (self-hosted coordination server) | none | nothing to a third party; the family runs the coordination server on a machine reachable from the internet (https://headscale.net/stable/, "a single tailnet", read 2026-10-13) | high: a server with a public address to run and update |
| Router WireGuard or VPN | none | nothing | medium to high: router-specific |
| Tailscale Funnel, or any public tunnel | Funnel relays forward TLS without decrypting it, but **anyone on the internet with the address** reaches Home's sign-in page (https://tailscale.com/kb/1223/funnel, read 2026-10-13) | the same as Tailscale, plus a public DNS name | low, but unsafe |

**Checked against the rules:**

- PRIVACY.md: no MaiPai-operated service is in the path (Tailscale is the owner's own account), and outbound connections are user-serving and opt-in. Tailscale identifies the user, so it must stay opt-in. A setup step the person can pass with "Set up later" is opt-in: the key stays off until their click. A step with no way past it would not be, and would need a PRIVACY.md change that only you can make (see "If the person cannot or will not set up Tailscale").
- The coordination metadata leaves the house. That is the cost, and the setting says so in plain words. Headscale removes it, at a real effort cost, so it is offered as "Use your own Headscale server" text, not as a Home feature: Home reads the Tailscale app's status, and Headscale uses the same app (that detection works with Headscale is UNVERIFIED).
- Home never installs Tailscale or signs anyone in. Installing it adds a network extension and changes system networking, which is the owner's own act on their own machine. This is also the existing design (`tailscale.ts`).
- **Funnel is never turned on by Home**, and if Home sees that the hub's port is exposed through Funnel, it raises a red Repairs item (see open question 5).

### Where it sits in the flow

- **Screen 6, a phase of its own** (your ruling, 2026-10-13). Away use is part of what a family expects from Home: a child on a tablet at a friend's house, a parent at the grocery store. The step sits right after Install so its minutes in other apps overlap the downloads. Revision 4 had it as one line on You're all set; that is superseded.
- **Not a Checks row any more.** Row 13 is gone; screen 6 reads the same status.
- **Skipped, it becomes the checklist item "Reach Home when you're away"** and one row on You're all set, both opening Home settings, Network and access, Away from home.

**Detection:** `tailscale status --json`: not installed, stopped (installed but signed out or off) or running, with the MagicDNS name and whether Funnel serves the hub's port (`tailscale funnel status`; the exact command output is UNVERIFIED).

### If the person cannot or will not set up Tailscale

Two designs, with their costs:

| | "Set up later", clearly marked (recommended) | Hard stop: no Home until Tailscale works |
|---|---|---|
| What the person sees | A secondary button with its consequence on the same line: "Until you do, Home works only on your home Wi-Fi." Pressing it asks once: "Set up Tailscale later? Phones and tablets won't reach Home outside your house until you do." | No way past screen 6 |
| Privacy rule | Within PRIVACY.md: the step is offered, the key stays off until the click, so it is opt-in | Conflicts with PRIVACY.md ("anything that identifies the user stays opt-in"). Needs your amendment; the architect cannot approve it otherwise |
| No internet on the hub, Tailscale down, a locked-down network, an employer-managed Mac | Setup finishes; Home works at home | Setup cannot finish at all, though Home's AI is already downloaded and working |
| A family that will not make a third-party account | Uses Home at home | Cannot use Home |
| Families who never come back to it | Some will. Mitigated by the checklist item, the row on You're all set and the owner's one quiet home-screen line | None |
| Support load | Low | Every Tailscale outage or sign-in problem becomes "Home won't install" |

**Decided: "Set up later"** (your ruling, 2026-10-13; no hard stop). It gives you almost everything the hard stop would (the step is on the default path, first in line after Install, and most people will simply do it while the files download), without making Home's install depend on a third party being up and reachable, and without a privacy-rule change.

### The engine computer and Tailscale

**How the hub and a remote Stack talk.** Phones and tablets only ever talk to the hub. The hub talks to the Stack through the engine link (REMOTE-STACK-LINK-01): one SSH connection from the hub to the engine computer, authenticated by its key and pinned host key, carrying the Stack's API as a port forward. The SSH connection needs a network route between the two computers, and nothing else.

**Does skipping Tailscale block the install with a remote Stack? Only when the two computers are on different networks.**

| Where the two computers are | How the link travels | Tailscale needed for the link? | "Set up later" on screen 6 |
|---|---|---|---|
| **Same home network** (the usual case: a gaming PC or Mac Studio in the next room) | SSH over the home network, to the engine computer's home address | **No.** Neither computer needs Tailscale for the AI to work | Allowed. Home works fully at home; only away access waits |
| **Different networks** (the engine computer at another house or an office, or no direct route between them) | SSH over Tailscale, to the engine computer's tailnet address, with `engines.stack.remote.allow_tailnet` on | **Yes, on both computers**, signed in to the same account | Not the question: screen 2 cannot connect without it, so Tailscale is set up on screen 2, before any download (below) |
| **Same network at setup, but the hub is a laptop that later leaves the house** | home network now, tailnet later | Not for setup. Later, yes on both, with `allow_tailnet`, set in Home settings, AI | Allowed |

**Different networks, in the flow.** When the address typed on screen 2 is a tailnet address (`100.64.0.0/10` or a `*.ts.net` name), screen 2 shows screen 6's three self-ticking rows for this computer, plus one row for the engine computer ("The computer running Home's AI is on your Tailscale network": the hub's `tailscale status --json` lists it as an online peer), and the `allow_tailnet` question ("This computer reaches Home's AI through your Tailscale network. Allow that?"). There is no "Set up later" there, because without the link there is no AI to check or download to. This is not a forced step: the person chose a remote engine on another network, and "This computer" is always the way past it. Screen 6 then finds Tailscale already running and only asks for "Turn on" (the secure address). An address on a different network that is not a tailnet address gets screen 2's ordinary "can't reach" error, which adds: "If that computer is on a different network, install Tailscale on both computers and use its Tailscale address."


The `allow_tailnet` rule is the existing design (REMOTE-STACK-DESIGN): off by default, turned on only by that one click. The rows below are the Checks rows for a link over Tailscale.

### When the engine computer is reached over Tailscale### When the engine computer is reached over Tailscale

This happens only when the hub travels, or when the admin entered a tailnet address for the engine computer. Checks adds these rows to row 10:

- **The address is on the Tailscale network but `allow_tailnet` is off.** Amber, with one action: "This computer reaches Home's AI through your Tailscale network. Allow that?" and a Button "Allow" that sets `engines.stack.remote.allow_tailnet` (its privacy row shows from then on). No other path turns it on.
- **Tailscale on both computers:** the hub's `tailscale status --json` must list the engine computer as a peer that is online. If not: "The computer that runs Home's AI isn't on your Tailscale network right now. Open Tailscale on it and sign in with the same account, then press Try again."
- **Direct or relayed:** if the peer is reached only through a relay, the row is amber: "Home reaches its AI through a Tailscale relay, so answers may be slower. This usually fixes itself; if it doesn't, see Tailscale's help on direct connections." (The status field that shows relay versus direct is UNVERIFIED.)
- **Latency:** the engine link's own probe decides: `ready` passes, `degraded` (median over 500 ms) is amber with "Answers may be slow because the connection to the computer running Home's AI is slow."

### Failure states

| State | Copy |
|---|---|
| Not installed (Settings, after "Set up later") | "Tailscale isn't on this computer. To reach Home away from home, install Tailscale from tailscale.com/download on this computer and on your phone, sign in with the same account, then press Check again." Screen 6 has its own copy for the first run (see screen 6). |
| Stopped or signed out | "Tailscale is installed but not connected. Open Tailscale on this computer and sign in, then press Check again." |
| Running, away access off | "Tailscale is connected. Turn on 'Reach Home away from home' to let your devices on Tailscale open Home." |
| Funnel exposes Home | Red Repairs item: "Home can be reached by anyone on the internet through Tailscale Funnel. Turn it off by running `tailscale funnel off` on this computer, then press Check again." (exact command UNVERIFIED) |
| Peer offline (engine computer) | as above |

### Settings counterpart: Network and access, "Away from home" (admins only)

Every label, help line and privacy sentence on this page comes from the spec copy fields of its keys and area (`keys.json` and `areas.json`, SETTINGS.md S5), never typed into the page. The quoted text below is the proposed value of those fields.

| Part | Source | Kit part |
|---|---|---|
| Status: not installed, stopped, connected; MagicDNS name and tailnet address | `getTailscaleStatus()` | `ui/status`, `List` |
| Reach Home away from home: on or off (Home answers on its tailnet address, or not). Turning it off also stops certificate renewal | new key `network.tailnet_access` (household, admin, default off; screen 6's "Turn on" sets it; `needs_restart` if it changes what Home listens on: UNVERIFIED) | generic renderer (`Switch`) |
| Connect or disconnect | Home does not control Tailscale. The section says "Open Tailscale to sign in or out" and shows Check again. | `Button` |
| Who can reach it | text: "Everyone on your Tailscale network can open Home's sign-in page. They still need their own PIN. Children's devices on your Tailscale network follow the same rules as at home." | text |
| Tailnet only vs Funnel warning | the Funnel check | `Alert` (KIT-ALERT-01) |
| The engine computer from away | `engines.stack.remote.allow_tailnet` (exists; drawn on the Engines page, linked from here) | link |
| Secure address | the `*.ts.net` certificate's state and renewal date; "Turn on" again if it lapsed | `ui/status`, `Button` |
| What leaves the house | the privacy page row: "Tailscale: your devices' names, keys and addresses, and the account you sign in with, go to Tailscale so your devices can find each other. What you say and see in Home does not." | text |
| Headscale | text: "Prefer to run your own? Tailscale's app also works with Headscale, a server you run yourself." | text |

**No list of who signed in from away on this admin page** (RULES.md rule 6a: an admin page never shows a person's activity). Each person sees only their own devices that signed in from away, in their own Account (ACCOUNT-AWAY-DEVICES-01).

## Secure connections for every device

**Why it matters.** Talking to Home and showing it your face need the browser's camera and microphone. Browsers allow those only in a secure context: "can only be used in secure contexts; in insecure contexts, navigator.mediaDevices is undefined" (MDN, `MediaDevices.getUserMedia()`, read 2026-10-13). A secure context is an HTTPS page, or a page on the same machine: `localhost`, 127.0.0.0/8 and `::1` are "potentially trustworthy", while a private network address over plain http is not (W3C Secure Contexts, section 3.1, read 2026-10-13). So:

- **The hub's own browser needs nothing.** Setup runs on `http://localhost:<port>`, which is already secure. Face on screen 8 works there.
- **Every other device needs HTTPS** to use voice or face: a phone, a tablet, a laptop in another room.

**How Home serves HTTPS today** (read 2026-10-13):

- `backend/src/lib/householdCa.ts` makes a household certificate authority and a leaf certificate for `maipai.local` and the hub's network addresses (`currentAltNames()`), all on the hub. Nothing leaves the house.
- The leaf is made only when someone calls `GET /api/setup/ca`, which also serves the authority file, a QR code for the hub's network address and install hints for macOS, Windows, iOS and Android (`backend/src/routes/setup.ts`).
- `backend/src/index.ts` turns TLS on at boot only if a leaf already exists ("TLS only when a leaf certificate already exists"), and rebinds the listener in place when a leaf is renewed.
- The phone or tablet installs the authority once and trusts it. On iPhone and iPad that is one extra switch: Settings, General, About, Certificate Trust Settings (Apple support article 102390, read 2026-10-13).

**Two gaps this note found** (from reading the code, not exercised; SETUP-HTTPS-01 proves each with a test):

1. **A new household never gets the leaf** unless someone opens the old "Trust this hub" step, which this flow removes. So You're all set mints it (with Tailscale on or not), and the hub then rebinds to TLS without a restart (the same rebind the renewal uses; today the first leaf takes effect only on the next restart).
2. **The leaf does not name `localhost`, and the hub has one port.** Once TLS is on, `http://localhost:<port>` would stop answering and `https://localhost:<port>` would show a name warning (UNVERIFIED, inferred from `currentAltNames()` and the single `Bun.serve`). Setup, Repairs on the hub and the `ssh -L` path all use localhost. The fix is either `localhost`, `127.0.0.1` and `::1` in the leaf, or a second plain-http listener bound to loopback only. Recommended: the loopback listener, because the hub's own browser then never needs the authority installed, and loopback http is already a secure context. Revision 5 makes this more pressing: screen 6 turns on the `*.ts.net` certificate before the owner account exists, so the localhost listener must survive TLS coming on in the middle of setup.

**Revision 5: Tailscale is the HTTPS path for other devices.** With your ruling, screen 6 gives the hub a real certificate for its `*.ts.net` name (Let's Encrypt, through `tailscale cert`, kb/1153). Any device on the household's Tailscale network opens `https://home.tail1234.ts.net` with no certificate to install and no warning, at home and away. That is the smoothest HTTPS a family can get without a MaiPai-run service, so on merit it is the main path.

**The options, best on merit first:**

| Option | Works for | What leaves the house | Family effort | Rule cost |
|---|---|---|---|---|
| A real certificate for a name MaiPai runs (the way some media servers do it) | every device, no install step | each hub's address to a MaiPai-run naming service | none | **breaks zero phone-home** (PRIVACY.md: no MaiPai-operated service in a user data path). Named because it is the smoothest; not proposed |
| **Tailscale certificate on the `*.ts.net` name (main path, screen 6)** | every device on the household's Tailscale network, at home and away | the machine name and the tailnet name, in public Certificate Transparency logs ("Do not enable the HTTPS feature if any of your machine names contain sensitive information", kb/1153, read 2026-10-13); plus the coordination details in "Away from home" | each device installs Tailscale and signs in to the household's account | opt-in, satisfied by screen 6's own click and "Set up later" |
| **Household certificate (exists; kept as the fallback)** | every device on the home network, by `maipai.local` or address | nothing | scan a QR, install, tap Allow once per device (one extra switch on iPhone) | none |
| Caddy or another local proxy with its own internal authority | the same as the household certificate | nothing | the same, plus one more service to run | none, but it duplicates `householdCa.ts` (principle 1) |
| Plain http on the network address | text chat only; no voice, no face on other devices | nothing | none | none, but half the product is missing on phones |

**Why the household certificate stays, on merit.** Keeping two HTTPS paths is a cost (two certificates to renew, two QR codes). It earns its place because four real cases have no other way to voice and face:

1. **The "Set up later" family.** Without it, their phones get text chat only until Tailscale is done.
2. **Devices that cannot or should not run Tailscale:** a TV browser, a guest's phone, a shared kitchen tablet the family does not want on their account, and the robot before it pairs.
3. **No internet.** "Works when the internet doesn't" is a promise on the hero slides. The household certificate needs nothing outside the house. Whether a tailnet keeps reaching the hub on the same Wi-Fi while the internet is down (Tailscale caches its peers, so likely, but its DNS name may not resolve) is UNVERIFIED; until SETUP-AWAY-01 proves it, the household certificate is the only HTTPS path that is certain to work offline.
4. **The renewal gap.** The Tailscale certificate needs Let's Encrypt every 90 days; if renewal fails while the internet is down, the household certificate still serves home devices.

It already exists (`householdCa.ts`), so keeping it costs a QR row, not a feature. It moves from the main row on You're all set to a secondary link ("A device without Tailscale?") and a section in Network and access.

**Required, with a way to do it later.** Your ruling makes Tailscale a required step. This note keeps it required in the sense that every owner meets it on the default path and must choose (set it up, or say "later" with the consequence in front of them). It does not hard-stop, for the reasons in "If the person cannot or will not set up Tailscale". The CT-log publication is shown before the click, with a hint to pick a plain computer name (open question 7).

**Effect on perceived length and the dad test:** one added phase on the default path (screen 6: about 30 seconds in the browser, 2 clicks, plus 5 to 8 minutes in other apps, overlapping the downloads; UNVERIFIED). Phones then need nothing but the Tailscale app and a scan, which passes the dad test better than installing a certificate. Devices without Tailscale keep the revision 4 path: scan, install, tap Allow.

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

**Additions for the owner's setup only:** the Tailscale step (screen 6), the backup key and device rows on screen 11, and the checklist. A second person added later goes through People as today. When a single new-person flow is built, screens 7 to 9 become its owner variant, so there is one flow, not two; screen 9 is that flow's remaining steps, unchanged.

## The "Finish setting up" checklist

The checklist sits at the top of Home settings, General, while anything is left. The home screen also shows one quiet line to the owner and admins only: "3 things left to finish setting up". Each item is done when the fact behind it is true, not when someone ticks a box, so it can never drift.

| Item | Done when | Opens |
|---|---|---|
| Set up face sign-in | the owner has a face print | profile, face |
| Add your family | more than one person exists | People |
| Choose where backups go | a backup target other than the local default exists | Storage and backups |
| Add a phone or tablet | a second device has signed in (device tokens) | the `*.ts.net` QR, with "A device without Tailscale?" for the household-certificate QR |
| Reach Home when you're away (only after "Set up later" on screen 6, or if Tailscale later stops working) | `network.tailnet_access` is on, Tailscale is connected and the secure address is valid. It cannot be dismissed with "Not now" for good; it returns after 14 days (proposed) | Network and access, Away from home |
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
| Which computer runs the AI (screen 2) | AI | `engines.stack.where`, `engines.stack.remote.*` (existing) | as declared |
| Voice on or off | AI, the stt and tts cards | the same per-role choice (off) | basic |
| Photos on or off | AI, the vision card | the same per-role choice; the tier label says when it is not available | basic |
| Where files are kept (screen 3) | Storage and backups (area `storage`) | DATA-LOCATION-01's per-class keys (existing plan) | basic |
| Offline library | Reference library | KS-REF-WIZARD-01's keys | basic |
| Who can reach Home | Network and access | new `network.lan_exposure` (`loopback` or `lan`), `needs_restart`, declared in keys.json; plus a new area `network` in areas.json | advanced |
| Hub port | Network and access | new `network.hub_port`, `needs_restart`, with a confirm that names the new address | expert |
| Web search provider, own SearXNG, engines, test query | Web search (SEARXNG-SET-05's page) | `search.web_sources`, `search.source_mode`, `search.searxng_url` (existing); `stack.search.*` (SEARXNG-SET-02) | advanced for the URL, basic for the rest |
| Away from home (screen 6) | Network and access, Away from home | new `network.tailnet_access`; existing `engines.stack.remote.allow_tailnet`, `robot.offlan.tailnet` | basic (it is now a first-run choice) |
| Devices without Tailscale | Network and access | the household certificate QR (`GET /api/setup/ca`) | basic |
| Who is owner, who is admin; handing over the owner role | People, each person's profile (owner only) | `role` on the person record (existing); the change goes through `personLifecycle.ts`, with the last-owner guard | basic |
| Hub name, language | General (area `general`) | `household.family_name`, `household.locale` (existing) | basic |
| Check my computers again | Repairs (area `maintenance`) | an action, not a key: re-runs the Checks list and writes the results to Health | n/a |
| Repair or reinstall the engine | Repairs | the existing `POST /api/engines/{name}/{action}` (install) and the Repairs fixes | n/a |
| Run setup again | Repairs | an action that opens review mode (below) | advanced |
| What Home can do | System | the hero slides, read only | basic |

Stack-side keys (`stack.*`, with `needs_restart`, `in_effect` and `pending`) are drawn on the Engines page exactly as SETTINGS.md describes. The wizard never writes them directly.

**Running setup again, safely.** Review mode is an ordinary signed-in admin page and shows Where Home's AI runs, Where files are kept, Checks and Your plan (screens 2 to 5) only; the owner alone may change the storage location there, as today. It never:

SETUP-REVIEW-01 implementation note (2026-10-14): the existing engine-location screen reads and can save the declared `engines.stack.where` key. The current storage and plan screens are still stubs, and the pinned commons spec has no storage-location setting, so both screens render read only until their own settings shape and production behavior land. Review and Repairs checks use signed-in Repairs routes and never write setup-state or call `/api/setup/*`.

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
   - `phase`: `computers`, `away`, `meet` or `done` (the install runs in the background and has no phase of its own)
   - `engine`: `{ where, link_id?, hardware }`, the facts the Stack reported; `where` mirrors `engines.stack.where`, never replaces it
   - `away`: `on` or `later`
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
- `POST /api/setup/:step` for `welcome`, `engine_location`, `storage`, `checks`, `plan`, `away`, `owner`, `face`, `profile`, `hello` and `done`. Each is safe to repeat on its step id. `checks` refuses until `engine_location` and `storage` are done, so the server, not only the page, holds the "nothing downloads before both answers" rule.

The session-storage resume (`maipai:setup-wizard-step` and friends) is deleted.

## Resume, re-runs and edge cases

- **Resume.** The state lives on the hub. A refresh, another browser on the hub, or a reboot lands on the first unfinished step. Downloads resume from their `.part` files on the engine computer. A file that fails its checksum is fetched again once, then raised as a Repairs item.
- **Unattended plan.** `install.sh --plan recommended|moderate|minimal` (or `MAIPAI_PLAN=...`) records the plan, and the installer's engine choice and data folder pre-fill screens 2 and 3. They still show for one click each, because your ruling puts both answers before any download. Downloads still wait for the checks.
- **Re-running after a failure.** A failed step keeps its error (a health item with the fix) and shows "Try again", which re-runs that step only. Re-running the installer upgrades in place, keeps the data, and leaves a finished setup finished (`install.sh` is already idempotent).
- **Repeating a step is safe.** Account creation answers "already set up" when an owner exists. A download request for a model already queued attaches to the running job, keyed by model id and checksum.
- **Another device during setup** gets the "Finish setting up on the computer running MaiPai Home" page.
- **The robot or a second hub** asking `hello` before setup is done gets `setup_incomplete`, and shows "Your Home is still setting up. Try again in a few minutes." After setup is done, pairing is the normal flow.
- **Restore** replaces screens 4 to 9 with BACKUPS.md's sequence (screens 2 and 3 still ask where the AI runs and where files go, since the new computer may differ): verify, unpack beside the live data, migrate, swap, health check. The Stack then reinstalls what the restored pins name, under the same install strip. Restore also works only on localhost. Signing in uses the restored owner's PIN.

## Preview mode (walk every screen, change nothing)

SETUP-PREVIEW-01 implements the development-only preview against the screens present on `origin/main`; later screen-specific scenarios wait for their screen work.

Your addition (2026-10-13): a way to walk through every screen, check and step, including the error and edge screens, without anything downloading, installing, writing settings or touching the machine.

**Best design on merit: the real wizard, with its server answered by scenario files.** The screens, the setup client and the copy are the production ones. Only the far side of the network calls changes: in preview, every `/api/*` request the page makes is answered in the browser by a scenario, and no request ever leaves the page. That is the one seam that lets the screens stay a single copy (org principle 1): no second wizard, no `if (preview)` inside a screen, no fake components.

**How it is started (never in the normal user path):**

- On a development machine: `cd /path/to/home/frontend` then `bun run setup:preview`. It starts the Vite dev server with `VITE_SETUP_PREVIEW=1` and opens `http://localhost:5173/setup?scenario=happy-local`. No backend and no Stack run at all, so there is nothing for a click to write to.
- The preview code (the request handlers, the scenarios and the preview bar) is imported only behind that build flag, so the production bundle does not contain it.
- **The service worker file is generated, never committed to `frontend/public/`.** Mock Service Worker needs a `mockServiceWorker.js` file served at the page's root. Anything in `frontend/public/` is copied into every production build, so the file lives nowhere in the tree: the `setup:preview` script generates it into a git-ignored preview-only folder that only the preview server serves.
- **A gate test builds the production bundle and fails if either the preview marker string or a `mockServiceWorker.js` file is in the output.** A running hub has no preview route and no query parameter that turns it on.

**How fake results are fed.** Scenarios are data files in `frontend/src/apps/setup/preview/scenarios/`, one per case, each a small override of a base scenario. Their shapes are the real ones (the setup-state record, health items, the Stack's hardware answer, `tailscale status --json` samples, download progress), validated against the spec schemas, so a scenario cannot describe a state the real server could never send. The handlers that answer from them are plain functions (request in, response out) built on Mock Service Worker, a maintained library (principle 6; a new dev dependency under RELEASES-AND-DEPENDENCIES.md, never in the production bundle). Unhandled requests fail loudly, so nothing can slip through to a real address.

| Scenario | What it shows |
|---|---|
| `happy-local` | Every screen green, this computer, 300 Mbit/s |
| `happy-remote` | "Another computer" on screen 2, same home network, pairing, remote hardware line on Checks |
| `remote-tailnet` | "Another computer" on a different network: screen 2's Tailscale rows and the `allow_tailnet` question |
| `remote-unreachable`, `remote-bad-code` | Screen 2's two errors |
| `disk-small` | Screen 3 with a greyed disk; check 4 red on the chosen disk |
| `below-minimal` | The refusal copy and "Use another computer" |
| `low-memory-moderate`, `minimal-24gb` | Plan screen with fewer levels |
| `nvidia-fallback`, `clock-off`, `lan-blocked`, `search-amber` | Each amber row and "Continue anyway" |
| `engine-down` | Check 1 red and Repair |
| `slow-download` (50 Mbit/s), `stall`, `checksum-fail`, `out-of-space` | The install strip's states, the hero carousel at Hello, "Almost ready" on screen 11 |
| `tailscale-missing`, `tailscale-signed-out`, `tailscale-https-off`, `tailscale-cert-fails`, `tailscale-offline`, `funnel-on` | Screen 6's rows and every error |
| `tailscale-later` | The "Set up later" confirm, the row on You're all set, the checklist item |
| `no-camera`, `face-skipped` | Screen 8's two other paths |
| `owner-exists` | "Home is already set up. Sign in instead." |
| `restore` | The restore path from Welcome |

**The preview bar.** A kit `Alert` fixed above the wizard on every screen, never dismissible: "Preview. Nothing is downloaded, installed or saved." Beside it, kit parts: a `Select` for the scenario, "Jump to screen" (1 to 11), a speed `ToggleGroup` (1x, 10x, 60x) that runs the fake clock behind the download estimates, "Restart", and, on screen 6, "Pretend the next Tailscale step is done", since nobody installs Tailscale to preview it. The browser tab title starts with "Preview". The bar is preview-only code and sits beside the wizard, never around a kit Element (rule 9).

**What it never does:**

- **No network fetch:** the page's requests are answered in the browser; unhandled ones throw. A test asserts zero requests left the page in each scenario.
- **No state change:** no backend runs, so no setup state, setting, account, face print or certificate is written anywhere. The scenario state lives in memory and is gone on reload. The preview stores nothing in browser storage.
- **No accounts:** "Create your owner account" posts to the handler, which answers as the real route would.
- **No download, no install, no Tailscale command:** the Stack, `tailscale` and the downloads are all on the other side of the seam.
- **Hello** streams a scripted reply from the scenario through the same chat Elements; no model runs.
- **The camera** on screen 8 is the one real device it can touch. In a headless run, Chromium's fake camera is used. In your own browser the real camera works, and the enrolment it produces goes to the handler and is dropped (open question 8).

**Where it ends.** "Open my Home" in preview shows an end card: "Setup is done here. Next, Home would open and start the tour." The tour itself is previewed on the seeded demo household with the tour's own replay (`docs/plans/guided-tour-2026-10-13.md`), so the preview does not grow handlers for the whole shell.

**The same mode serves screenshots and tests.** Yes, and that is most of its value:

- **Screenshots:** the screenshot script opens each scenario URL headless at 1440 and 390, both themes, so SETUP-LOOK-01's captures and every user-doc image of the wizard come from the scenarios, never from a real install. Each is opened and judged as the docs rule requires.
- **Tests:** component tests render the wizard with the same handlers (Mock Service Worker's test mode) and assert each scenario's copy and buttons, so the error and edge copy in this note is checked, not just written.
- **What it cannot prove:** the server. One end-to-end test still runs the real backend on a throwaway data folder for the happy path, and SETUP-LOCAL-ONLY-01's route tests stay real. Preview is for looking, copy and layout; it is never evidence that setup works.

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
| Download progress | kit JobProgress Element (extended) | additive props |
| File details | kit `Sheet` | none |
| Hero carousel | **new kit part:** shadcn Carousel (https://ui.shadcn.com/docs/components/carousel), on Embla with `embla-carousel-autoplay` | The kit has no carousel. KIT-CAROUSEL-01 adds it, after its UI-DECISIONS row. |
| Hello | assistant-ui chat Elements from the kit | none |
| Face | `FaceEnrollmentBody` (exists) | none |
| Not-on-this-computer page | kit `Page` and `Card` | none |
| Checklist | kit `List` primitive and `Button` | none |
| Settings pages | kit `SettingsShell` and the generic renderer | none |

**Precondition for KIT-ALERT-01 and KIT-CAROUSEL-01.** Rule 9b sends every kit addition through `docs/design/UI-DECISIONS.md`, and that file does not exist in Home yet; `docs/design/` holds only `RULES.md`, `ELEMENTS-DECISIONS.md` and `retired/home-pages-2026-09-20.md`. Its first commit creates the file with two rows, one for `carousel` and one for `alert`. Each row says what is added, from which registry, who decided it, and why no existing kit part does the job. Neither kit row may be dispatched before that commit lands.

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
| OS-wipe restore flow (e1b8e705) | Keep | Becomes "Restore from a backup" on Welcome and Checks. |
| Wake words seeded on fresh installs (ae3e6524) | Keep | Already true: wakeword is `installedOnly` and is among the downloads every plan needs. |
| Starter home layout generated from installed apps (5aed9216) | Keep the idea, out of scope here | Belongs to the home screen design. |
| Background setup widget, minimisable, with per-job cancel | Rebuild on standard parts | Becomes the install strip and its Details sheet. Per-file cancel is dropped. |
| Hand-built inputs (`inputCls`) and custom toggles | Drop | Rule 9b. |
| No going back from the download step | Keep | Same rule here: after Install, no Back to screens 2 to 5. |
| Four-card tour, once per person, every dismissal marks it done, replay from settings (b0559f35) | Keep the logic | Carried into the guided-tour note. |

**How this shaped the design:** four screens left the page list (consent, area, PIN, components), check 5 exists, restore is offered on Welcome and Checks, and "wait for everything" was reversed in favour of the starter model.

## Open questions for Jesse

1. **Answered: owner and admin stay as they are** (your ruling, 2026-10-13). One thing in it needs your yes: GRANT-AUTHORITY-01 closes the gap that lets an admin grant themselves a full restore. Recommended: yes, since it is what your ruling already says.
2. **How memory counts on a PC (hardware).** For a PC with graphics cards, the levels count the cards' memory added together (two 8 GB cards make 16 GB, so Minimal), with system memory as a separate minimum. Is that what you meant, or should system memory count toward the total too? Recommended: graphics memory only. Models run in graphics memory; using system memory is the slow path the NVIDIA check warns about.
3. **The backup key may be shown again (an org-doc wording call).** BACKUPS.md says the emergency kit is "shown once". The route already says re-viewing an unchanged key is safe (`backend/src/routes/backups.ts`, emergency-kit route), and your answer puts the key on You're all set and in Storage and backups. Recommended: amend BACKUPS.md to "shown at setup with a print step, and again on request to an admin", since only a new key, not a re-view, is the risky act.
4. **Disclaimer and proposed copy (taste and legal).** Please read the Welcome disclaimer word for word, and screen 6's Tailscale wording (it names a third party and says what it can and cannot see). The promise lines and slides `hero.privacy`, `hero.try`, `hero.kids` and `hero.offline` are proposed too. Recommended: accept them, and add the ones you like to COPY.md, so the slides can point to them by key.
5. **Tailscale Funnel (safety).** If the hub's port is reachable from the public internet through Funnel, should Home only warn (a red Repairs item), or also refuse sign-in on requests that arrive that way? Recommended: warn now, and refuse once a test proves Home can tell Funnel requests apart (how is UNVERIFIED). Home itself never turns Funnel on.
6. **Web search with no Stack search yet (a build-order call).** Today a new household has no web search at all, because STACK-SEARCH-01 is not built and `search.searxng_url` is empty. Should SETUP-FLOW-01 wait for STACK-SEARCH-01, or ship first with row 12 amber and "offline library only" until then? Recommended: ship first; the degrade path already answers without web search, and row 12 tells the admin.
7. **The Tailscale step (privacy; one part still open).**
   - **Answered: "Set up later" stays, no hard stop** (your ruling, 2026-10-13).
   - **Children's tablets sign in with the owner's Tailscale account.** That keeps children out of a third-party account of their own, but every family device then sits under one adult login. Recommended: yes, the owner's account for the whole family; Tailscale's own terms for minors' use were not read (UNVERIFIED) and should be before this ships.
   - **Answered: the public certificate-log name is accepted** (your ruling, 2026-10-13), because screen 6 shows it before the click and suggests a plain computer name.
8. **Preview mode (a tooling call).** Recommended: preview runs only on a development machine (`bun run setup:preview`), never on an installed hub, and your own browser's real camera works on the face screen with nothing saved. The alternative is an owner-only "Preview setup" in a finished hub's Repairs, which would put a no-effect copy of setup in front of families; not recommended.

## Supersedes

- **The step list and session-storage resume** in `frontend/src/apps/setup/SetupWizard.tsx`, and the wave-2 step ids in `docs/plans/wave-2.md` (lines 223 to 226). The route names stay; the step ids change as listed in Data.
- **The step list in the backlog row "The first-run wizard, end to end"** (`docs/BACKLOG.md`, around line 8613). Locale, the household name, the adult acknowledgment, trust, packages, Tailscale and the backup target all move out of the first run, as described above.
- **SETUP-LOOK-01** (`docs/BACKLOG.md`, around line 8611), in part. That row builds the wizard from the template's `auth2` and `authforms` views, with plan 12's steps one per screen and a progress rail on the left. This note keeps its look goal and its acceptance (captures at 1440 and 390 judged beside the sign-in page, restore as the second screen, real routes only). It replaces the step list and the left rail with the kit `Wizard`'s three phases (Your computers, Away from home, Meet your Home). The page frame may still use the `auth2` card layout around the `Wizard`, if that layout composes the same kit `Card`; the architect rules on that when SETUP-FLOW-01 is dispatched. SETUP-LOOK-01 should be amended to point here rather than closed.
- **KS-REF-WIZARD-01's "Offline library" first-run wizard step** (`docs/BACKLOG.md`, around line 9605). It is not a first-run screen. It lands in two places: as a card in "Choose for myself" (Custom) on screen 5, and as the checklist item "Add the offline library". The settings page that row describes (Home settings, Reference library) is unchanged.
- **Today's "Remote access" wizard step** ("This isn't built yet - skip it for now"). Rebuilt as screen 6, Tailscale.
- **Revision 4 of this note on Tailscale** (your ruling, 2026-10-13): "Tailscale recommended, not required", the single line on You're all set, Checks row 13, the household certificate as the main HTTPS path for other devices, and old open question 5. Tailscale is now screen 6, a required step with a clearly marked "Set up later"; its certificate is the main HTTPS path; the household certificate is the fallback.
- **Revision 4's opening order** (Welcome, Checks, Plan, with the storage choice inside Custom). The order is now Welcome, Where Home's AI runs, Where files are kept, Checks, Your plan, and nothing downloads before both questions are answered.
- **Today's "Trust this hub" step and the separate emergency-kit screen** (your answer, 2026-10-13). The certificate is made on You're all set; the backup key is a row there and in Storage and backups; each person's own recovery stays in their own setup.
- **ROLE-LABEL-01 ("Main admin") and ROLE-ADMIN-01 (one word "Admin")** from earlier revisions of this note. Both dropped by your ruling: owner and admin stay as the code has them.
- **THIN-4G and SEARXNG-SET-05 are reused, not replaced.** THIN-4G's one setting and save-time check is the "Use my own SearXNG" option; SEARXNG-SET-05 is the Web search settings page, with the parts listed under "Settings counterpart: Web search".
- **The earlier draft of this note:** its "8 GB red line" and floor plan, its install-time early download, its offer-or-code question for other devices, and its "owner" copy.
- Nothing else. SETUP-SIZE-01, SETUP-START-01, STACK-START-01, INSTALL-PREFLIGHT-01, INSTALL-RESUME-01 and DATA-LOCATION-01c stand and are reused.

## Backlog rows to file

**Revision 5 files nothing.** These rows are proposals for the coordinator; none is in `docs/BACKLOG.md` from this note. Revision 5 changes the scope of some, listed here so they are filed in their revised form:

- SETUP-FLOW-01: screens 1 to 11 (10 until the new-person flow exists), three phases (Your computers, Away from home, Meet your Home), new screens 2 and 3 reusing the engine-link pairing part and DATA-LOCATION-01c's storage part.
- SETUP-STATE-01: the step ids `welcome`, `engine_location`, `storage`, `checks`, `plan`, `away`, `owner`, `face`, `profile`, `hello`, `done`, and `checks` refusing before both questions are answered.
- SETUP-CHECKS-01: twelve rows (row 13 removed), check 4 on the screen 3 disk.
- SETUP-AWAY-01: becomes screen 6 plus the settings section: the self-ticking rows, "Turn on" with `tailscale cert` and Home serving the `ts.net` name, renewal, the QR, "Set up later" and its checklist item, the CT-log notice; it settles the UNVERIFIED points (App Store build, two certificates on one server, the status fields, tailnet reach with the internet down).
- SETUP-HTTPS-01: the household certificate stays, as the fallback; the loopback listener must survive TLS turning on during setup.
- New proposal, SETUP-PREVIEW-01 (M, after SETUP-FLOW-01): preview mode as in "Preview mode", with the scenarios, the bar, the bundle-absence gate test, the zero-requests test, and the screenshot script reading the scenarios.


- **UI-DECISIONS-01: create `docs/design/UI-DECISIONS.md` with the `alert` and `carousel` rows** (S, docs). Who decided, why no kit part does it, which registry. This is the precondition of KIT-ALERT-01 and KIT-CAROUSEL-01, and the guided-tour note adds a `tour` row in the same commit.
- **KIT-ALERT-01: add the shadcn `alert` to commons ui** (S, after UI-DECISIONS-01).
- **KIT-CAROUSEL-01: add the shadcn Carousel (Embla, autoplay) to commons ui** (S, after UI-DECISIONS-01). Precondition: the UI-DECISIONS row is committed first. Includes the pause button, reduced motion, carousel ARIA, and new props only (never changing existing ones).
- **SPEC-SETUP-STATE-01: setup state and hero slide schemas, plus the network keys and area, in commons spec** (S, first).
- **STACK-LEVELS-01: the `level` field on Stack tiers, and graphics-memory thresholds aligned with Recommended, Moderate and Minimal** (S, Stack repo, after open question 2). Includes fixtures for a two-card 16 GB box, a single 8 GB card, an Intel Mac and a 24 GB Mac.
- **SETUP-LOCAL-ONLY-01: setup and owner-account routes answer only on loopback, never via forwarding headers; the "finish on the computer itself" page** (S, medium review: auth route). Tests for every case in the note.
- **SETUP-STATE-01: `GET /api/setup/state` and `POST /api/setup/:step` on the new step ids** (M, after SPEC-SETUP-STATE-01 and SETUP-LOCAL-ONLY-01). Server-side resume, repeatable steps, session storage removed.
- **SETUP-FLOW-01: the three-phase wizard on the kit Wizard** (M, after SETUP-STATE-01). Screens 1 to 11, stubs removed, hand-built fields replaced, the owner copy and the owner-and-admin card.
- **SETUP-CHECKS-01: the Checks screen on INSTALL-PREFLIGHT-01's list, judged on the engine computer** (M, after INSTALL-PREFLIGHT-01 and STACK-LEVELS-01). Twelve rows on the screen 3 disk, moves on by itself when green, starts the downloads every plan needs on pass, results go to Health.
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
- **SETUP-SEARCH-01: web search row 12 and the plan line** (S, after SETUP-CHECKS-01; uses `checkSearchInstance` in SEARXNG-SET-03, never a second checker). A candidate URL skips cache and Repairs; detection does not write `search.searxng_url`. Detect loopback ports 8888 and 8080 only. A found instance is offered; only "Use it" writes the setting through the loopback-only setup route and shared settings writer. Never red. Remote engine: no engine-computer probe or Stack route; file a Stack-side probe item. Regression: detection alone leaves the key empty. No network scan. Custom card follows SETUP-SIZE-01 and THIN-4G; Change and own-SearXNG save-time check are out of scope here.
- **SETUP-SEARCH-REMOTE-PROBE-01: Stack-side search probe for a remote engine** (S, after STACK-SEARCH-01). The hub cannot reach the remote engine computer's loopback. Add a Stack-side probe through the Stack's supported interface; do not scan the network. Reuse the one SearXNG checker semantics without adding a second Home checker.
- **STACK-SEARCH-01 amendment (Stack repo): the homelab-proven defaults** (S, docs, before STACK-SEARCH-01 is dispatched). JSON format on, limiter with loopback pass, IPv4 preference without a global IPv6 route, the curated and `keep_only`-pinned engine set, warm-up query after start, no query logging proven by a log test, pinned updates with rollback, search forwarded on the Stack's own API so the engine link stays one port. The SearXNG Python packages are hash-locked, and the `/stack/v1/privacy` rows for every fetch host (the PyPI index and file host, the release host) land in the same commit.
- **SEARCH-HEALTH-BANNER-01: the search health state shows as a banner when web search is off or down** (S). A kit `Alert` or the existing banner, above the thread, never fixed wording inside the reply (rule 6); the reply stays the model's. Check SEARCH-HEALTH-02 and KS-MODE first; add only what is missing. Regression test: search down, the answer arrives model-worded and the banner shows.
- **SETUP-AWAY-01: screen 6 and Network and access, "Away from home"** (M, after SETUP-NETWORK-01, medium review: TLS and exposure). `network.tailnet_access`, the self-ticking rows from `tailscale.ts`, "Turn on" with `tailscale cert`, renewal, the QR, "Set up later", the privacy row, the Headscale line, the checklist item. No list of other people's devices (rule 6a). Home never installs Tailscale.
- **ACCOUNT-AWAY-DEVICES-01: each person sees their own devices that signed in from away, in their own Account** (S, after SETUP-AWAY-01). Never on an admin page.
- **SETUP-FUNNEL-01: a red Repairs item when Funnel exposes the hub's port** (S, waits on open question 5; medium review: exposure).
- **SETUP-ENGINE-TAILNET-01: the Tailscale rows of check 10** (S, after SETUP-CHECKS-01). The `allow_tailnet` prompt, peer online, relay versus direct, the link's own 500 ms degraded threshold. Fixtures from synthetic `tailscale status --json` output.
