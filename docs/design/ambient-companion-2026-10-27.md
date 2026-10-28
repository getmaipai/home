# The ambient companion and the standard right pane (design, 2026-10-27)

Owner: Jesse. Mockup: [assets/ambient-companion-2026-10-27/mockup.webp](assets/ambient-companion-2026-10-27/mockup.webp) (Rivet in the top right of every app, hover preview,
pinned pane, per-app help, settings). This note replaces the bottom-corner launcher and the companion dock (`CompanionDock`, `companions.dock`) from
[companions-handoff-revamp-2026-10-26.md](companions-handoff-revamp-2026-10-26.md) section 5a. RULES.md S2 and S6 carry the owner-approved edit (Turn off and the spoken "Listening for" wording stay on the listening indicator; that clause was kept, not dropped).

## Supersedes

- `companions-handoff-revamp-2026-10-26.md` section 5a items 3, 5 and 6 (the `CompanionDock`, its hide-on-Chat rule, the bottom-corner shell mount).
- `wake-word-ux-2026-10-27.md` item 2 and Slice 2 (the indicator at the bottom corner with `LauncherBubble` `docked` as its home): the indicator is now the avatar's listening ring, or the top-right indicator alone.
- `wake-word-ux-2026-10-27.md` item 3 ("from any other page Chat opens with the call running"): a wake call opens the pane and starts the call there (AMBIENT-06a, `openChatWithCall`); Chat opens only when the companion is off.
- `companions-shared-chat-and-presence-2026-10-24.md` section 7 (launcher at the lower right, hidden on Chat).
- The dock half of REVAMP-PRESENCE-01 in the open COMPANIONS-REVAMP-01 backlog row, and the WAKEUX-02 row's bottom-corner placement.
- `ELEMENTS-DECISIONS.md` "not needed: `CompanionDock`" (the dock is retired by this design).
- Within this note (2026-10-27, after the first build): the pane's companion tab as "the same assistant-ui Thread and Composer as Chat" (section 2a and the AMBIENT-03 conditions) is replaced by the stage in section 2c; the thread lives in History and in Chat. The floating-only top-right avatar is replaced by the standard header row in section 2b.

## 1. What the person sees

1. **The companion, top right of every app header, Chat included.** A 32 to 36 px avatar. The selected app's own header buttons (settings, search, whatever that app has)
   sit to its left. One companion at a time: the person's default companion from settings, changeable from the pane.
2. **Ring states, real events only.** Dim and still while listening; a gentle ring while thinking; a ring while speaking; a subtle idle animation (setting). No count, no dot, no badge.
   Reduced motion draws the ring without animation. The states come from the one presence hook (`useCompanionPresence`, the same signals Chat uses), never a second resolver.
3. **Hover or focus shows a compact preview** (after about 300 ms): name, "Ready" only when it can answer, what it knows of the page ("You're on Models"), its last line, a quick Ask field with a mic, and the single
   Review button when a task of the viewer's own needs them. On touch screens there is no hover: a tap opens the pane directly.
4. **Click opens the standard right pane.** Pin keeps it open and it then behaves like the chat column (same width rules, same collapse on narrow screens), without a toggle button.
5. **What the companion said floats** beside the avatar for a few seconds (a speech bubble; it shortens only what is displayed, never what is generated) and is kept in the pane's History, so nothing spoken is lost.
6. **Per-page help.** The pane's Chat tab starts with what the page offers ("Help me with this page", "Find something", "Take an action", "Continue in Chat"). On Photos it sees the open photo
   ("find similar photos", "create an album"). Page context is a small typed object each app gives the shell (app id, route, one selected record id and title); it stays on the hub (local model) and is
   never stored beyond the side chat itself.

## 2. The standard right pane (kit Element, one for every app)

- **Nothing draws to the right of an app's content except this pane.** The chat artifact canvas, sources, details and compare views, and any app's own inspector, become tabs of it.
- **The companion tab is fixed and always first.** Its inner tabs (from the mockup): Chat, Activity, Memory, Settings. Other tabs are added by the app that needs them; when something opens
  (an artifact, a source list, a photo's details) the pane opens if closed, selects that tab, and the person can switch back to the companion at any time.
- **Header bar:** the tab's title on the left, the companion avatar fixed at the top right with the app's buttons to its left; pin and close at the right of the pane header.
- **Commons first.** The pane is a new kit Element (`RightPane`, tabs as slots, `pinned`, `open`, `activeTab`, `onTabChange`, `onPinnedChange`) plus a `CompanionPreview` Element for the hover card; Home passes data
  and handlers only (RULES.md rule 9). The header avatar uses the shipped `CompanionAvatar` with a new `ring` state prop.

## 2a. Reuse check (org principle 6, RULES.md rule 9b)

Considered and why each is or is not enough: the kit's shadcn `sidebar.tsx` (right-side, collapsible, pin-like: `RightPane` is built on it and `tabs.tsx`, not beside it); `popover.tsx` (hover preview needs hover and
focus open with a delay: the shadcn registry `hover-card` is added to the kit with a `UI-DECISIONS.md` row, then `CompanionPreview` composes it); `canvas-split` (shipped, used by Chat's artifact canvas: its renderer stays as the
artifact tab, the split itself is replaced by the pane); the unused `chat-panel` Element (a candidate for the pane's Chat tab body; the tab is the same assistant-ui Thread and Composer as Chat, not a mini chat);
`CompanionDock` and `LauncherBubble` (retired by this design; `ELEMENTS-DECISIONS.md` gets a row saying so).

### AMBIENT-05 reuse check (architect, 2026-10-28)

- **Quick-actions list:** the kit `Suggestions` Element (`onSuggestion`, `pills` and `list` variants) is the list; its `elements-adoption.json` entry moves from "no-fit" to adopted with this reason; no wrapper and no `className`; a missing look is an additive commons prop first.
- **Model context:** assistant-ui's `makeAssistantVisible` and `useAssistantInstructions` are turned down: they put browser text into the system instructions, which breaks "the title reaches the model as data, never as instructions" and the server's `canRead` check on the record.
- **Carrier:** the existing untrusted-data `ContextItem` in `backend/src/lib/turnMachine/contract.ts` gets a new `page` source, fenced by `isToolOrPageContext` in `messages.ts`; no second wrapper.
- **Type:** the page context crosses the wire, so it is defined once in `@maipai/spec` (app id, route, one record id, record kind, title) and the React side extends the existing `PageContext` in `frontend/src/shell/pages/chatProjectPageContext.ts`; no second type with that name.

## 2b. The standard header row (Jesse, 2026-10-27, after seeing the first build)

Every page has one header row of the same height and the same places: title on the left, the app's own buttons at the right, the companion avatar last (36 px, fixed spot, never overlapping a page button). The front dashboard and Chat follow it too.
- The shell draws the row on every page. A page supplies its title and its buttons through the shell's header slots (`useHeaderExtra` gains a right-hand slot); a page with no title gets its app's name from the app catalog. An app that draws its own header row today (Library, Media, package apps, Settings) moves its title and primary buttons into this row and keeps only content below it (Library's Upload button moves up, for example).
- Full-screen overlays (the photo viewer, the voice call, setup and the immersive screens RULES.md S1 names) are not pages: they carry no header row and get the stand-alone listening indicator.
- Chat's header (the companion picker, history toggle and menu) is the row on Chat: the kit `ChatHeader` takes an end slot for the avatar, so Chat has one row, not two.
- The pane's header row has the same height and ends the same way (title, the pane's buttons including a settings gear, pin, close, then the avatar), so the avatar stays in one spot with the pane open or closed.

## 2c. The companion tab is a stage (mockup `assets/ambient-companion-2026-10-27/stage-mockup.webp`)

The tab is where you talk with a friend, familiar from Chat but not a replica of it. Top to bottom: the companion's name with its state word (Ready, Listening, Thinking, Speaking, Working; text only, no dot), the character large and transparent (the shipped `CompanionAvatar` playing the matching state clip; no background behind it or its container), what it just said as a speech bubble over the lower left of the character, a short list of quick actions, and a talk pill (microphone at the left, a wave or send at the right). States from the mockup: Idle (calm, always available), Listening (a ring and an audio wave in the pill), Thinking (a thought cloud, no spinner), Speaking (the bubble plus a waveform), Working (a short status line and a thin progress line). The thread is not drawn here: History holds the conversation and Continue in Chat opens it. A second tab, Settings, holds the companion picker, Voice, Appearance, Behavior, Presence (the on/off switch) and Position (AMBIENT-06). The stage is a kit Element (`CompanionStage`) with slots; Home passes data and handlers.

## 3. Side chats: one store, two placements

- A conversation row gets `placement: "chat" | "side"` (spec first, then hub; not called `surface`, which RULES.md rule 0 already uses for the surface gates, and no gate reads `placement`: a side turn is classed as written web chat). Chats started in the pane are `side`; everything else stays `chat`. One store, one retention rule, one export, one set of age gates
  (RULES.md rule 0) and parent-visibility rules. Chat's history list shows `chat` rows by default; the companion's History tab and its profile Activity show both, labelled "Chat" or "Side chat".
- The model sees the same memory and the same tools as in Chat for that person and age band. A side chat can hand off to Chat ("Continue in Chat" sets its placement to `chat`).
- A child's side chat follows the child lane exactly as a chat does: same prompt gates, same finished-item checks, same Ask flow for a parent.

## 4. Settings (the Ambient Companion card, person scope)

From the mockup: Ambient companion on/off (reuses the shipped `companions.dock` key, label changed, default on), default companion, position (top right only for now), hover preview, idle animation, speaking ring,
auto-hide when inactive, wake word (a link to the existing per-device setting in This device, no second control). The global shortcut is not part of this card; it waits on a desktop-app verdict. Auto-hide hides the avatar after a period of inactivity and any pointer move at
the top right brings it back; it never hides while listening, thinking or speaking.

## 5. What changes in what exists

| Today | Becomes |
|---|---|
| `CompanionDock` and `useCompanionDock` (bottom corner, minimize, close) | Removed. The ambient avatar replaces it; its Review button moves into the preview and pane. |
| Wake-word listening indicator / launcher bubble | The avatar's listening ring while the avatar exists; the stand-alone indicator with Turn off at the top right when the companion is off. |
| Chat's `Sheet` panels for details, sources, artifact, compare | Tabs of the standard pane. |
| Chat header companion picker | Stays as the chat's own companion (who this chat is with). The top-right avatar is the ambient companion; when they are the same companion the pane's Chat tab says so. |
| `VoiceStage` | The voice call screen keeps its stage; the pane's mic starts a side-chat voice turn instead. |

## 6. Build order (each a backlog row, each lands on its own)

1. **AMBIENT-01 spec and commons:** `placement` on conversations (spec), `RightPane`, `CompanionPreview`, `CompanionAvatar` ring state; tags, pin.
2. **AMBIENT-02 shell:** header slot for the avatar and per-app buttons, ring states from the presence hook, hover and focus preview, touch tap, speech bubble, auto-hide, remove the dock.
3. **AMBIENT-03 side chats:** backend `placement`, pane Chat tab on the same turn engine, History, "Continue in Chat", child lane tests.
4. **AMBIENT-04 migrate panels:** chat details, sources, artifact, compare into pane tabs; remove the Sheets; each app's inspector as it comes up.
5. **AMBIENT-05 page context and quick actions:** the typed page context from each app; "Help with this page", "Find something", "Take an action" through the existing tool and Ask gates.
6. **AMBIENT-06 settings and wake word:** the Ambient Companion card (spec first, one tag, `companions.dock` relabelled "Ambient companion" with true help text), the pane Settings tab as a link into the settings shell or the kit Select as shipped (no raw `<select>`), the wake word check (already built in AMBIENT-06a). The global shortcut is removed from this slice: Home has no desktop app, so it becomes its own backlog row that waits on a desktop-app verdict and carries its own reuse check (Electron or Tauri `globalShortcut`, PWA shortcuts).

Slice update, 2026-10-27: AMBIENT-04 is now the standard header row on every page (section 2b) and the stage tab with its Settings tab shell (section 2c); the migration of Chat's sheets and other panels into pane tabs is AMBIENT-04c, after those.

## 6a. Conditions the build must meet (architect, AMBIENT-COMPANION-01)

- **Side chats (AMBIENT-03):** the same `routes/turn.ts` path with the person's own age band, so a child's side chat has the same prompt gates, finished-item checks and Ask flow; written side chat is adult written chat with no length cap;
  a pane mic turn is a spoken turn (stored reply is the heard prefix); Incognito and temporary mode apply; a parent or admin sees a child's side chats exactly as that child's chats, and no admin sees another adult's;
  page context (route, record id, title) never appears in a trace, log or status line, the server checks its record id against `canRead` for that person, and the title reaches the model as data, never as instructions. Code review at medium.
- **Ring and preview (AMBIENT-02):** the ring is an additive `CompanionAvatar` prop driven by its existing `state`; it takes only listening, thinking and speaking, and a child-band session shows nothing else; no count, dot or badge anywhere (the mockup's green dot by
  "Ready" is not built: Ready is text, from `/api/health` availability, and when not ready the pane's Chat tab shows the existing paused or starting composer line); Review data refetches on focus and navigation, no timer; the header avatar is a still plus the ring, never a playing clip;
  the idle animation never looks like listening; auto-hide never hides during listening, thinking or speaking; the indicator with Turn off shows on every page where the microphone can open (header-less screens draw it alone); no bell, theme or settings buttons are copied into app headers and the mockup's labelled rail is ignored (S1, S2).
- **Panels (AMBIENT-04):** only inspectors, sheets and panels move into the pane; an app's own content column (YouTube's up-next, for example) stays app content; the `SheetContent` className overrides in `ChatPage.tsx` go with the Sheets and the wrapper and className baselines only shrink.
- **AMBIENT-05 and AMBIENT-06 each need their own architect verdict:** quick actions send a prompt with `tool_choice: auto` or are explicit controls passing the same policy checks; a per-page tool is a conditional tool with a bench row (never more than 16 tools on a turn);
  "Take an action" respects role and consent (starting or stopping a model is admin-only); the pane's Settings tab is the settings shell or a link to it (S4), the wake word stays in "This device" and the Ambient card links to it, copy comes through `describeSetting` (S5), the `companions.dock` key is kept, and the Memory tab reuses the existing memory list with `canRead`.
- **One-action stop on touch (AMBIENT-02 test):** a tap opens the pane and Turn off would be a second tap, so while the wake word is listening on a touch screen the top-right indicator with Turn off is shown, or a tap while listening offers Turn off directly; the test shows Turn off is one tap from what is on screen.
- New tags (commons `ui`, `spec`) need Jesse's yes at the time.

- **Header row and stage conditions (architect, 2026-10-27):** one row drawn by the shell from kit pieces (an end slot on `ChatHeader` and a row Element land in commons first); Chat has exactly one row; Library, Media, Settings and package apps move their title and primary buttons into the row, draw no second header, and keep an own-records search box in or below it; the avatar is last, 36 px, in one spot at every S3 width, pane open or closed; phone keeps S1's round menu button first and the title after it; no bell, theme, profile or global settings button in the row; a page with no title gets its app name; the listening indicator with Turn off shows everywhere. The stage is a kit `CompanionStage` with slots: no background, gradient or scene behind the character (transparency comes from the art, never from CSS; opaque art shows its still with no backdrop; new cut-out art passes the COMPANION-ART-CHECK-01 check); state words as text only from `useCompanionPresence` (Ready reads `/api/health` availability, Listening only while the microphone is open, Thinking a thought cloud, Idle no text); Working is turn state only from the turn's own status event, never a background job's percentage; the talk pill is the kit composer in a compact variant and a mic turn is a spoken turn; the speech bubble runs through the same output gate and renderer and is never cut short for a crisis reply, safety notice, refusal, Ask approval or failed-tool line (those stay until dismissed and are in History); the Settings tab is the settings shell or links into it, Voice and Appearance open the existing companion pages, the wake word stays in "This device".

## 7. Open items

- Which apps give page context first (Models, Photos, Settings are in the mockup).
- Whether Memory and Activity inside the pane reuse the profile page's Activity feed as shipped (expected: yes, `ActivityFeed` as is).
- The global shortcut moved out of AMBIENT-06 (no desktop app yet); a separate backlog row waits on a desktop-app verdict.
- A parent's view of a child's side chats: same as chats today; check the Parent area when AMBIENT-03 lands.
