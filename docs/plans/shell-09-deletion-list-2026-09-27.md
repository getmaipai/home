# SHELL-09 deletion list (prep, 2026-09-27)

This is a read-only inventory for the cutover described by SHELL-09. It does not authorize the cutover. No flag, source, screenshot, or Commons file was changed while compiling it. Commons paths below are relative to the pinned read-only worktrees `../commons-tags/ui-ui-v0.5.71/ui` and `../commons-tags/spec-spec-v0.1.50/spec`.

The wiring table in `docs/plans/shell-on-shadcndashboard-2026-09-21.md` is a map of intended retirement, not proof of exclusivity. Paths still reached by `/next` or shared imports are marked second look.

## Phase 1 . routes

SHELL-09 names the `/next` mount and `App.tsx` branch explicitly. The following old-route files named by the SHELL-01–08 wiring rows are candidates, but route removals must first be applied and the import grep repeated. `NextRoutes.tsx` is moved to `/`; `App.tsx` loses the old route tree and flag branch. Neither is a deletion.

| Exact path | Row / reason | Status |
| --- | --- | --- |
| `frontend/src/apps/home/HomePage.tsx`, `HomePage.test.tsx` | SHELL-01 old Home page | Second look: `/next/pages/NextDashboardPage.tsx` imports `apps/home/greeting`; extract that helper first or retain its module. |
| `frontend/src/apps/library/AppsPage.tsx`, `AppsPage.test.tsx` | SHELL-03 old Apps page | Second look: `NextAppsPage.tsx` imports `kindStyle`/`packageState` from this module. Extract shared helpers first. |
| `frontend/src/apps/people/PeoplePage.tsx`, `PeoplePage.test.tsx` | SHELL-04 roster page | Candidate after route swap; check file-level imports at cutover. |
| `frontend/src/apps/people/PersonProfilePage.tsx`, `PersonProfilePage.test.tsx` | SHELL-04 profile page | Second look: profile and Memories coverage is still described as incomplete by the wiring table; ensure the replacement owns these routes. |
| `frontend/src/apps/people/roles.ts`, `roles.test.ts` | SHELL-04 role labels | Second look: used by `NextPeoplePage.tsx` and `NextSettingsPage.tsx`. |
| `frontend/src/apps/memory/PeopleAndThings.tsx`, its test, `PersonMemories.tsx`, its test, `relationshipLabels.ts` | SHELL-04 memories tabs | Second look: the wiring row says the new profile does not yet replace all memory views. Actual directory is `apps/memory/` (singular), rather than the table's stale `apps/memories/`. |
| `frontend/src/apps/settings/*` | SHELL-05 through SHELL-07 dedicated settings pages | Second look: multiple management pages are still owned by old routes. `NextUpdatesPage.tsx` imports `UpdatesSection`; `NextBackupsPage.tsx` imports `formatBytes`; `NextStoragePage.tsx` imports `formatBytes`. Keep shared modules or extract their helpers first. |
| `frontend/src/apps/privacy/PrivacyPage.tsx`, `PrivacyPage.test.tsx` | SHELL-05 settings/privacy route row | Second look: no `/next/privacy` replacement exists in the route inventory. |
| `frontend/src/shell/AppShell.tsx`, its test, `nav.ts`, `appCatalog.ts` and test | SHELL-08 old shell tree | Candidate after App.tsx no longer mounts them; confirm no remaining route/test imports. |
| `frontend/src/shell/SignIn.tsx`, its test | SHELL-08 sign-in | Second look: `/next/sign-in` now exists, but route and auth-gate behavior must be verified after the mount changes. |
| `frontend/src/shell/useLook.ts` | SHELL-08 old `data-look` writer | Second look: `/next/useNextLook.ts` imports `useLookValue` from this mixed-purpose module. Split the storage reader from the old DOM writer. |
| `frontend/src/shell/NotificationBell.tsx` | SHELL-08 shell chrome | Second look: imported by `NextChatPage.tsx`. |
| `frontend/src/apps/setup/SetupWizard.tsx`, its test | SHELL-09-related SETUP-LOOK-01 | Second look: replacement `/next/setup` is still a staged wizard; not part of a safe route deletion until setup acceptance is met. |

Other `apps/settings` and `shell` files not named by an old-file column are not blanket deletions: grep and classify them at cutover rather than deleting whole directories. The route table also has stale names (for example `apps/auth/*` versus current `shell/SignIn.tsx`) and entries that say “not yet”; reconcile those against the live tree before executing this phase.

**SHELL-09 acceptance for this phase:** “`/next/*` becomes `/*`”; `frontend/src/next/NextRoutes.tsx` mounts at `/`, `frontend/src/App.tsx` loses the old shell tree and flag branch, and the old page files named by the wiring table go with their tests and old screenshot captures.

## Phase 2 . old chat

| Exact path | Disposition |
| --- | --- |
| `frontend/src/apps/chat/thread.aui.tsx` | Delete with old chat route after verifying no non-old-chat imports. |
| `frontend/src/apps/chat/chatDocumentPane.tsx`, `chatDocumentPane.test.tsx` | Delete: replaced by `ArtifactCard`/`CanvasSplit` in SHELL-02 slice 4. |
| `frontend/src/apps/chat/chatMemoryChip.tsx`, `chatMemoryChip.test.tsx` | Candidate retired chip; confirm its replacement path in Elements before deletion. |
| `frontend/src/apps/chat/chatActionBar.tsx`, test | Second look: imported by `NextChatPage.tsx`; retain or replace with Element implementation. |
| `frontend/src/apps/chat/chatHeaderBar.tsx`, test; `chatHeaderData.tsx` | Second look: `/next` route/page imports these for the shared header. |
| `frontend/src/apps/chat/composerAddMenu.tsx`, `composerVoiceControls.tsx`, `ComposerWakeWordControl.tsx`, `WakeWordController.tsx`, `voiceSessionContext.tsx`, `liveVoiceSession.tsx` | Keep while imported/mounted by Elements; live voice control is built but not mounted per SHELL-02 slice 6 / HANDSFREE-01. |

SHELL-02 explicitly says the Elements chat keeps its existing model, history, thread-list, suggestion, attachment, dictation, and artifact adapters. Keep these adapter/data modules and tests unless a fresh import graph proves otherwise: `chatModelAdapter.ts` and test; `chatHistoryAdapter.ts` and test; `chatThreadListAdapter.ts` and test; `chatSuggestionAdapter.ts` and test; `localImageAttachmentAdapter.ts` and test; `chatSpeechAdapter.ts`; `chatEditSupersedes.ts`; `chatMessageText.ts`; `chatTurnActivity.ts`; `chatToolCallPart.ts`; `visionCapability.ts` and test; `engineRoles.ts`; `composerDictationWaveform.tsx` and test. Also keep any shared safety, history, or wire helpers imported from `NextChatPage.tsx`.

The six SHELL-02 slices retire the old hand-built thread/chat surface as Elements take over reply/reasoning, thread list, tools, artifacts/document pane, suggestions/sources/read-aloud, and composer attachments/dictation. They do not authorize deleting adapters merely because the old route also uses them.

**SHELL-09 acceptance for this phase:** delete `thread.aui.tsx`, `chatDocumentPane.tsx`, and “the old panes and chips the Elements replaced, keeping the adapters the Elements thread still uses.”

## Phase 3 . Commons UI kit (read-only inventory)

### Current candidates and second-look list

| Exact path(s), relative to `ui/` | Status / evidence |
| --- | --- |
| `src/Shell.tsx`, `src/Shell.test.tsx` | Candidate after old `AppShell` is retired. |
| `src/primitives/DetailPane.tsx`, `src/primitives/DetailPane.test.tsx` | Candidate for the old chat pane, subject to a complete import grep. |
| `src/blocks/things-table/ThingsTable.tsx`, `ThingsTable.test.tsx` | Second look: old Apps/Files consumers remain, and the new route/helper graph must be rechecked. |
| `src/blocks/browser/{CategoryBrowser,DataTable}.tsx` and tests | Second look: `/next` data pages use kit data-table primitives. |
| `src/blocks/cards/{ActionTile,CategoryTile,MetricCard,PanelHeader,ResourceRow,Sparkline,StatusPill,TypeBadge}.tsx`, `cards.test.tsx` | Second look: several are imported directly by `/next` dashboard/pages. |
| `src/blocks/chat/{ChildBand,MemoryChip,SensesDock,SourcesCard}.tsx`, `chat.test.tsx` | Second look: trace direct and transitive imports from the Elements chat before retiring. |
| `src/blocks/dashboard/components/{FooterBar,HeaderPicker,HeaderSearchField,HubCard,NotificationPopover,app-sidebar,appearance-control,nav-main}.tsx` and component tests | Second look: these are template shell components used by `/next`; they cannot be removed with the old shell. |
| `src/blocks/filter-column/FilterColumn.tsx`, test; `src/blocks/pane/DetailsPane.tsx`, test; `src/blocks/property-panel/{KeyValueList,PropertyPanel}.tsx`; `src/blocks/things-page/ThingsPage.tsx` | Second look: old Apps/Files pages use them; `NextDataTable.tsx` has a type import from `PropertyPanel`. Recheck after routing and helper extraction. |
| `src/blocks/phone/{ChipRow,DetailCard,ListRow,PhoneMode}.tsx`, `phone.test.tsx` | Second look: `PhoneMode` and responsive page primitives may still be used outside old routes. |
| `src/blocks/states/{Empty,ErrorState,Loading}.tsx`, `states.test.tsx` | Second look: shared state components; audit `/next` imports. |
| `src/assistant-ui/attachment.aui.tsx`, `follow-up-suggestions.aui.tsx`, `reasoning.aui.tsx`, `thread-list.aui.tsx`, `tool-fallback.aui.tsx`, `tool-group.aui.tsx` | Second look: Elements chat directly uses `tool-fallback.aui.tsx`; audit transitive adapter/components for the rest before deleting. |
| `src/assistant-ui/tooltip-icon-button.tsx` | Second look: `NextChatPage.tsx` imports `chatActionBar.tsx`, which uses this wrapper. |
| `src/icons.ts` | Keep: `/next` uses `getIcon`; not a deletion candidate. |
| `src/tokens.css` | No `[data-look=...]` selector rules remain in ui-v0.5.71; only historical comments mention them. Delete any residual mechanism/comments only if a later pinned source has actual rules. |
| `src/dashboard/css/globals.css` | Keep the `.style-navy` and `.dark .style-navy` preset blocks. `studio`/`calm` preset variants have already been retired in this tag; comments remain. |

The candidate inventory includes all current `src/blocks/` implementation and test files above (the pinned tree also contains `things-page/ThingsPage.tsx`, `filter-column/FilterColumn.tsx`, `pane/DetailsPane.tsx`, and property-panel components). The second-look list is intentionally conservative: many `blocks/` are template components used directly by `/next` and must not be swept out as a directory.

**SHELL-09 acceptance for this phase:** “no file under `frontend/src` imports from `@maipai/ui/src/Shell`, `blocks/` or `assistant-ui/` (a grep in the commit).” The setting key must also be absent from Home and Commons after the full release. Re-run the imports grep after each route/chat removal before preparing a Commons tag.

## Phase 4 . Commons spec (read-only inventory)

| Exact path | Status / evidence |
| --- | --- |
| `spec/settings/keys.json` entry with key `ui.shell.next` | Delete only as part of the coordinated spec tag. Current declaration: household boolean, default `false`, label “New shell (preview)”. |
| Any record field read only by old shell | No candidate identified in this pass. Grep of `/next` and old shell call sites is not sufficient to claim a field is exclusive; compare all consumers and generated types before naming one. |
| Fixtures for removed fields | The current key declaration does not identify setting-specific fixtures. Enumerate fixtures only after an exclusive field is established; keep shared record fixtures. |

`ui.look` is still read by `/next` via its own appearance path and is not a candidate for spec removal. Its historical `studio`/`calm` values are a Home migration concern, not grounds to delete the key or surviving preset values. No files in Commons were changed.

**SHELL-09 acceptance for this phase:** remove the spec key and only record fields/fixtures proven to be read exclusively by the old shell; after the release, `ui.shell.next` appears nowhere in Home or Commons.

## Phase 5 . docs and screenshots

### Design and user docs

| Exact path | Required cutover action |
| --- | --- |
| `docs/design/home-pages-2026-09-20.md` | Add a superseded marker at the top and point to the SHELL-09 program record; retain the historical document. |
| `docs/user/settings.md` | Remove the “New shell (preview)” setting bullet and revise nearby text that still describes preview/old-look pages. |
| `docs/dev.md` | Close the shell section with the landed cutover hash and point to the final implementation/capture record. |

### Existing user screenshots to regenerate

I opened representative Home, Chat, Settings, Privacy, and Conversations captures. The first four show old-shell chrome (branded left rail, old header/sidebar or old chat detail pane); Conversations shows its separate old navigation layout. Thus these user-doc screenshots are confirmed old-shell captures and need replacement from the new routes. The remaining screenshots listed below are the other images embedded in user pages and should be checked/regenerated from their matching new routes in the same pass.

| Exact current capture path | Referenced by | Finding |
| --- | --- | --- |
| `docs/assets/screens/home-desktop-light.png` | `docs/user/home.md` | Opened: old shell. |
| `docs/assets/screens/chat-document-pane-desktop-light.png` | `docs/user/chat.md` | Opened: old shell/chat. |
| `docs/assets/screens/chat-feedback-reasons-desktop-light.png` | `docs/user/chat.md` | Regenerate with chat set. |
| `docs/assets/screens/chat-turn-stats-desktop-light.png` | `docs/user/chat.md` | Regenerate with chat set. |
| `docs/assets/screens/conversations-desktop-light.png` | `docs/user/chat.md` | Opened: old navigation. |
| `docs/assets/screens/chat-research-mode-desktop-light.png` | `docs/user/chat.md` | Regenerate with chat set. |
| `docs/assets/screens/chat-model-picker-desktop-light.png` | `docs/user/chat.md` | Regenerate with chat set. |
| `docs/assets/screens/chat-temporary-mode-desktop-light.png` | `docs/user/chat.md` | Regenerate with chat set. |
| `docs/assets/screens/chat-continue-desktop-light.png` | `docs/user/chat.md` | Regenerate with chat set. |
| `docs/assets/screens/settings-repairs-desktop-light.png` | `docs/user/fix-a-problem.md` | Regenerate from `/next/repairs`. |
| `docs/assets/screens/settings-users-desktop-light.png` | `docs/user/people.md` | Regenerate from replacement People/manage route. |
| `docs/assets/screens/privacy-desktop-light.png` | `docs/user/privacy.md` | Opened: old shell; replacement route still needs completion. |
| `docs/assets/screens/settings-desktop-light.png` | `docs/user/settings.md` | Opened: old shell. |

The docs currently reference 13 screenshots. The cutover acceptance additionally requires every page at widths 1440 and 390 in both looks and themes; this embedded-doc list is not that complete capture matrix. Keep captures for routes that are not migrated until their new route exists and is judged.

**SHELL-09 acceptance for this phase:** supersede `docs/design/home-pages-2026-09-20.md`, regenerate `docs/user/*` screenshots from the new pages, remove the settings preview bullet, and close the shell section in `docs/dev.md` with the cutover hash. Overall capture acceptance: every page at 1440 and 390 in both modes regenerated and judged; old-shell-only `ui.look` values migrate on read.

## Count summary for cutover planning

Counts refer to named file paths, not directory globs or CSS rules. This prep found **Phase 1: 0 safe deletions / 16 second-look paths** (including grouped wildcard rows, which must be expanded at execution); **Phase 2: 2 safe old-chat files / 13 keep-or-second-look paths**; **Phase 3: 2 clear old-kit candidates / 35 second-look or retained paths**; **Phase 4: 1 setting declaration / 0 confirmed old-shell-only record fields / 0 confirmed field fixtures**; **Phase 5: 0 deletions / 3 doc edits plus 13 screenshot replacements**. Counts are a research snapshot, not authorization to cut over; route ownership and import greps must be current when Jesse authorizes the cut.
