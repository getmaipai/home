# Stack-hosted screens inside Home (design note, 2026-11-25)

Item: STACK-HOSTED-UI-01. Status: proposal. Needs Jesse's answers in "Questions only Jesse can answer" before any build. No code in this note.
Architect gate (2026-11-25, a reviewer reading `.github/docs/ARCHITECT.md` and `RULES.md`, since no `architect` agent exists in this session): NEEDS-RULE-CHANGE, because the note touches rules 9 and 9b, S4 and C5. Those are listed below.

## Supersedes

Nothing yet. If Jesse approves, it supersedes, in this order:

- The per-feature forwarders and adapters of STACK-MODELS-HOME-01 (`routes/aiStack.ts`, `stackModelsClient.ts`, the Home copy of the kit's `StackModelsPage` wiring), deleted screen by screen after each embedded screen is proven.
- The sentence in [stack-home-connections-2026-11-25.md](stack-home-connections-2026-11-25.md) that gives Home "a forwarder (`/api/ai/stack/connections`) and an adapter": Connections would be the second screen served by the Stack instead.
- The Stack rule "its one caller is the paired Home" in one way only: the paired Home may also pass a signed assertion of who is asking (role, lane), still with no people stored in the Stack.

## Bottom line

Home can show the Stack's own screens by loading components the Stack serves, reached through one generic pass-through in Home that adds no per-feature code (recommended, option 4a), or by a sandboxed iframe of an embed route (option 1, the fallback). The relay replaces the per-feature forwarders (`routes/aiStack.ts` and its siblings) and the per-feature adapters (`stackModelsClient.ts`). Home keeps no copy of the screen code. It cannot reach the Stack without a relay at all, because the Stack listens on loopback only, so "no forwarder whatsoever" is not possible; "no forwarder per feature" is. Recommended first step: the Drives screen. The sections on the frame (options 1 to 3) were written first; option 4a was added the same day at Jesse's request and is the recommendation.

## What Jesse asked for

The Stack owns models, features, modes and connections. Home is a frontend for household users and should never mirror them: the same components and controls, hosted by the Stack, so Home hosts and keeps no copy of that code (memory: `feedback_stack_owns_models_features_modes`).

## What exists today

- The shared kit (`commons` `ui`, `src/stack/`: `StackModelsPage`, `StackDrives`, `StackClient` interface) renders in two places. The Stack admin page (`stack/admin-ui`, a static app served at `/admin`) and Home (`apps/settings/AiModelsPage.tsx`) each bundle their own copy and each write a `StackClient` adapter.
- Home's adapter (`frontend/src/lib/stackModelsClient.ts`, 45 lines) calls Home's forwarder (`backend/src/routes/aiStack.ts`, 129 lines, one route per Stack route). The forwarder checks the person with Home's rules (owner or admin, adult lane, `requireRole`), forwards to `/stack/v1/*`, writes one audit line, and on a change drops Home's picture, video, music and install status caches (`choicesChanged`).
- The Stack has no people. It accepts Home's paired token, or its own single admin session (argon2id password, 12 hour sessions, 30 minute idle). It listens on loopback only. A Home on another computer reaches it through an SSH forward (host key pinned in Home). Over Tailscale the Stack allows GET only.
- Home's page policy (`backend/src/middleware/pageCsp.ts`) is `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`, `connect-src 'self'`, `frame-src 'none'`. Nothing loads from another host (RULES, privacy).

## The constraint that shapes every option

A person's browser, often a phone, cannot reach the Stack. The Stack is on loopback of the Stack computer, and the SSH forward belongs to Home's backend, not to the browser. So every option below needs Home's backend to relay bytes between the browser and the Stack. The options differ in what runs in the browser and how much it trusts Home's page.

One generic relay, `/stack-ui/*`, does three jobs for every screen:

1. Decides whether this person may see or drive the screen (Home's gates, below).
2. Mints and attaches the assertion the Stack needs (below).
3. After any successful change (non-GET answered 2xx), writes the audit line and refreshes Home's status snapshot, replacing today's per-route `choicesChanged`.

Adding a screen adds no Home code. Home reads the Stack's embed manifest (below) and lists what it finds, filtered by role and lane.

## The three options

### 1. Iframe of a Stack-served embed route

The Stack serves each screen at `/embed/<screen>` (the same admin-ui build with the chrome hidden). Home renders `<iframe sandbox="allow-scripts allow-forms" src="/stack-ui/t/<ticket>/embed/drives">`.

- **Person and role.** Home's backend mints a ticket: a signed, short-lived (5 minute, renewed while the frame is open) statement of `{screen, role, lane, audience, actor}`, signed with the key Home already pairs with. The relay passes it upstream. The Stack's new embed guard accepts it in place of an admin session, for the named screen's API prefixes only, so the frame's scripts cannot reach any other Stack route. The sandbox has no `allow-same-origin`, so the frame cannot read Home's cookies or call Home's `/api`. The ticket sits in a path segment, never a query string, and the relay strips it from logs and from the `Referer` the frame sends, because a credential in a URL leaks (`docs/CREDENTIALS.md`). The ticket is why cookies are not needed.
- **Gates.** Enforced twice: in Home before the ticket exists (an adult admin only today, as `NOT_ADULT` does now), and again in the Stack, which refuses an embed request with no valid ticket. A child or teen lane never gets a ticket, so there is nothing to hide in the frame.
- **Theme and language.** CSS variables do not cross a frame. Home sends its tokens (a flat map of the semantic color, radius and font variables), the theme (light, dark), the locale and the reduced-motion flag by `postMessage` on load and on change. The embed route applies them to its root. Phone layout works because the frame is full width and full height of the page body; Home does not size it to content.
- **Tunnel and Stack-down.** The relay uses the same Stack client Home's backend already uses, so the SSH forward needs no change. If the Stack is unreachable the relay answers 503 and Home shows its own status card (RULES S6, the existing mechanism) instead of a frame. Home keeps a card, not a copy of the screen.
- **Versioning.** The Stack serves a manifest at `/stack/v1/embed/manifest`: screens, each with a `contract` number (the `postMessage` shape) and a title in a short form Home can show. Home supports a range of contracts. A screen outside the range is hidden from the menu with one sentence ("Update Home to open this screen"), and Home never loads it. Frame and parent talk only through the contract, so a Stack update can change the screen freely.
- **Privacy.** No new host. The frame loads through Home's own origin path; `frame-src` changes from `'none'` to `'self'`, and the sandbox plus the ticket keep it contained. No outbound connection.

### 2. Remote ES module or web component loaded from the Stack

Home does `import("/stack-ui/mod/drives.js")` and mounts a custom element or calls `mount(el, props)`.

- **Person and role.** Same ticket, but the code runs in Home's page, with Home's cookies and every Home route within reach. A script from the Stack is as trusted as Home's own code. The relay can still scope the Stack side, but nothing scopes what the script does to Home.
- **Gates.** Home's gate runs before import, as in option 1. Enforcement in the Stack is the same ticket check.
- **Theme and language.** Best of the three: custom properties and the document language flow in naturally, and Home's tokens apply with no message passing. The kit's classes need their stylesheet, loaded with the module; the cost is that styles from two builds can collide unless the element uses a shadow root (then the kit CSS is injected into it).
- **Tunnel and Stack-down.** Same as option 1, with one more failure: a half-loaded module. Home needs a load timeout and the same status card.
- **Versioning.** Two builds of React and the kit in one page unless Home shares its copy, and sharing couples the two release cycles tightly. A separate React copy costs about one extra bundle download per session and avoids the coupling. The `contract` number covers the mount API.
- **Privacy.** `script-src` stays `'self'` because the relay serves the module from Home's origin. But Home executes code it does not build, which widens what "shipped parts only" means for the page itself.

### 3. Module federation

Home's build declares the Stack's remote entry; the two builds share React and the kit at run time.

- **Person and role.** As option 2, in Home's page, with the added shared-singleton wiring.
- **Gates.** As option 2.
- **Theme and language.** As option 2 (shared document).
- **Tunnel and Stack-down.** The remote entry is fetched at start. A Stack that is down at boot can break more than one screen, so Home needs a lazy load and a fallback per remote.
- **Versioning.** Worst fit. Shared singletons must agree on a version range, and every Stack update that moves React, the kit or a router breaks the host at run time. Home's own build config would name the Stack's remote: that is a copy of knowledge about the Stack in Home, which is what we are removing.
- **Privacy.** As option 2.

### 4. Direct call: Home's page loads Stack components and the components call the Stack's own API

Added at Jesse's request (2026-11-25): Jesse sees performance and security risk in a frame. Here Home's frontend imports a Stack-served module (or opens a Stack-served shell page) and the module's own `fetch` calls go to `/stack/v1/*` with no Home forwarder in between. This is option 2 plus a rule for how the API calls travel. It has two ways to reach the Stack.

**4a. Pass-through in Home (same origin).** The browser calls `/stack/*` on Home. One Home handler, with no per-feature code, checks the request and forwards it to the Stack over the existing SSH forward. It serves the modules the same way (`/stack/mod/*`).

**4b. Expose the Stack to the browser.** The browser calls the Stack on the tailnet or the home network. Today's Stack rule forbids this (loopback only, no LAN exposure). It also fails on the facts: a phone away from home reaches Home but not the Stack's address, an https Home page cannot call an http Stack (mixed content), a TV client has no way to carry a Stack token, and the Stack would need its own CORS list, its own sign-in for every device and its own rate limits against the open network. It needs a rule change and still does not cover a person away from home. Rejected.

Only 4a is evaluated below.

- **How the browser reaches the Stack.** Through the pass-through, same origin, so no CORS and no Stack token in the browser. The browser holds only Home's session cookie. The handler is generic: it looks the request up in a scope table the Stack publishes in its manifest (screen, API path prefix, methods, lowest role, lane needed) and refuses everything not in the table. Adding a screen adds a manifest row, not Home code.
- **Role and age.** For each request the handler reads the person from Home's session, and signs a short-lived assertion (about 60 seconds, role, lane, audience, opaque actor label for audit) into a header on the upstream call. The Stack checks Home's signature and the scope, as in the ticket of option 1, but per request instead of per frame. The Stack still stores no person.
- **Token handling.** No token reaches the page. The signing key stays in Home's backend. Because the module runs in Home's page with the cookie, the handler also requires a same-origin custom header on every non-GET (Home's existing CSRF defence applies).
- **What Home still decides itself.** Sign-in; role; the adult, teen and child lane; which screens appear in the menu (from the manifest, filtered by role and lane); which paths and methods are allowed (the table, deny by default); who may use each level (`engines.<role>.tier.<tier>`); tool use by person; the audit line and the status refresh after a change; the chat lease. Home never decides what a model, drive or mode is.
- **Theme and language.** Native: Home's CSS variables and document language apply to the module's elements. The kit's stylesheet loads with the module; a shadow root avoids style collisions.
- **Tunnel and Stack-down.** The module import and each API call go through the same SSH forward. If the import fails Home shows its status card (S6); if a call fails the module shows the Stack's own sentence, as the page does today.
- **Versioning.** A `contract` number in the manifest covers the module's mount function and the shape of what it asks of Home (locale, tokens, a navigation callback). Home hides a screen whose contract it does not support. The module ships its own React copy (one extra download, loaded only when the screen opens), so the two release cycles do not share a library version.
- **Privacy.** `script-src 'self'` is unchanged because the pass-through serves the module from Home's origin. No outbound host is added.
- **Performance.** Compared with a frame: no second page boot, no second theme message, one shared network connection. Compared with today: one extra hop per call on the same computer (the SSH forward is already in the path), and one extra bundle the first time the screen opens.
- **Security cost, stated plainly.** The Stack's code runs with Home's cookie and can call any Home route as the person. A frame in a sandbox cannot. What contains it: the Stack is the household's own signed build, the same trust Home already gives the Stack's answers, and the pass-through's table limits what the person's role can do on the Stack side. It does not limit what a hostile module could do on Home's side. If Jesse wants that closed, the answer is option 1.

### Comparison

| | 1. Iframe | 2. Remote module | 3. Federation | 4a. Direct call, pass-through |
|---|---|---|---|---|
| Stack code runs with Home's cookies | no (sandbox) | yes | yes | yes |
| Home's tokens and language | by message | native | native | native |
| Update safety (Stack and Home separate) | contract number | contract number plus two builds | shared singletons, fragile | contract number, own React copy |
| Home build config knows the Stack | no | no | yes | no |
| Home code per feature | none | none | none | none |
| Stack token in the browser | no | no | no | no |
| Second app boot | yes | no | no | no |
| Phone layout | full-page frame | native | native | native |
| Smallest change in Home | frame, relay, CSP `frame-src` | loader, relay | build plugin, relay | loader, pass-through |

## Recommendation: option 4a, direct call through a generic pass-through

Jesse's performance and security concerns point the same way, and the facts support them for the common case. A frame boots a second app and needs its theme and language sent by message; option 4a has neither cost. The security difference is real (the module runs in Home's page), but the control that matters most, who may do what on the Stack, sits in the one pass-through and its scope table for both options. Take option 4a, with a shadow root and the module's own React copy. Keep option 1 as the answer for any screen whose code Jesse does not want in Home's page, and for a third-party Stack screen if one ever exists (the relay, assertion and manifest carry over unchanged). Federation (option 3) is out for coupling Home's build to the Stack. Exposing the Stack to the browser (4b) is out.

Everything below that was written for the frame (the ticket in the path, the sandbox) becomes a per-request assertion and a scope table under 4a. The first step, the Stack changes, the rules and the losses are otherwise the same; where they differ, the text says so.

### Smallest step that can ship first: Drives

Reason: it exists on both sides today (`StackDrives` in the kit), it is the screen with the most routes through the forwarder (list, features, plan, move, moves, cancel, add, remove), and the Stack admin already renders it. Modes can follow the same way once the Stack serves them. Steps, in order:

1. Stack: per-request assertion check scoped by the manifest's scope table, a module for Drives (mount function, own React copy, shadow root), manifest with one entry and `contract: 1`. Tests: no assertion, expired assertion, a path outside the table, a child or teen lane (refused).
2. Home: the `/stack/*` pass-through (session, call to the existing access check, assertion signing, scope table lookup, audit line, status refresh after a change) and one `StackScreen` loader (import, theme and language, status card on failure); the Drives section of the AI and models page renders it. Under option 1 this step is the relay, the ticket and a frame component instead.
3. Home: delete the Drives half of `stackModelsClient.ts` and the `/disks*` routes in `aiStack.ts` in the same commit that proves the screen works (RULES: port before delete).
4. Preview on desktop and phone width, light and dark, and with the Stack stopped.

Estimate: about two working days across Stack and Home for step 1 and 2 together, one more for deletion and previews.

## Home-owned pieces that stay native

The embed does not remove what needs people. These stay as Home components beside the frame: who may use each level (settings `engines.<role>.tier.<tier>`), the chat lease, the links to disk and backup pages, the key and host pin and tunnel status, and the age and surface gates themselves.

## What is lost versus today

- **Native feel.** Dialogs, toasts and focus stay inside the frame. A modal cannot dim Home's rail. Back and deep links need the contract (the frame reports its route, Home puts it in the URL hash).
- **Instant cross-screen reactions.** Today Home's forwarder drops its status caches in the same call. With the embed, Home relies on the relay's change hook and a refresh of the snapshot; a change made at the Stack's own admin page is noticed only at the next poll.
- **Per-route role and audit nuance.** The forwarder names each action ("remove model"). The relay can record only method, path and person unless the Stack names the action in its answer. Ask the Stack to return an action label header.
- **Home's own translations of the screen.** The screen's words come from the Stack's catalogs in the kit. Home must send its locale, and a locale the Stack lacks shows English.
- **Offline.** With the Stack down, the person sees a status card, not a read-only screen from Home's memory. That is the point of keeping no copy.
- **One forwarder for non-UI callers stays.** The turn engine and the jobs code still read the Stack's choices through Home's backend (E5). Only the UI forwarders go.

## Rule changes needed (only Jesse changes a rule)

**Stack (`AGENTS.md`, the connections and no-people rule).** The Stack accepts one more kind of caller credential: a ticket Home signs, carrying a role, a lane, an audience and an opaque actor label for audit, never a name. It is accepted for the embed routes only, scoped to one screen's API prefixes, short lived. "No people" still holds: the Stack stores no person and never decides who may act; it checks Home's signature and the scope. It also gains the embed routes and the manifest.

**Home `RULES.md`, Engine boundary.** Add a rule E9: Home shows Stack-owned screens only by embedding what the Stack serves through the one relay, and never writes a Stack screen, adapter or per-feature forwarder; an age or surface gate is decided by Home before a ticket exists. E5 stays as written (Home keeps no copy of a choice). The existing forwarders are retired by build rows, not by this note.

**Home `RULES.md`, App shell.** S6 gets one clause: a Stack screen that cannot open shows the existing status card with the Stack's sentence. S4 gets one clause: a settings area may name a Stack screen from the manifest instead of Home's own kit blocks, and the kit's `SettingsShell` still draws the area around it.

**Home `RULES.md`, chat rule 9 and rule 9b.** Rule 9b says nothing outside the kit renders UI in Home, and rule 9 says shipped parts only. A Stack screen is the same kit, built and served by the Stack, so the amendment is: UI the Stack serves from the pinned `commons` kit counts as the kit, loaded only through the relay, and Home still writes no wrapper or `className` on it. Without that sentence the earlier statement that rule 9 is untouched is wrong.

**Home `RULES.md`, Content filter and feature access, C5 and C7.** The relay is not a new decision. It calls the one existing check (the same function the forwarder calls today, `laneOfPerson` and the role guard) and adds no gate logic of its own. C5's list of four choke points gets a note that the relay is a caller of them, not a fifth, and a test proves it: the relay holds no age or role comparison.

**Not a rule change:** the page policy's `frame-src` under option 1 (a code change in `pageCsp.ts`, with its comment updated); option 4a leaves the policy as it is. The kit stays as it is, and the Stack hosts it.

**Backlog.** No STACK-HOSTED-UI-01 row exists in `docs/BACKLOG.md`. The row is added through the lander after Jesse answers, not by hand-editing here.

## Risks

- The frame needs a message contract kept stable and tested on both sides; a Stack update that breaks it hides the screen, which is the safe failure.
- Streaming (events) from the Stack through the relay needs proof; Drives needs polling only.
- The relay is a new place where an age or surface gate could be skipped. Test: every relay route refuses a child, a teen and an unsigned-in caller, and the test is generated from the manifest so a new screen cannot ship without it.

## Questions only Jesse can answer

1. May the Stack accept a Home-signed ticket (role, lane, opaque actor label) for embed routes only? This is the Stack rule change above.
2. Is one generic relay in Home acceptable, since the Stack stays loopback-only and the browser cannot reach it?
3. Which screen first: Drives (recommended) or Modes?
4. Today's audit line carries the person's Home id. Keep that, or send only the role to the Stack (the Stack would then log the role and screen)?
5. Do you accept option 4a, where the Stack's code runs in Home's page with the person's cookie, or do you want the sandboxed iframe for that reason?
