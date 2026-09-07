# App library and favorites

Home is the hub; each app owns its content experience. The shell keeps Home,
Apps, Chat, and Search available, with up to six additional favorites and
Privacy/Settings below. Mobile exposes Apps directly in its bottom navigation.
The full Favorites filter remains available when pins exceed the sidebar limit.

`frontend/src/shell/appCatalog.ts` supplies launchable app metadata to the
library, command palette, Home favorites, and sidebar. Each entry has a stable
route, label, icon, description, category, and search keywords. The library
searches all entries; the command palette intentionally limits quick results.
App matches in the palette render independently of remote content searches.

To add Music, Videos, or another app:

1. Implement and register its real frontend route in `App.tsx`.
2. Register its metadata in `appCatalog.ts` and its navigation label in `nav.ts`.
3. Verify its route, search keywords, and pin/launch behavior.

Do not add every new app to the permanent sidebar. The library owns discovery;
people choose shortcuts by pinning apps. `ui.pinned_apps` stores routes per
person, with optimistic updates and rollback on failed saves. Pins preserve
selection order; stale routes are ignored.

Installed backend plugins are not automatically launchable frontend apps.
Automatic package discovery needs a route-registration and app-metadata
contract before it can safely contribute entries to this catalog.
