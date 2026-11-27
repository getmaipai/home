# One Stack section in Home Settings (design note, 2026-11-27)

Item: STACK-MENU-SYNC-01. Status: APPROVED by the architect 2026-11-27 (first ruling REJECTED on form, a missing Supersedes section; edits applied). Builds on [stack-owns-loras-2026-11-25.md](stack-owns-loras-2026-11-25.md), [stack-owns-model-choices-2026-11-21.md](stack-owns-model-choices-2026-11-21.md) and [stack-home-connections-2026-11-25.md](stack-home-connections-2026-11-25.md). It does not need the hosted-screen rule change in [stack-hosted-ui-2026-11-25.md](stack-hosted-ui-2026-11-25.md); that note stays open and can plug into the same tabs later.

## Supersedes

- The "Stack admin" card in `AiModelsPage` and Home's own placement of AI and models (`household.ai`, tab overview) and Styles (`household.media`, tab styles); both move to the Stack section with redirects.
- If [stack-hosted-ui-2026-11-25.md](stack-hosted-ui-2026-11-25.md) is accepted, its Stack manifest replaces `spec/stack/screens.json` as the one menu definition, so there are never two. Until then `screens.json` is the only one.

## What Jesse asked for (2026-11-27)

1. Home's Settings gets one left-menu item, Stack. Its right side has tabs that mirror the Stack admin menu one for one. A General tab says which Stack Home is connected to, whether it is healthy, a link to open it, and Manage buttons. One tab per Stack area follows (Models, Styles, Drives, Connections, Licences and the rest).
2. Home settings get their info from the Stack. No second copy, so the two cannot drift.

## What exists today

- Stack admin (`stack/admin-ui/src/App.tsx`) has 11 screens in three groups plus Helper: Overview, Health, Resources (Monitor); AI and models, Styles, Modes, Engines (Set up); Updates, Settings, Tools (Maintain); Helper (Assist). Drives, Licences and Connections are sections inside AI and models or not on a screen yet.
- Home scatters the same things. `household.ai` (tabs overview, engines, advanced, coding) holds AI and models (`AiModelsPage`, kit `StackModelsPage`) with a "Stack admin" link card (`StackAdminLink`). `household.media` (tabs pictures, videos, music, styles) holds the Styles tab (`StylesTab`, kit `StackLorasPage`). The engine link, pairing and the Hugging Face and Civitai keys sit in other cards.
- Settings areas are data in `commons/spec/settings/areas.json`, drawn by the kit `SettingsShell` (RULES S4). Legacy places redirect through `spec/settings/legacy-sections.json` and `settingsRedirects.ts`.
- Kit pages that exist in `commons/ui` `src/stack/`: `StackModelsPage`, `StackDrives`, `StackLicences`, `StackLorasPage` (each takes a `StackClient`). Overview, Health, Resources, Modes, Engines, Updates, Settings, Tools and Helper exist only in the Stack's `admin-ui`.

## Design

### 1. One menu definition, shared by both sides

The drift comes from two hand-written menus. Fix it by declaring the Stack's screens once, in `commons/spec` (new file `spec/stack/screens.json`): per screen an id, a label, the one-line question the admin already shows, a group, and `kit` (the name of the kit page that draws it, or null). The Stack's admin-ui `NAV` and Home's tab list are both built from this file. A test in each repo fails when its menu differs from the file. This is "one definition, one place" (platform principle 4). It is menu data (labels), not Stack state: it holds no model, drive, style or health value, so rule E1 is untouched.

Screens list (target, in menu order): Overview, Health, Resources, Models, Styles, Modes, Drives, Connections, Licences, Engines, Updates, Settings, Tools, Helper. Drives, Connections and Licences become their own entries in both menus, so Home mirrors the Stack and not a Home-only shape.

### 2. Home: the Stack section

`areas.json` gets a section `stack` (label Stack, left menu, after Household). Its tabs are General, then one tab per screen in `screens.json`. Shown to the owner and to admins in the adult lane only (the gate the forwarder applies today, `NOT_ADULT`); everyone else sees no Stack item. Per-person pages stay where they are: level access per person, the chat lease, coding settings, and the Pictures, Videos and Music cards for what a person makes.

**General** is Home-native, the one tab with no Stack twin. It reads the Stack's status through the existing health path (`lib/stackHealthSync.ts`, `/api/status`; no new copy) and shows: which Stack (name and where it runs: this computer, home network or tailnet, from the connection record), healthy or not in the shared status words (S6, existing status component), the Stack's version and the pinned Home version, a link to open the Stack admin (`StackAdminLink`, moved here), and Manage buttons. Manage buttons: Open Stack admin; Check now (re-reads health); Pair this Home or Remove the link (calls the Stack's `/stack/v1/connections`, per the connections note); Restart the Stack only through the Stack's own Tools screen link, not a Home action. Stack down: the existing status card with the Stack's own sentence, and every tab shows the same card instead of a stale page.

**Each other tab** renders what the screen's `kit` field names:

- Kit page exists (Models, Styles, Drives, Licences now): Home mounts that component with Home's `StackClient` over Home's pass-through (`stackModelsClient.ts`, `stackLorasClient.ts`), exactly as today. Home writes no wrapper and no `className` on it (rule 9). It receives no data except what the Stack answers per request.
- No kit page yet (Overview, Health, Resources, Modes, Engines, Updates, Settings, Tools, Helper, Connections): the tab shows the screen's title, its one-line question and an Open in Stack admin button. The button uses `StackAdminLink`: the Stack listens on loopback only today, so on the Stack's own computer it opens the local address, from another device the remote address when remote access is on, and otherwise it is disabled with the Stack's plain reason. A phone or tailnet browser therefore never gets a dead link. That is a link, not a copy. The stub is drawn only from shipped kit Elements (a kit empty-state block and button), with a row in `ELEMENTS-DECISIONS` for it, and it is how every tab exists on day one so the menu mirrors immediately.

### 3. Getting the missing screens in, without a rule change

Recommended: move each admin-only screen into `commons/ui` `src/stack/` as a kit page over `StackClient`, then mount it in both places. This is the pattern already approved for Models, Drives, Licences and Styles and needs no rule change. Order by use: Connections (needed by the connections note), Modes, Health, Overview, Updates, Engines, Resources, Settings, Tools; Helper last. Each is its own backlog row and its own build; a tab flips from stub to page by setting `kit` in `screens.json` and pinning the new kit tag.

Alternative: the hosted-screen pass-through (4a in the hosted-UI note). It would show every screen with no kit move, but it is NEEDS-RULE-CHANGE and a security call for Jesse. The tab slot is the same, so choosing it later changes only how a tab draws, not this design.

### 4. What happens to the old Home cards (port before delete)

| Old place | New place | When it goes |
|---|---|---|
| `household.ai` tab overview (`AiModelsPage`) | Stack, Models | Same commit that proves the Models tab shows the same screen (tests plus screenshots) |
| "Stack admin" card in AiModelsPage | General tab button | Same commit |
| `household.media` tab styles (`StylesTab`) | Stack, Styles | Same commit; the sources-and-keys list under it moves with it until the Connections tab lands |
| Engine link, pairing, Hugging Face and Civitai key cards | Stack, General (link status) and Connections | Per the connections and LoRA notes, when Connections is a kit page; until then they stay where they are |

Each old place becomes a redirect (`legacy-sections.json`, `settingsRedirects.ts`), so saved links and the search index keep working. The remaining `ai` tabs (advanced, coding) and `media` tabs (pictures, videos, music) stay: they are per-person or per-household Home settings, not Stack screens. If `ai` is left with one tab, the architect's S4 "one card per group" rule applies and the tab is folded in the same commit.

## Safety gates (all stay in Home)

- Age and surface: the Stack section is adult owner or admin only, own-written surface only. A teen, a child, a guest, a spoken turn, a glance screen and a TV never get the item, the route or any data.
- Adult-only styles: the Styles tab receives its data from Home's client with adult-only records already reduced to the one locked tile (no name, id or count) until the person's own unlock proof is valid, as in the LoRA note. Nothing in this design moves that redaction to the Stack or into the kit.
- Fail closed: Stack unreadable means no adult-only style is shown and the status card appears.
- Tests, generated from `screens.json` so a new tab cannot ship without them: every tab route refuses a child, a teen, a guest, a non-admin adult and a signed-out caller; the Styles tab with the adult lock closed shows no adult-only name; General shows the status card with the Stack stopped.

## Not a rule change

- S4: the section is declared as data in `areas.json` and drawn by `SettingsShell`. Home writes no settings layout.
- Rules 9 and 9b: only shipped kit components, unwrapped.
- E1 and E5: Home keeps no Stack data. The only new data is the menu (labels), in the spec, shared with the Stack.
- C5: no new choke point; the tabs call the existing forwarders and gates.
- RULES.md stays as is. Nothing here needs `Owner-approved`.

## Build slices (in order; shipping stays Jesse's word)

0. Spec: `spec/stack/screens.json` plus schema and test; `areas.json` `stack` section; redirects. Tag `spec`.
1. Stack: `admin-ui` builds NAV from `screens.json`; add Drives, Connections and Licences entries; drift test. Own worktree in the stack repo.
2. Home: Stack section, General tab, Models and Styles mounted, stubs for the rest, redirects, old cards removed in the same commit. Pin the spec tag. Tests as above. Preview at desktop and phone width, light and dark, Stack stopped, signed in as an owner, a teen and a child.
3. Per-screen kit moves (own rows): each ends with the tab showing the real page and the Stack admin using the same component.
4. Docs: the settings user doc (`user/`) and `docs/dev/module-map.md` updated in the same commits.

Order across repos: spec tag, then Stack, then Home. Estimate: slices 0 to 2 about two working days; each kit move about one day.

## Risks and doubts

- The menu file names Stack screens, which is knowledge about the Stack in the spec. Judged acceptable because it is presentation data owned by the same org and checked by tests on both sides; the alternative (Home reading the menu from the Stack at run time) makes the Settings menu disappear when the Stack is down.
- On day one most tabs are links, so the section is a mirror of the menu more than of the screens. Honest, and it makes the gap visible and ordered.
- The Stack's Drives screen is a section of AI and models today; splitting it changes the Stack's admin layout. Needs Stack-side agreement in slice 1.

## Questions only Jesse can answer

None blocking. Open choice for later: the hosted-screen route (4a) versus kit moves for the nine admin-only screens; this note proceeds with kit moves.

## Update 2026-11-27: built as 5 grouped tabs (Jesse's answer)

The settings spec caps a page at 5 tabs and the home list at 9 pages, so the 14-tab layout above was not built. Jesse chose 5 groups, the same in the Stack admin menu and Home: General (Home-native), Models (AI and models, Modes, Engines), Styles, Monitor (Overview, Health, Resources), Maintain (Updates, Settings, Tools, Helper). The Stack page replaces the old AI and models page in Home; Styles moved out of Media. The shared definition is `commons/spec/stack/screens.json` (`spec-v0.1.487`); the Stack admin menu (Stack `69636558`) and Home's tabs (Home `7847fb7e1`) are built from it, with drift tests. Drives, Licences and Connections have no screens of their own yet (Connections lands with its kit page). Open: a shared Stack-down card on every tab (only General has it).
