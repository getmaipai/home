# The ambient companion and the standard right pane (design, 2026-10-27)

Owner: Jesse. Mockup: [assets/ambient-companion-2026-10-27/mockup.webp](assets/ambient-companion-2026-10-27/mockup.webp) (Rivet in the top right of every app, hover preview,
pinned pane, per-app help, settings). This note replaces the bottom-corner launcher and the companion dock (`CompanionDock`, `companions.dock`) from
[companions-handoff-revamp-2026-10-26.md](companions-handoff-revamp-2026-10-26.md) section 5a. RULES.md S2 and S6 carry the owner-approved edit.

## 1. What the person sees

1. **The companion, top right of every app header, Chat included.** A 32 to 36 px avatar. The selected app's own header buttons (settings, search, whatever that app has)
   sit to its left. One companion at a time: the person's default companion from settings, changeable from the pane.
2. **Ring states, real events only.** Dim and still while listening; a gentle ring while thinking; a ring while speaking; a subtle idle animation (setting). No count, no dot, no badge.
   Reduced motion draws the ring without animation. The states come from the one presence hook (`useCompanionPresence`, the same signals Chat uses), never a second resolver.
3. **Hover or focus shows a compact preview** (after about 300 ms): name, "Ready" only when it can answer, what it knows of the page ("You're on Models"), its last line, a quick Ask field with a mic, and the single
   Review button when a task of the viewer's own needs them. On touch screens there is no hover: a tap opens the pane directly.
4. **Click opens the standard right pane.** Pin keeps it open and it then behaves like the chat column (same width rules, same collapse on narrow screens), without a toggle button.
5. **What the companion said floats** beside the avatar for a few seconds (a speech bubble) and is kept in the pane's History, so nothing spoken is lost.
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

## 3. Side chats: one store, two surfaces

- A conversation row gets `surface: "chat" | "side"` (spec first, then hub). Chats started in the pane are `side`; everything else stays `chat`. One store, one retention rule, one export, one set of age gates
  (RULES.md rule 0) and parent-visibility rules. Chat's history list shows `chat` rows by default; the companion's History tab and its profile Activity show both, labelled "Chat" or "Side chat".
- The model sees the same memory and the same tools as in Chat for that person and age band. A side chat can hand off to Chat ("Continue in Chat" sets its surface to `chat`).
- A child's side chat follows the child lane exactly as a chat does: same prompt gates, same finished-item checks, same Ask flow for a parent.

## 4. Settings (the Ambient Companion card, person scope)

From the mockup: Ambient companion on/off (reuses the shipped `companions.dock` key, label changed, default on), default companion, position (top right only for now), hover preview, idle animation, speaking ring,
auto-hide when inactive, wake word (with a Test button, the existing per-device setting), global shortcut (desktop app only). Auto-hide hides the avatar after a period of inactivity and any pointer move at
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

1. **AMBIENT-01 spec and commons:** `surface` on conversations (spec), `RightPane`, `CompanionPreview`, `CompanionAvatar` ring state; tags, pin.
2. **AMBIENT-02 shell:** header slot for the avatar and per-app buttons, ring states from the presence hook, hover and focus preview, touch tap, speech bubble, auto-hide, remove the dock.
3. **AMBIENT-03 side chats:** backend `surface`, pane Chat tab on the same turn engine, History, "Continue in Chat", child lane tests.
4. **AMBIENT-04 migrate panels:** chat details, sources, artifact, compare into pane tabs; remove the Sheets; each app's inspector as it comes up.
5. **AMBIENT-05 page context and quick actions:** the typed page context from each app; "Help with this page", "Find something", "Take an action" through the existing tool and Ask gates.
6. **AMBIENT-06 settings, wake word and shortcut:** the Ambient Companion card, wake word to the pane, global shortcut in the desktop app.

## 7. Open items

- Which apps give page context first (Models, Photos, Settings are in the mockup).
- Whether Memory and Activity inside the pane reuse the profile page's Activity feed as shipped (expected: yes, `ActivityFeed` as is).
- The global shortcut needs the desktop app; the web build ignores it.
- A parent's view of a child's side chats: same as chats today; check the Parent area when AMBIENT-03 lands.
