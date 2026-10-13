# Show me around: guided tours for Home and its packages (2026-10-13)

For Jesse. This is a draft design note, revision 4. It applies your answers from 2026-10-13 (including yes to children's tours in kid wording, your owner and admin ruling, and your ruling that Tailscale is a setup step, which changes the shell tour's chat line) and the architect's fixes. The architect's second verdict on `GUIDED-TOUR-01` is APPROVED; its one advisory, moving the auto-start switch out of Notifications, is applied.

The note covers three things:

- how Home points out where things are the first time a person opens a place
- how any catalog package adds its own short tour without a change to Home's code
- how a person turns tours off or brings one back

It follows the install wizard note (`docs/plans/install-wizard-2026-10-13.md`). That note's last screen opens Home, and Home's own first tour starts.

## The name

**"Show me around"** is what people see. It is the entry in the profile menu's Help. Inside the code and the spec it is a **tour**.

**Why this name:**

- "Tour" alone reads as a product-marketing word.
- "Walkthrough" and "onboarding" are jargon a busy parent does not say.
- "Show me around" is what a person says to a friend in a new house. It passes the dad test, and it works as a menu entry and as a spoken request ("show me around chat").
- "Tips" was rejected because Apple's TipKit uses it for single hints that appear on their own. That is a different thing, and we may want it later under that name.

## The promise

- **Short:** three to five steps, each one or two sentences.
- **Starts by itself, once per person,** the first time they open that place (your decision, 2026-10-13).
- **Easy to leave:** Skip is on every step, and Esc closes the tour.
- **Never comes back by itself:** every way out (Done, Skip, Esc, clicking the dark area, leaving the page, closing the tab) counts as seen.
- **Brought back on request:** "Show me around" in the profile menu's Help lists the tours for the current page.
- **Real things only:** it points at the real control on screen, not a picture of it. If the control is not there, the step is skipped quietly.
- **Kids and teens** get their own wording and never see steps about things they cannot use.

## Research and standard parts

### What the research says

| Finding | Source (read 2026-10-13 unless marked) | What we do with it |
|---|---|---|
| Tutorial decks shown before use did not raise task success and made tasks feel harder. People skip them. | NN/g, "Mobile Tutorials", 2020-03-08, https://www.nngroup.com/articles/mobile-tutorials/ | No deck before use. A tour runs on the real screen, in context, and Skip is always one press away. Starting by itself is your decision. The research's warning is met by keeping each tour short and one place at a time. |
| Teach in context, at the moment it matters, and keep onboarding skippable. | Apple HIG, "Onboarding", https://developer.apple.com/design/human-interface-guidelines/onboarding (page did not render; from general knowledge: UNVERIFIED) | A package's tour runs when its page first opens, not at hub setup. |
| TipKit shows tips when rules say so, no more often than a set frequency, and a dismissed tip stays dismissed. | Apple TipKit, https://developer.apple.com/documentation/tipkit (page did not render; from general knowledge: UNVERIFIED) | A step's `condition` is data. A tour runs once per person per version. |
| Material "feature discovery" highlights one control at a time, with a short title and body. | Material Design, https://m2.material.io/design/communication/onboarding.html (page did not render; from general knowledge: UNVERIFIED) | One highlighted target per step, never several at once. |
| Hotspots (a small pulsing dot the person can open when curious) interrupt less than a forced tour. | Vendor comparisons, e.g. Userpilot and Chameleon product-tour guides (not authoritative, read 2026-10-13) | Not in the first version: it is one more thing on screen for a family. Open question 2. |
| Show a little and defer the rest (progressive disclosure). | NN/g, https://www.nngroup.com/articles/progressive-disclosure/ (not fetched: UNVERIFIED) | Each tour covers one place. There is no "tour of everything". |

### The libraries, compared

Versions and dates come from the npm registry, read 2026-10-13.

| Library | Version, date | License | React fit | Custom tooltip (so we draw it with kit parts) | Accessibility | Missing target | Verdict |
|---|---|---|---|---|---|---|---|
| React Joyride, https://github.com/gilbarbara/react-joyride, docs https://react-joyride.com/docs | 3.2.0, 2026-07-09 | MIT | Native React, `useJoyride` hook | Yes: `tooltipComponent` receives render props (step, index, size, and the back, primary, skip and close props) | Focus trap, Esc to close (`dismissKeyAction`), tooltip role `alertdialog` | Emits `error:target_not_found` after `targetWaitTimeout`, then moves on | **Recommended** |
| Driver.js, https://github.com/kamranahmedse/driver.js | 1.9.0, 2026-10-03 | MIT | Framework-free, imperative | Partly: a popover class and an `onPopoverRender` hook to change its DOM | Keyboard controls; ARIA less complete (from its docs; depth UNVERIFIED) | A callback can skip the step | Runner-up: small and active, but we would draw the popover by changing its DOM, which fights rule 9 |
| Shepherd.js, https://github.com/shipshapecode/shepherd | 15.3.0 | AGPL-3.0 or a paid commercial license | React wrapper | Its own popover, themed by CSS | Good keyboard and focus support | Configurable | Rejected on fit, not license. Its popover is its own markup. We are AGPL-3.0, so the license itself is compatible. |
| Intro.js, https://github.com/usablica/intro.js | 8.6.0 | AGPL-3.0 or commercial | Imperative | Its own markup, themed by CSS | Fair | Configurable | Rejected: the same markup problem, and an older design |
| Reactour (`@reactour/tour`), https://github.com/elrumordelaluz/reactour | 3.8.0, 2025-05 | MIT | React | Yes, `ContentComponent` | Fair | Weaker | Rejected: no release in over a year |
| Onborda, NextStepjs | | | Needs Next.js | | | | Rejected: Home is Vite, not Next |

**Recommendation on merit: React Joyride v3.** It is maintained, MIT-licensed and made for React. It is also the only one that hands us the step data and button handlers and lets us draw the bubble entirely with our own parts. That last point is what makes it fit the rules rather than merely tolerate them.

**Checked against the rules:**

- **Org principle 6 (prebuilt over hand-built).** Joyride does the hard parts: positioning, scrolling the target into view, the overlay cut-out, the focus trap, and waiting for targets. We write no positioning code.
- **Rule 9b (shadcn from `@maipai/ui/src/ui/*` is the only source; a missing part is added to the kit with a row in `docs/design/UI-DECISIONS.md`).**
  - Home never imports Joyride.
  - A new commons primitive, `Tour` (`commons/ui/src/primitives/Tour.tsx`), wraps Joyride. It passes Joyride a `tooltipComponent` built only from the kit's `Card`, `Button` and `Progress`, styled by tokens.
  - Home renders `<Tour>` with data.
- **Precondition of KIT-TOUR-01: the UI-DECISIONS row comes first.**
  - `docs/design/UI-DECISIONS.md` does not exist yet. The install note's UI-DECISIONS-01 creates it with the `alert` and `carousel` rows, and the `tour` row is added in the same commit.
  - The row says what is added: the `Tour` primitive on React Joyride 3.2.0, through the package manager with the lockfile.
  - It says who decided: Jesse, by approving this note, with the architect's verdict on file.
  - It says why this is the only option: the shadcn registry has no tour or coachmark part (checked 2026-10-13); Kibo UI was not checked (UNVERIFIED, to confirm in the row before it is committed); and the table above shows no other library lets the kit draw the bubble.
  - KIT-TOUR-01 is not dispatched before that row is committed.
- **Download, don't vendor.** Joyride comes through the package manager in commons, with the lockfile.

The kit already has everything the bubble needs. The only new kit pieces are `Tour` itself and, shared with the install note, `Carousel`.

## Declaring a tour

A tour is data in a package's manifest, so Home's own shell and a catalog package declare tours the same way.

**Spec first.** `contributes.tours` is added to `commons/spec/schemas/manifest.schema.json`, beside `settings_area`, `widgets` and `pages`. A new `tour.schema.json` validates it.

```json
"contributes": {
  "tours": [
    {
      "id": "chat.first-run",
      "version": 1,
      "title": "Show me around chat",
      "starts_on": "page:chat",
      "audience": ["adult", "teen", "child"],
      "steps": [
        {
          "id": "composer",
          "target": "chat.composer",
          "title": "Ask anything",
          "body": "Type or talk here. Your words stay on this computer.",
          "body_by_audience": { "child": "Type or talk to Home here." },
          "placement": "top",
          "order": 10,
          "condition": { "roles": ["adult", "teen", "child"] }
        }
      ]
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `id`, `version` | Unique within the package. Raising `version` starts the tour again once for people who saw an older one, for a changed screen, never for a typo fix. |
| `title` | The tour's name in the "Show me around" list. |
| `starts_on` | The page or app id whose first open starts the tour. If absent, the tour runs only on request. |
| `audience` | Which age bands may see it at all. |
| `steps[].target` | A stable id, e.g. `chat.composer`. Kit Elements and primitives carry it as `data-tour`, through the `tourId` prop (see "How targets get their ids"). Never a CSS class or a text match. Absent only on a centred step. |
| `steps[].hero_slide` | Optional, on a centred step with no target. Names a hero slide by id, e.g. `hero.privacy`, from the install note's `frontend/src/content/hero.json`. The step then shows that slide's picture, heading and text, so the words exist in one place (org principle 4). |
| `title`, `body` | Final copy, one or two short sentences. A step with `hero_slide` leaves these out. |
| `body_by_audience`, `title_by_audience` | Optional wording for `teen` or `child`. If absent, the adult wording is fine for them. |
| `placement` | `top`, `bottom`, `left`, `right`, `auto`, or `center` (the step with no target). On a phone every step is `bottom` (see below). |
| `order` | Sort position, in gaps of 10 so a package can slot steps in. |
| `condition` | Everything listed must hold. A step whose condition fails is dropped before the tour starts. See the list below. |

The `condition` keys:

- `roles`: person roles.
- `setting`: a key and value, e.g. Incognito available.
- `capability`: a hub capability, e.g. `voice`.
- `surface`: `desktop` or `phone`. Tours never run on `tv`.

The shell's own targets (the rail, the profile menu, the More menu) are declared in Home's built-in manifest, the same way. A package may target only its own elements, plus one shell target it is given: its own rail entry (`rail.<package-id>`). This stops one package from steering people through another.

**Copy rules for package tours.** These are checked at catalog review, and lint-checked by the spec validator where it can:

- at most five steps
- a title of at most 40 characters, a body of at most 140
- no em dashes
- no links out
- no promotion of another package or a paid service

### How targets get their ids (rule 9c: additive commons props first)

Rule 9 forbids Home from adding attributes to a kit Element's parts or wrapping one. So the id must arrive through the kit:

1. **Commons first.** Every kit primitive and Element part that a tour may point at gains one optional prop, `tourId?: string`. It renders `data-tour={tourId}` on the part's root and nothing else. It is additive: no existing caller changes, and nothing about shape, spacing or style is touched. This lands in a commons ui tag before any Home change (TOUR-TARGETS-01).
2. **Then Home** passes `tourId="chat.composer"` and the like, where it already renders the Element. There is no wrapper and no `className`.
3. **Packages** build their pages from the same kit parts, so they pass `tourId` the same way.
4. **The lint.** ELEMENTS-LINT-02 and 03 already refuse wrappers and restyles. A raw `data-tour=` attribute on a kit Element in Home fails the same lint, so the prop is the only path.

## Running a tour

1. **Starts by itself.** The first time a person opens a page that a tour `starts_on`, with no completion record for that tour and version, the tour starts after the page has finished loading and the person's records have been read. It never starts while a dialog is open, never interrupts typing, never starts a second tour on the same page open, and waits at least 1 second after the page settles.
   - If two tours start on the same page, the shell's own tour goes first. The next one waits for the next time that page is opened.
2. **The tour.** Each bubble is a kit `Card` drawn by the kit `Tour`: the title, the body, a small `Progress` showing "2 of 4", and Back, Next (Done on the last step) and Skip. Skip is on every step, the first included.
3. **The end.** Done, Skip, Esc, clicking the dark area, leaving the page and closing the tab all write the completion record. Only Done is `completed`; the others are `skipped` or `dismissed`. Every one of them stops the tour from starting by itself again. This is the old Loki Doki tour's "every dismissal marks it done" rule, kept.
4. **On request.** "Show me around" sits only in the profile menu's Help (RULES.md S2: global things live in the main navigation, and an app never draws a second copy). It lists the tours available on the current page, then a "Your Home" entry for the shell tour. An app's own header has no tour entry. Starting a tour on request ignores the completion record and only updates its `at`.
5. **Turning them off.** In Account, Appearance (the person's own settings), one switch: "Start tours automatically" (person scope, default on). Off means no tour starts by itself; "Show me around" on request still works.

**After setup.** The install wizard's last button, "Open my Home", opens Home, and the shell tour starts by itself like any other first open.

## Completion record

One per person, in spec shape. **Spec first:** `tour-progress.schema.json` in commons.

| Field | Meaning |
|---|---|
| `id` | Record id |
| `person_id` | Whose record |
| `tour_id`, `package_id`, `version` | Which tour |
| `status` | `completed`, `skipped` or `dismissed` |
| `step_reached` | The last step id seen. Used for the counter below, never to resume half a tour. |
| `at` | When |
| `source` | Provenance: `hub`, or the id of the device that showed it |
| `hlc` | Clock stamp, so a second screen or the robot sees the same state through the oplog |

The switch is a settings key, `tours.autostart.enabled`. It is person scope, declared once in `commons/spec/settings/keys.json`, with `lives_in` the account Appearance area (`commons/spec/settings/areas.json`).

Records follow the person: a tour seen on the laptop does not start again on the phone. Deleting a person deletes their records. Incognito makes no difference, because tours are not conversation content.

## Accessibility, phones, look

- **Starting by itself, accessibly:** when a tour starts, focus moves into the bubble, and the bubble's title is announced as a dialog ("Show me around chat, step 1 of 4"). Skip is reachable with one Tab. When the tour ends, focus returns to where it was before.
- **Keyboard:** Tab moves between Back, Next and Skip inside the bubble. Focus is trapped in the bubble while it is open. Esc closes the tour, and Enter on Next advances.
- **Screen readers:**
  - The bubble is a dialog (Joyride's `alertdialog` role), labelled by its title and described by its body. "Step 2 of 4" is read with it.
  - The highlighted control is named in the body text, not only shown, so a person who cannot see the highlight still knows where it is.
- **Reduced motion:** with `prefers-reduced-motion`, there is no scrolling animation and no fade. Joyride's own handling of this is not confirmed (UNVERIFIED), so the kit primitive turns its animation options off itself when the media query matches.
- **Phones (below 640 px):**
  - Every bubble is placed `bottom` and spans the width minus the 16 px gutter, so it never covers the target and never needs sideways scrolling.
  - A target inside the closed drawer (S1: the rail is a drawer on phones) opens the drawer for that step and closes it after.
  - Targets that do not exist on a phone are skipped.
- **TV:** no tours. The surface check in `condition` drops every step.
- **Look:** tokens only, through the kit `Card`, `Button` and `Progress`. The dark overlay uses the kit's overlay token. Home sets no colour, radius or spacing.
- **Missing target:**
  - If a step's target does not appear within about 1 second (`targetWaitTimeout`), the step is skipped and the tour continues.
  - If no step can show, the tour ends without writing a record, so it can start again when the page is right.
  - Each skip adds to a counter per tour and step (`tour_target_missing`). The counter is kept locally with the other health counters and shown to the owner and admins under Health, so a package with a broken tour is visible, not silent. This follows the counter-and-row rule in `docs/RULES-AND-LEARNED-COMPONENTS.md`.

## Kids and teens

- A tour is never shown to an age band missing from its `audience`.
- A step whose `condition.roles` excludes the person is dropped. Things for the owner and admins only (Home settings, unrestricted mode, the Store's install button) never appear in a child's or teen's tour.
- `body_by_audience.child` gives shorter, plainer wording. A package that lists `child` in `audience` must give child wording for any step that mentions settings, privacy or other people; the validator rejects it otherwise.
- A hero slide step shows to a child or teen only if the slide's own `audience` is `all`.
- Tours never collect anything from the person and never open a link, so there is nothing for the output gate to check. The copy itself is reviewed at catalog review, like any package text.
- The owner or an admin can turn automatic tours off for a child from the child's settings, using the same `tours.autostart.enabled` key. They reach a child's settings, never a teen's (the 2026-09-30 ruling).

## Catalog packages get tours with no Home change

Because a tour is manifest data and the runner is one shell feature:

- A package adds `contributes.tours` and passes `tourId` on its own kit parts. That is all.
- Home reads tours from installed manifests on the same path it reads `contributes.pages`. The Help list shows them, and completion records carry the `package_id`.
- Uninstalling a package removes its tours from the list. The completion records stay (they are small and harmless) until the person is deleted.
- A package update that raises a tour's `version` starts it once more.

## Three example tours, final copy

"Owner" is the person who set Home up and runs its core; an "admin" is a trusted helper the owner adds. See the install note, "Owner and admin".

### 1. Your Home (the shell, started on first open after setup)

| # | Target | Title | Body (adult) | Body (child) |
|---|---|---|---|---|
| 1 | `shell.rail` | Everything is here | "Chat, your apps and your family's things all live in this column. It stays put wherever you go." | "All your places are in this column." |
| 2 | `rail.chat` | Talk to Home | With `network.tailnet_access` on: "Ask a question, plan a meal or get help with homework. Home runs in your house, so it works without the internet. With the Tailscale app on your phone, it works when you're out too." With it off (a "Set up later" household): "Ask a question, plan a meal or get help with homework. Home runs in your house, so it works without the internet." The step carries two body variants chosen by a `condition` on that key, the same mechanism step 4 uses. | "Ask Home anything here." |
| 3 | `shell.profile-menu` | Your profile | "Switch people, change how Home looks, or get help here. The owner and admins find Home settings here too. To see this tour again, choose Help, then Show me around." | "Change your colours or ask for help here." |
| 4 | `shell.setup-checklist` (condition: owner and admins only, and only while items are left) | A few things left | "When you have a minute, finish setting up here: add your family, choose where backups go, and anything else on the list." | (step dropped) |
| 5 | none, `placement: center`, `hero_slide: "hero.privacy"` | (from the slide) | (from the slide: "Nothing leaves your house", and its text) | (the same; the slide's `audience` is `all`) |

**Previewing it.** The install note's preview mode ends where this tour begins. The tour is previewed on the seeded demo household with its own replay (Help, Show me around), so it needs no fake shell.

### 2. Chat, with Incognito

`starts_on: page:chat`, for adults, teens and children. Children cannot use Incognito, so their tour drops step 3.

| # | Target | Title | Body (adult and teen) | Body (child) |
|---|---|---|---|---|
| 1 | `chat.composer` | Ask anything | "Type or tap the microphone to talk. Your words stay on this computer." | "Type or talk to Home here." |
| 2 | `chat.history` | Pick up where you left off | "Your past chats are listed here. Only you can see yours." | "Your old chats are here." |
| 3 | `rail.more.incognito` (condition: setting `chat.incognito.available` true; roles adult and teen) | Chat without saving | "Incognito chats aren't saved and aren't used to remember things about you. Find it under More." | (step dropped) |
| 4 | `chat.message.sources` (condition: only if the page has a cited answer) | Where answers come from | "When Home looks something up, the numbers link to its sources so you can check them." | "The little numbers show where Home found things." |

The Incognito key name comes from the chat design. If it differs at build time, the condition follows the real key (name UNVERIFIED).

### 3. People (the family page)

`starts_on: page:people`, adults only, because it is a place for the owner and admins.

| # | Target | Title | Body |
|---|---|---|---|
| 1 | `people.add` | Add your family | "Add each person once. Kids get safe answers by default, and you decide what they can reach." |
| 2 | `people.role` | Who can do what | "Adults can change their own things. The owner is in charge of Home and can add admins to help look after its settings. Teens and kids get their own protections." |
| 3 | `people.face` | Let Home know who's talking | "Each person can set up their face so Home greets them and keeps their things separate." |

## What we kept from the old tour

These verdicts come from the archived `loki-doki` repo (`components/onboarding/GuidedTour.tsx`, read only), under org principle 8.

| Old idea | Verdict | Why |
|---|---|---|
| Four concept cards in a centred dialog ("Welcome", "Your companion", "Everything in one place", "Safe for everyone") | Drop | It is a deck, the pattern NN/g found unhelpful. The ideas live on as hero slides (install note), one of which closes the shell tour, and as pointed steps here. |
| Started by itself on the home page once preferences had loaded | Keep | It is now `starts_on`, plus "wait for the person's records before starting". |
| Every way of closing marks it done | Keep | Kept exactly. |
| One preference flag, `onboarding.tour.completed` | Rebuild | It becomes a per-tour, per-version, per-person record in spec shape. |
| Reset from settings | Keep | It becomes "Show me around" in Help. |
| Hand-built dialog | Drop | Rule 9b. The kit `Tour` primitive draws the bubble. |

## Open questions for Jesse

1. **Hotspot dots (taste).** Should Home add small "something new here" dots that open a single tip? Recommended: not now. Revisit after families have used tours.

Your answers on offering versus starting (start by itself) and on children's tours (yes, in kid wording, adult steps removed) are applied above, and are no longer questions.

## Supersedes

- **Nothing current in Home.** There is no tour code, tour backlog row or tour key today (searched 2026-10-13). The archived repo's `GuidedTour.tsx` is reference only.
- **The earlier draft of this note:**
  - the offer card and the `offer` field
  - the per-app header menu entry, removed under S2
  - the `tours.offers.enabled` key, now `tours.autostart.enabled`
  - raw `data-tour` attributes in Home, now the commons `tourId` prop

## Backlog rows to file

- **UI-DECISIONS `tour` row** (S, docs). It goes into `docs/design/UI-DECISIONS.md` in the same commit as the install note's UI-DECISIONS-01 (which creates the file with `alert` and `carousel`). It names who decided, why no kit, shadcn or Kibo UI part does it, and the Joyride version. This is the precondition of KIT-TOUR-01.
- **SPEC-TOUR-01: `contributes.tours`, `tour.schema.json` (with `hero_slide` and the `center` placement), `tour-progress.schema.json` and the `tours.autostart.enabled` key in commons spec** (S). The validator enforces the step count, text lengths and child wording, and checks that a `hero_slide` id exists.
- **KIT-TOUR-01: the `Tour` primitive in commons ui on React Joyride v3, drawn with the kit's Card, Button and Progress** (M, after the UI-DECISIONS row). Covers reduced motion, phone placement, the missing-target callback, the centred step, and focus on start. Tested in the kit's own stories.
- **TOUR-TARGETS-01: the additive `tourId` prop on kit primitives and Element parts in commons, then the ids on the shell, rail, profile menu, More menu and chat Elements in Home** (S; the commons tag first, rule 9c). Includes a lint case refusing a raw `data-tour=` on a kit Element in Home.
- **TOUR-RUNNER-01: Home reads tours from manifests, starts them on first open, writes completion records and counts missing targets** (M, after SPEC-TOUR-01, KIT-TOUR-01 and TOUR-TARGETS-01).
- **TOUR-HOME-01: the shell tour, including the `hero.privacy` closing step** (S, after TOUR-RUNNER-01, SETUP-FLOW-01 and HERO-01).
- **TOUR-CHAT-01: the chat tour with Incognito** (S, after TOUR-RUNNER-01).
- **TOUR-PEOPLE-01: the People tour** (S, after TOUR-RUNNER-01).
- **TOUR-RELAUNCH-01: "Show me around" in the profile menu's Help only, listing the current page's tours, plus the "Start tours automatically" switch in Account, Appearance** (S).
