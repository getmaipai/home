# NEXT-RETIRE-02C: port list for the deleted old-shell test files

The old-shell twins listed below had no importer except their own tests (checked with grep and `tsc --noEmit` right before
the deletion). Each old test file is either ported into the live shell test or retired with a reason. Paths are under
`frontend/src`. Kept on purpose: `apps/people/FaceEnrollmentPage`, `apps/settings/UsersSection`, `apps/settings/RepairsSection`
(the live pages render them).

- `apps/people/PeoplePage.test.tsx`: ported to `shell/pages/FamilyPage.test.tsx` (unknown tab falls back to People; switching tabs updates the URL). Retired: "lists everyone / no edit controls" and "row links to the profile", already covered by FamilyPage's card-grid and card-link tests; the "People and things" tab no longer exists in the live page.
- `apps/people/PersonProfilePage.test.tsx`: ported to `shell/pages/PersonProfilePage.test.tsx` (memories empty and retry, category and scope line, non-admin has no Memories tab, forget-everything confirm then route, batch select count, clear all, audience control for adult and child, Edit offered to an owner, no Edit for an adult on an adult, all five shared-media cases). Retired: "?ids= filter", "unknown person id", "Overview name and role", "bio and role shown", "Edit on your own page", "saving the Edit dialog", "owner sees a child's memories with forget/export" (each already has a live twin test). Retired because the live page no longer has the behavior: the two "Use a real photo" opt-in cases (the live Edit dialog has no photo opt-in) and "Manage in Settings" link-out (the live header has no such link).
- `apps/privacy/PrivacyPage.test.tsx`: retired because every case maps to a live test in `shell/pages/PrivacyPage.test.tsx` (four questions, platform plus package rows, inbound section and its heading, omitted inbound, counts heading, offline group, zero-phone-home copy, retry, loading skeleton, hub rows claim no toggle, package opt-in label, `joinNames`).
- `apps/settings/UsersPage.test.tsx`: ported to `shell/pages/UsersPage.test.tsx` (all removal, batch removal, rename and role-picker cases, 16 tests). Retired: the access-gate case (the live page has its own, without the old "Back to Settings" link).
- `apps/settings/BackupsPage.test.tsx`: retired because `shell/pages/BackupsPage.test.tsx` covers the non-admin gate and the real section with far more cases.
- `apps/settings/ModelsPage.test.tsx`: retired because the live shell has no Models page (models live in `EnginesPage`); `ModelsSection.test.tsx` still covers the section.
- `apps/settings/VoicesPage.test.tsx`: ported to `shell/pages/PersonalManagementPages.test.tsx` (the page title and both section titles). The live title is not a heading role, so the port asserts the text.
- `apps/notifications/NotificationsPage.tsx` and its test: KEPT. After merging main, `shell/Routes.tsx` routes `/notifications` to it, so it is no longer an orphan. Nothing was ported or retired.
- `apps/search/SearchPage.test.tsx`: retired because search is the kit header search fed by `shell/search/providers` (`providers.test.ts` covers app, person, memory, conversation, setting and command matches). The "Ask MaiPai" row has no live twin.
- `shell/SignIn.test.tsx`: ported to `shell/pages/SignInPage.test.tsx` (fewer than 4 digits never submits, a 6-digit PIN is not cut off, a wrong 4-digit PIN does not re-fire, a stale tap error does not resurface). The other cases already had live twins.
- `shell/PhoneHeaderExtras.test.tsx`: retired because the phone header extras menu is not in the live shell (theme: `ThemeToggle.test.tsx`; notifications: `NotificationBell.test.tsx`; search: the kit header search).
- `shell/ProfileSwitcher.test.tsx`: retired because the live rail uses `RailProfile`, which has no profile switcher; "switch profile" and "extraActions" have no live behavior. Flagged: the rail has no switch-profile action at all.
- `apps/settings/ChangeSecretSection.test.tsx`: retired because nothing renders the section any more; the live secret flow is the write-only field in `shell/pages/settings/SettingField.tsx`. Flagged: no live screen changes a person's own PIN through this section.

Stale entries removed (never added): six keys in `frontend/src/dev/kit-classname-override-baseline.json`, one in
`frontend/src/dev/kit-wrapper-baseline.json`, thirteen test keys in `scripts/gate/test-timings.json`.
