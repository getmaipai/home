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

Package apps (APP-KIND-01 to 04) join this catalog with no rebuild. A package whose manifest lists
`contributes.pages` is an app: `GET /api/apps` lists the ones the asking person may open (role, enabled, platform and
capabilities, the same gate as the page and data routes), `useAppCatalog()` in `shell/useAppCatalog.ts` merges them with
`APP_CATALOG`, and the merged list feeds search, favorites and the route header. One route, `apps/*`, opens every one of them:
`PackageAppPage` fetches the page document (`GET /api/plugins/:id/pages/:pageId`) and draws it with the kit's SchemaPage inside
the package scope, so a package page reads only its own package and navigates only inside `/apps/<id>`. Pins are unchanged: a
package app pins by its route (`/apps/<id>`) in `ui.pinned_apps`; an app that is uninstalled, disabled or hidden by role is
absent from the catalog, `favoriteApps` skips its pin, and the stored pin stays so a reinstall brings it back. While Incognito
is on, an app whose manifest says `incognito: "blocked"` is left out. An app that declares `contributes.settings_area` gets a Settings gear in its toolbar that opens `/settings/<area id>` (the area rides on the app's row in `GET /api/apps`; `shell/pages/settings/packageAreas.ts` merges it with the spec areas). How to write one: "Writing an app package" in the org
`docs/PACKAGES.md`. The design is [plans/app-kind-2026-10-16.md](plans/app-kind-2026-10-16.md).

## Package apps in the left rail (LEFTNAV-APPS-01)

Package apps the hub lists for the person (`GET /api/apps`: role, age band, surface and Incognito already applied) reach the
rail two ways. A pinned app is a named icon link below Home, Chat, Library and People, at most six, the open one highlighted. A
grid button at the foot of the rail ("All apps", a link) opens the All apps page at `/all-apps` (`AllAppsPage`, built on the kit's
`AppDirectory`, APPS-DIRECTORY-01). It scales to dozens of apps: a search box focused on open that filters as you type across name,
description, category and keywords; Favorites first (the person's pins, in order), then one section per category, then "Built in"
(the core apps, which open but have no star); a star on each tile that saves `ui.pinned_apps`, the same list the rail draws and the
app page's own star edits (held with a reason while six are pinned); arrow keys, Home and End between tiles; an empty state with
Clear search. The phone keeps the same 56px rail, so the grid button is the same.

Defaults come from the app's manifest, never from Home: the index page's `pinned_by_default` and `pin_order` (`@maipai/spec`
0.1.157) pin Weather for everyone who may open it. A person who has never pinned or unpinned anything (`ui.pinned_apps` still has
its default) starts with those; the first change saves the whole list and from then on their list wins, even when empty. A person
whose list was saved before this existed keeps it and finds Weather in "All apps". `AppRail` in `@maipai/ui` draws the rail (`railApps`, `onRailAppPinChange`, `allAppsHref`; without `allAppsHref` the grid button opens the older popover list); Home passes `railApps()` from `appCatalog.ts` and `railAllAppsHref`. No drag to reorder: the kit has no
sortable list.
