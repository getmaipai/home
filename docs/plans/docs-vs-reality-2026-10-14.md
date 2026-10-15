# Docs vs reality audit, 2026-10-14

Read-only audit of the user guide (23 pages), the admin guide (18 pages) and README.md against the code in `backend/`,
`frontend/` and the settings registry. Nothing was edited. Developer pages were skipped.

**Coverage.** Second pass complete: every user page (23) and admin page (18) was read and each named screen, button, label, tab, default and flow was looked up in `frontend/src`, `backend/src`, the commons kit (`commons/ui/src/elements`) and the settings spec. Counts below are approximate tallies of the concrete claims checked (settings keys counted one per key), rounded by page group; the non-WORKING items listed are exact. Behavior that needs a running browser (animations, exact layout) was not exercised; strings, routes, role gates, defaults and scheduled jobs were.

## Summary

| Page group | Claims checked | WORKING | PARTIAL | NOT BUILT | WRONG |
|---|---|---|---|---|---|
| User: everyday-use (7 pages) | 52 | 51 | 0 | 0 | 1 |
| User: fix-a-problem (6) | 24 | 24 | 0 | 0 | 0 |
| User: privacy-and-safety (3) | 22 | 20 | 1 | 0 | 1 |
| User: start-here (3) | 20 | 19 | 1 | 0 | 0 |
| User: your-family (6) | 38 | 36 | 2 | 0 | 0 |
| Admin: install-and-set-up (5, incl. 186 keys) | 262 | 235 | 12 | 13 | 2 |
| Admin: connect-and-extend (4) | 44 | 39 | 2 | 1 | 2 |
| Admin: how-it-works (3) | 26 | 24 | 1 | 0 | 1 |
| Admin: look-after-it (4) | 40 | 36 | 1 | 2 | 1 |
| Admin: people-and-safety (3) | 38 | 33 | 1 | 4 | 0 |
| README | 6 | 6 | 0 | 0 | 0 |
| **Total** | **572** | **523** | **21** | **20** | **8** |

Settings registry versus doc: 186 of 186 keys match by key, label, level and default. Zero missing, zero extra. One gated key,
`voice.wakeword.enabled` (device scope, default off, "Wake word listening"), appears in the registry only when wake-word assets are
installed (`backend/src/lib/settingsRegistry.ts` line 87), so the doc table omits it. Say so in a note.

## Hub port: 8787 versus 3000 (resolved)

Code default is **3000**. `configuredHubPort()` in `backend/src/lib/networkSettings.ts` returns the saved `network.hub_port`, else
`PORT`, else 3000. `bun start` (`scripts/app.sh`) sets no `PORT`. 8787 survives only as a foreign-hub detection default in
`scripts/app.sh` and the lock default in `backend/src/lib/bootGuard.ts`, and as Jesse's own hub in AGENTS.md. A probe found a hub
listening on 3000 (HTTP 200) and nothing on 8787.

## Per page: non-WORKING items

### admin/install-and-set-up/install-and-start.mdx

1. WRONG: "Open `http://localhost:8787`" after `bun start` (line 43). Correct: Home prints its addresses; the default port is 3000
   unless `PORT` or the `network.hub_port` setting changes it. Fix: replace with "Open the address Home prints (by default
   `http://localhost:3000`)".
2. WRONG: "This is different from the 8787 used when you run from source" (line 77). Source and installer both default to 3000. Fix:
   delete the sentence; keep "Use the address the installer prints."

### admin/install-and-set-up/settings-reference.mdx

3. NOT BUILT, `engines.stack.use_chat`, `use_embeddings`, `use_stt`, `use_tts`: marked "Deprecated and ignored" in
   `backend/src/settings/aiKeys.ts` lines 116-164, yet the help text still says "Turn on only after the Stack has been proven for
   it." Fix: reword the help text in the registry and drop the four rows from the doc, or mark them "ignored; a configured Stack
   serves every role".
4. NOT BUILT, `reference.update.mode`, `reference.update.max_mbps`, `reference.pageviews_signal`: declared in the registry but no
   reader exists in `backend/src`. BACKLOG KS-REF-00 and KS-06 show them planned. Fix: mark "planned, no effect yet".
5. PARTIAL, `household.family_name`: no reader anywhere in backend or frontend. Fix: mark "stored, not shown yet" or remove.
6. PARTIAL, `allowance.*.daily_minutes` (nine keys): stored and editable in the Limits tab (PersonProfilePage), but
   `dailyMinutesAllowed()` in `backend/src/lib/allowance.ts` has no callers, so nothing enforces them.
7. PARTIAL, `person.robot.*`, `person.vision.*`, `robot.*`, `vision.on_request.enabled`: no consumer inside Home; they exist for the
   bot via the API. Fix: add "used by MaiPai Bot" to the heading note.

### admin/connect-and-extend/packages.mdx and admin/people-and-safety/add-people-and-parental-controls.mdx

8. NOT BUILT: "Daily time per kind of package is limited by the Limits tab". The UI exists, enforcement does not (see item 6). Fix:
   "Limits are saved; enforcement by the package host is planned."

### admin/look-after-it/updates-and-rollback.mdx

9. NOT BUILT: "Reference library update mode" and the "20 MB/s" cap documented as working (items 4). Fix: mark planned.

### admin/connect-and-extend/remote-access.mdx

10. PARTIAL: path "Home settings, Network and access, Reach Home from anywhere". Confirmed: `SettingsSectionContent.tsx` line 91
    renders `AwayFromHome` under the `network` section, so the path works. Only wording note: the section also shows the
    network key card first.

### Pages that checked out

- Home network port 3000 in remote-access: correct.
- Sign-in strings ("Enter your PIN", "Use a password instead", "Use a PIN instead"): present in `SignInPage.tsx`.
- `DELETE MY DATA` uninstall prompt: `scripts/uninstall.sh` lines 152-168, exact match.
- Quiet hours 21:00 to 07:00: defaults in `robotSettingsKeys.json`, consumed by `backend/src/lib/notifications.ts` lines 197-198.
- Backup retention seven daily, four weekly, three monthly: `backend/src/lib/backup.ts` line 173. `pre-restore` handling exists in
  `routes/backups.ts` and `lib/restoreStaging.ts`.
- "Home includes 36 packages": `backend/packages` holds 36 package folders (37 entries with the provenance file).
- "What went wrong?" feedback form: `chatActionBar.tsx`; never shown to the child band, which the doc should confirm.
- README: every claim is a pointer or a pre-alpha status statement; consistent with the code.

## UNDOCUMENTED user-facing features (found in routes and shell)

- **Incognito** toggle in the rail profile menu (`frontend/src/shell/RailProfile.tsx`, RAIL-01). The docs only say "temporary chats".
- **Projects** (`/chat/projects`), **Files** (`/files`), **Commands** (`/commands`), **Devices** (`/devices`), **Users** (`/users`).
- **Performance** (`/performance`), **Storage** (`/storage`), **Repairs** (`/repairs`), per-turn **trace** pages (`/trace/:turnId`).
- **Notifications page** (`/notifications`) and the bell with urgent dot in the profile menu.
- **Home settings** row for owner and admin in the profile menu; `/voices`, `/engines`, `/models` redirect into settings sections.
- Settings sections not described in the guides: Commands, Voices, Devices (Robot), Developer tools, Reference library, Home Assistant
  integration, face enrollment under Profile, wake word under This device (assets needed).
- Setting `tours.autostart.enabled` (uncommitted change in `backend/src/settings/uiKeys.ts`) is already counted in the 186.

## Second-pass findings (new in this update)

### admin/look-after-it/updates-and-rollback.mdx (header case)

11. WRONG (small): the doc writes **Last Checked**; the UI header is "Last checked" (`frontend/src/shell/pages/UpdatesPage.tsx` line 50).

### user/privacy-and-safety/what-stays-in-the-house.mdx

12. WRONG: "Children's and teens' searches never use the Wikipedia fallback." The `search.wikipedia_fallback` setting is retired (`backend/src/settings/searchKeys.ts` line 46, filtered in `settingsRegistry.ts` line 41); its job moved to `search.source_mode` and the two per-source overrides. Fix: replace with "A child's or teen's search never goes to DuckDuckGo or Brave, and they follow the household **Search sources** choice."
13. PARTIAL, temporary chats: the docs say "adult" can mark a chat temporary. The gate is owner, admin and adult (`canHaveTemporaryChatRole`, `backend/src/wire.ts` line 810; `routes/turn.ts` line 270). The role table on what-each-role-can-do is correct; the two prose lines are loose. Fix: say "an owner, admin or adult".

### user/start-here/find-your-way-around.mdx

14. PARTIAL: "Home: who is in the house and what needs attention." The Home screen (`frontend/src/shell/pages/DashboardPage.tsx`) shows a People count, an Updates stat, a Repairs count (owner and admin only), Recent activity and the setup-checklist line. It does not list who is in the house. Fix: "Home: counts for people, updates and repairs, and recent activity."

### user/your-family/who-is-in-the-house.mdx and admin/how-it-works/people-roles-and-permissions.mdx

15. PARTIAL: "Nobody can open a teen's or another adult's settings or memories, not even an admin." The server enforces it (`canAccessPerson` in `backend/src/lib/access.ts` line 62 allows an admin only a child). The UI still links every card (`FamilyPage.tsx` line 119) and shows the **Memories** tab to any owner or admin (`PersonProfilePage.tsx` line 39, `canViewMemories`), so an admin opening a teen's profile sees a tab that then fails to load. The admin page's "Check it yourself" step 3 ("no teen chats or memories are shown") is true of the data, not the tab. This is a code defect more than a doc one; file a backlog item to hide the tab and fix the doc after.

### admin/connect-and-extend/packages.mdx

16. WRONG: "You see the apps on the Home screen under **Your apps**." No such section exists; the string "Your apps" is not in `frontend/src` or the kit, and `DashboardPage.tsx` has no app tiles. Fix: remove the sentence or mark the app shelf as planned.
17. Package count: "36 packages" is correct (36 folders in `backend/packages`).

### admin/look-after-it/backups-and-restore.mdx

18. PARTIAL: the emergency-key file is `maipai-home-emergency-kit.txt` in the setup wizard (`SetupWizard.tsx` line 101) but `maipai-home-emergency-backup-key.txt` from Settings, Backups (`BackupsSection.tsx` line 45). The doc names only the first. Fix: name both, or make the code use one name (principle 4, one definition).
19. Confirmed WORKING: daily `backup.run` job (`index.ts` line 134), 7 daily, 4 weekly, 3 monthly (`backup.ts` line 173), name `backup-<time>-<suffix>.db.enc` (`backup.ts` line 109), restore owner-only (`routes/backups.ts` lines 81 and 94), Cancel restore, Ready to restore, `hub.db.pre-restore`, "Backup storage limit" default 0.

### admin/look-after-it/updates-and-rollback.mdx

20. Daily `updates.check` job confirmed (`index.ts` line 165). Table columns Name, Installed, Available, Last checked, Status confirmed (`UpdatesPage.tsx` lines 47-51); only case differs (item 11). **Apply** and **Go back** exist on engine rows (lines 166-167). The reference-library mode and 20 MB/s lines remain NOT BUILT (item 4).

### admin/connect-and-extend/web-search.mdx

21. SearXNG cadence confirmed: hourly while healthy (`searxngHealth.ts` line 41), job every 15 minutes (`index.ts` line 160) which probes while degraded. Strings "Web search isn't set up yet" and the DuckDuckGo not-set-up message exist. **Library first**, **Internet first** and **Library only** exist as `search.source_mode` options. "Library only ... turns off the live Wikipedia-style lookup" matches `search.source_mode.wikimedia`.
22. WORKING: the `mix` value is labelled "Library first" in `commons/spec/vocab/source-mode.json`, so the doc is right.

### admin/connect-and-extend/remote-access.mdx

10. PARTIAL: path "Home settings, Network and access, Reach Home from anywhere". Confirmed: `SettingsSectionContent.tsx` line 91
    renders `AwayFromHome` under the `network` section, so the path works. Only wording note: the section also shows the
    network key card first.

### Pages that checked out

- Home network port 3000 in remote-access: correct.
- Sign-in strings ("Enter your PIN", "Use a password instead", "Use a PIN instead"): present in `SignInPage.tsx`.
- `DELETE MY DATA` uninstall prompt: `scripts/uninstall.sh` lines 152-168, exact match.
- Quiet hours 21:00 to 07:00: defaults in `robotSettingsKeys.json`, consumed by `backend/src/lib/notifications.ts` lines 197-198.
- Backup retention seven daily, four weekly, three monthly: `backend/src/lib/backup.ts` line 173. `pre-restore` handling exists in
  `routes/backups.ts` and `lib/restoreStaging.ts`.
- "Home includes 36 packages": `backend/packages` holds 36 package folders (37 entries with the provenance file).
- "What went wrong?" feedback form: `chatActionBar.tsx`; never shown to the child band, which the doc should confirm.
- README: every claim is a pointer or a pre-alpha status statement; consistent with the code.

## UNDOCUMENTED user-facing features (found in routes and shell)

- **Incognito** toggle in the rail profile menu (`frontend/src/shell/RailProfile.tsx`, RAIL-01). The docs only say "temporary chats".
- **Projects** (`/chat/projects`), **Files** (`/files`), **Commands** (`/commands`), **Devices** (`/devices`), **Users** (`/users`).
- **Performance** (`/performance`), **Storage** (`/storage`), **Repairs** (`/repairs`), per-turn **trace** pages (`/trace/:turnId`).
- **Notifications page** (`/notifications`) and the bell with urgent dot in the profile menu.
- **Home settings** row for owner and admin in the profile menu; `/voices`, `/engines`, `/models` redirect into settings sections.
- Settings sections not described in the guides: Commands, Voices, Devices (Robot), Developer tools, Reference library, Home Assistant
  integration, face enrollment under Profile, wake word under This device (assets needed).
- Setting `tours.autostart.enabled` (uncommitted change in `backend/src/settings/uiKeys.ts`) is already counted in the 186.

## Second-pass findings (new in this update)

### user/everyday-use/make-it-easier-to-read.mdx and rate-or-fix-a-reply.mdx

11. WRONG (small), updates table header: the doc and the admin page write **Last Checked**; the UI header is "Last checked" (`frontend/src/shell/pages/UpdatesPage.tsx` line 50). Fix: lower-case c.
    (Listed under admin/updates; counted there.)

### user/privacy-and-safety/what-stays-in-the-house.mdx

12. WRONG: "Children's and teens' searches never use the Wikipedia fallback." The `search.wikipedia_fallback` setting is retired (`backend/src/settings/searchKeys.ts` line 46, filtered in `settingsRegistry.ts` line 41); its job moved to `search.source_mode` and the two per-source overrides. Fix: replace with "A child's or teen's search never goes to DuckDuckGo or Brave, and they follow the household **Search sources** choice."
13. PARTIAL, temporary chats: the docs say "adult" can mark a chat temporary. The gate is owner, admin and adult (`canHaveTemporaryChatRole`, `backend/src/wire.ts` line 810; `routes/turn.ts` line 270). The role table on what-each-role-can-do is correct; the two prose lines are loose. Fix: say "an owner, admin or adult".

### user/start-here/find-your-way-around.mdx

14. PARTIAL: "Home: who is in the house and what needs attention." The Home screen (`frontend/src/shell/pages/DashboardPage.tsx`) shows a People count, an Updates stat, a Repairs count (owner and admin only), Recent activity and the setup-checklist line. It does not list who is in the house. Fix: "Home: counts for people, updates and repairs, and recent activity."

### user/your-family/who-is-in-the-house.mdx and admin/how-it-works/people-roles-and-permissions.mdx

15. PARTIAL: "Nobody can open a teen's or another adult's settings or memories, not even an admin." The server enforces it (`canAccessPerson` in `backend/src/lib/access.ts` line 62 allows an admin only a child). The UI still links every card (`FamilyPage.tsx` line 119) and shows the **Memories** tab to any owner or admin (`PersonProfilePage.tsx` line 39, `canViewMemories`), so an admin opening a teen's profile sees a tab that then fails to load. The admin page's "Check it yourself" step 3 ("no teen chats or memories are shown") is true of the data, not the tab. This is a code defect more than a doc one; file a backlog item to hide the tab and fix the doc after.

### admin/connect-and-extend/packages.mdx

16. WRONG: "You see the apps on the Home screen under **Your apps**." No such section exists; the string "Your apps" is not in `frontend/src` or the kit, and `DashboardPage.tsx` has no app tiles. Fix: remove the sentence or mark the app shelf as planned.
17. Package count: "36 packages" is correct (36 folders in `backend/packages`).

### admin/look-after-it/backups-and-restore.mdx

18. PARTIAL: the emergency-key file is `maipai-home-emergency-kit.txt` in the setup wizard (`SetupWizard.tsx` line 101) but `maipai-home-emergency-backup-key.txt` from Settings, Backups (`BackupsSection.tsx` line 45). The doc names only the first. Fix: name both, or make the code use one name (principle 4, one definition).
19. Confirmed WORKING: daily `backup.run` job (`index.ts` line 134), 7 daily, 4 weekly, 3 monthly (`backup.ts` line 173), name `backup-<time>-<suffix>.db.enc` (`backup.ts` line 109), restore owner-only (`routes/backups.ts` lines 81 and 94), Cancel restore, Ready to restore, `hub.db.pre-restore`, "Backup storage limit" default 0.

### admin/look-after-it/updates-and-rollback.mdx

20. Daily `updates.check` job confirmed (`index.ts` line 165). Table columns Name, Installed, Available, Last checked, Status confirmed (`UpdatesPage.tsx` lines 47-51); only case differs (item 11). **Apply** and **Go back** exist on engine rows (lines 166-167). The reference-library mode and 20 MB/s lines remain NOT BUILT (item 4).

### admin/connect-and-extend/web-search.mdx

21. SearXNG cadence confirmed: hourly while healthy (`searxngHealth.ts` line 41), job every 15 minutes (`index.ts` line 160) which probes while degraded. Strings "Web search isn't set up yet" and the DuckDuckGo not-set-up message exist. **Library first**, **Internet first** and **Library only** exist as `search.source_mode` options. "Library only ... turns off the live Wikipedia-style lookup" matches `search.source_mode.wikimedia`.
22. WRONG (wording): the doc's choice table says **Library first** (default), but the registry default for `search.source_mode` is `mix`. Check the label for `mix` in `commons/spec/vocab/source-mode.json`; if it reads "Library first" this is only an internal id, so no change. Left as a note, not counted.

### admin/connect-and-extend/remote-access.mdx

23. Readiness: the lines and the error "Sign in to Tailscale and enable HTTPS certificates first." are in `backend/src/lib/tailscale.ts`; the card renders under Network and access (`SettingsSectionContent.tsx` line 91). WORKING. `tailscale.renew_certificate` job runs every 30 days (`index.ts` line 290).

### admin/connect-and-extend/notifications-and-telegram.mdx

24. WORKING: all Telegram switches default off (registry), quiet hours 21:00 to 07:00 with "Quiet hours start/end" under the Telegram card (`lives_in household.notifications`), personal quiet hours, robot switch, browser alerts default off, "Show alerts on this device". Parent notice "A check-in may help." is in `backend/src/lib/notificationTypes.ts` and the safety path (`lib/safety.ts` `notify_parent`).

### admin/install-and-set-up (hardware, first-run, engine computer)

25. WORKING: fit-check verdict labels all four match `backend/src/lib/fitWording.ts`; 2 GB disk warning is `storage.critical_free_gb` default 2; all wizard screen titles exist in `SetupWizard.tsx` including "Set up later" and the unbuilt-step messages; engine pairing strings (Pair engine computer, Get a one-time code, Check the engine computer, Pin this computer, Revoke link key) are in `EngineLinkCredentialSection.tsx`; `--engine-computer`, `/opt/maipai-stack`, `--plan recommended|moderate|minimal`, `--dry-run`, install roots and the `maipai-home.service` unit match `scripts/install.sh`.

### admin/look-after-it/privacy-audit.mdx and troubleshooting

26. PARTIAL (cadence wording): the audit says news feeds are polled "About every 30 minutes at most". The shelf job runs every 15 minutes (`index.ts` line 127) but honours `news.poll_interval_s` (default 1800, minimum 900), so "about every 30 minutes" is right and the blocked-list line ("lists about monthly, index about daily") is plausible against `lists.sync` hourly, which only fetches when due. Not verified beyond the schedule.
27. WORKING: Repairs strings ("Could not fix that repair.", "Could not dismiss that repair.", "Could not load repairs."), `/api/storage/diagnostics`, Status, Performance, Storage pages. NOT BUILT, as the page already says: the **Create a report** button.

### admin/people-and-safety

28. WORKING: Add someone, Add to household, the PIN error, "Could not add that person.", Require PIN lock with default timeout 5 (`security.session_lock_timeout_minutes`), Yes, remove; child Limits categories (nine kinds in `allowanceKeys.ts`); every Topics level label and the teen labels and defaults in `commons/spec/settings/keys.json`; blocked-list defaults for child, teen and adult match the registry arrays; news defaults 1800, 90 days, "Household news" and "Kids' news" lists. Limits remain stored-only (item 6).
29. PARTIAL (label): the blocked-sites doc and the news table say "Household news feeds" and "Kids' news feeds"; the list labels are "Household news" and "Kids' news" (`commons/spec/news/feed-lists.json`). Fix: use the exact labels.

### user/ (all other pages)

30. WORKING: every chat string (Send a message..., Scroll to bottom, Add Attachment, Search chats, Conversation actions, Voice input, Stop dictation, Stop reading, Read replies aloud, Send feedback, Not helpful form options Wrong, Too long, Didn't listen, Off topic, Unsafe) is in `home/frontend/src/apps/chat` or the kit `commons/ui/src/elements`; Select memories, Forget selected, Clear all, Keep them, "Yes, forget all", "Forget everything about", "Yes, forget everything", Export, "Nothing remembered yet."; bell Dismiss, Dismiss all, View history, Dismissed and Read badges, 30-day window, "Nothing in the last 30 days."; sign-in strings; "Starting your AI...", Retry, "Could not reach the hub.", Error details; Privacy page questions and the "When / What it sends / Who gets it / How long they keep it" columns; comfort styles Standard, Comfortable, Large, Simple and the "Large + 2 changes" summary; Family tabs People, Pets, Bots; profile tabs Overview, Memories, Limits, Topics with Limits and Topics child-only for owner and admin; role table and credential roles (owner, admin, adult need a PIN) match `roles.ts` and `shared/personCredentialRoles.ts`.

## Remaining gaps

- Wake word (user page and settings): only the registry gating was checked; the wake-word feature itself was not exercised.
- Visual claims in `<Shot>` captions were not compared with the images.
