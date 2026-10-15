# Setup wizard: a Home page and an AI page (2026-10-15)

Status: draft, waiting for the architect ruling. Delta on [install-wizard-2026-10-13.md](install-wizard-2026-10-13.md); anything not named here stays as that note says.

## Supersedes

From [install-wizard-2026-10-13.md](install-wizard-2026-10-13.md), this note replaces only:

- the screen list for screens 2 to 5 ("Where Home's AI runs", "Where files are kept", "Checks", "Your plan"): they become page A (Your Home) and page B (Your AI), and "Your plan" is no longer its own screen;
- the single checks grid of screen 4: one grid per page;
- the "Install" button on the plan screen: it moves to page B.

Everything else in that note (the install strip content, hardware levels, screens 6 to 11, the Tailscale and web search chapters) stands.

## What Jesse proposed (2026-10-15)

1. Split the middle of setup into two pages: **Home** (its folder and its health checks) and **AI** (its folder, the model plan and its health checks).
2. The AI page changes when the person chose two computers.
3. Models do not download on a page. They download in the background with an indicator and progress in the footer, so the person goes straight on to the owner account and the face step.
4. If the person finishes those first, Home opens with the progress visible. Clicking it opens the details in Home settings. Anything that needs the AI is disabled until install is done.

Answers Jesse gave: a hardware sizer chooses the models (no per-model picking on the page); while downloads run, only what needs the AI is disabled.

## What already exists

Most of this is already designed and partly built, so this note changes the page split, not the mechanics.

- Background downloads, the install strip with Details, the stalled, out of space and starter-ready states: "Background downloads while the person sets up" and "The Install phase" in the 2026-10-13 note.
- The hardware sizer: "Hardware levels and sizing" (Recommended, Moderate, Minimal, below Minimal refused). The Stack reports hardware and proposes the tier; Home words it. "Choose for myself" stays a collapsed option on the plan card, not the default path.
- Face and account while downloads run: screens 7 and 8 of the 2026-10-13 flow.

## What changes

| Today (2026-10-13 flow) | Proposed |
|---|---|
| 2 Where Home's AI runs, 3 Where files are kept (one folder step), 4 Checks (hub and engine mixed), 5 Your plan | **Page A, Your Home:** the Home folder, then Home's checks (home network, internet, this computer's disk). **Page B, Your AI:** where the AI runs (one or two computers), the AI folder, the sizer's plan, then the AI's checks. |
| One checks grid for both roles | Two grids, one per page, each tile green, amber or red. No engine tile before the engine is installed (shipped 2026-10-15, `ad8324d1`). |
| Plan screen holds the Install button | Install starts the downloads and moves on at once. No page waits for a model. |

**Page B on one computer:** folder (default beside Home's data), plan card with the sizer's recommended level, checks (this computer's memory and platform, internet). **Page B on two computers:** the engine link first (address, Tailscale pairing), the folder is chosen on the AI computer (native window there, or the in-page picker), the plan is the level the engine computer can carry, and the checks add the engine link and the Tailscale rows. The folder, plan and checks all describe the AI computer, so the page titles say "your AI computer".

**Order.** Page A, page B, then account, face, the rest of the profile, Hello. Downloads begin the moment page B's checks pass and the person presses Install; every later page carries the footer strip.

## While downloads run

- Install strip: on every wizard screen it sits in the wizard footer (the wizard is not an app page). After setup the shell shows the install inside the existing S1 main navigation, with no new rail item and no label on the rail: on the rail (640 and up) a progress ring on the profile control, with percent and time left in its accessible name and tooltip; "Details" is an entry in the profile menu next to System status, opening Home settings, AI. On a phone (below 640, no rail) the same entry sits in the drawer's profile and status foot. No app draws a copy (S2). Tests (S3): the navigation renders at 640 and up and below 640 with an install running, the ring has the accessible name, and the Details entry opens the settings page. Built from kit blocks (rule 9b).
- Details opens Home settings, AI, with one row per file (the existing Sheet content).
- Disabled until install and engine are ready, by an explicit route list (written into the build step, not "anything that calls the engine"): chat turns, voice (speech to text and text to speech), Incognito, image and music generation, and the coding and vision tools. The list is one definition in the backend, read by the shell. A child's or teen's protections never weaken because the AI is down: a disabled feature stays disabled for them, and nothing falls back to an ungated path. Each shows "Home's AI is still installing" with the same progress and a link to Details. Enabled: people, profiles, files, settings, backups, Repairs.
- Starter model ready first: chat turns on at the starter, the strip says the full model is still coming (existing state).

## Open items for the architect

1. Does the two-page split keep RULES.md's rule that a feature is a catalog package and the setup flow stays hub-owned? (No new package expected.)
2. The 2026-10-13 note's "Your plan" screen merges into page B; confirm no rule requires it to be its own screen.
3. The gating contract: the route list above, sourced from the engine health item setup already stores, not a second flag. The architect confirms the list is complete and the child and teen rule holds.

## Build steps (after the ruling)

1. Wizard step list and routing: split `storage` and `checks` into Home and AI variants; fixtures and `SetupWizard.test.tsx`.
2. Backend `routes/setup.ts`: run Home checks and AI checks separately (`runSetupChecks` gets a role argument), record both.
3. Install strip footer on all wizard screens; move Install to page B.
4. App-wide gate: shell reads the install state, disables the AI features with the strip text.
5. Screens by script, opened and judged; walk the two-computer flow end to end.
