// SHELL-SEARCH-02 (docs/plans/shell-search-2026-09-23.md): one provider
// per findable kind, each a thin query over the store that domain
// already owns - never a second index, never a parallel copy of data
// another route already serves. A provider that throws is dropped from
// the response with a log warning, never a failed request (searchRoute
// below is what actually enforces that; this file is just the list).
import { listConversations } from "@/lib/conversationHistory";
import { listActivePeople } from "@/lib/access";
import { listInstalledManifests } from "@/lib/plugins";
import { getRegistry } from "@/lib/settingsRegistry";
import { placeSetting, settingHref, settingsViewerFor } from "@/lib/settingsAreas";
import type { PersonRow } from "@/types";

export interface SearchResult {
  kind: string;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

export interface SearchGroup {
  kind: string;
  heading: string;
  results: SearchResult[];
}

export interface SearchProvider {
  kind: string;
  heading: string;
  search(query: string, actor: PersonRow): Promise<SearchResult[]>;
}

const RESULT_CAP = 8;

// Conversations by title (and body text - listConversations() already
// searches both, CHAT-13's own thread-list search convention): reuses
// the exact function the thread list itself calls, so this provider is
// never a second, divergent conversation query. Temporary chats never
// appear (listConversations() filters mode "temporary" unconditionally)
// and this is always the ACTOR's own conversations (no personId
// argument) - listConversations() has no cross-person "everyone I can
// access" mode today, so this provider doesn't invent one.
const conversationsProvider: SearchProvider = {
  kind: "conversation",
  heading: "Conversations",
  async search(query, actor) {
    return listConversations(actor, undefined, query)
      .slice(0, RESULT_CAP)
      .map((row) => ({
        kind: "conversation",
        id: row.id,
        // chatHeaderBar.tsx's own fallback ("New Chat placeholder, never
        // a blank bar") - the identical text an untitled conversation
        // already shows everywhere else in the app.
        title: row.title || "New Chat",
        href: `/next/chat?conversation=${row.id}`,
      }));
  },
};

// People by display name. GET /api/people's own comment is the real
// disclosure rule already in force: "every signed-in person can see the
// household roster (who's who, not management)" - no per-actor
// narrowing exists at the list level today (checked live in
// routes/people.ts before writing this), so this provider reuses
// listActivePeople() exactly as that route does, never a second,
// stricter filter this route alone would invent.
const peopleProvider: SearchProvider = {
  kind: "person",
  heading: "People",
  async search(query) {
    const normalized = query.trim().toLowerCase();
    return listActivePeople()
      .filter((p) => p.displayName.toLowerCase().includes(normalized))
      .slice(0, RESULT_CAP)
      .map((p) => ({
        kind: "person",
        id: p.id,
        title: p.displayName,
        subtitle: p.role,
        // No per-person detail route exists in the new shell yet
        // (checked live: NextPeoplePage.tsx is a plain list, no
        // selection or deep-link today) - opens the list page, the
        // same simplification the apps provider below makes for the
        // identical reason.
        href: "/next/people",
      }));
  },
};

// Apps by their manifest's own display name - listInstalledManifests()
// (lib/plugins.ts) is the exact pipeline GET /api/plugins already runs,
// never a second manifest scan (a review caught an earlier draft
// re-typing that pipeline inline here).
const appsProvider: SearchProvider = {
  kind: "app",
  heading: "Apps",
  async search(query) {
    const normalized = query.trim().toLowerCase();
    const manifests = listInstalledManifests();
    return manifests
      .filter((m) => m.display.toLowerCase().includes(normalized))
      .slice(0, RESULT_CAP)
      .map((m) => ({
        kind: "app",
        id: m.id,
        title: m.display,
        subtitle: m.description,
        // No per-app detail route exists in the new shell yet (checked
        // live: NextRoutes.tsx has only the "apps" list route) - opens
        // the Apps page, the same simplification the people provider
        // above makes for the identical reason.
        href: "/next/apps",
      }));
  },
};

// Settings by the registry's own labels - SETTINGS.md's "one
// definition": reads getRegistry() (spec/settings/keys.json), never a
// second, hand-kept list of setting names. Where a result opens comes from
// the spec's settings areas (APP-SET-01, lib/settingsAreas.ts): the page,
// section and key that really draw it, `/settings/<area>/<section>#<key>`.
// A key is a result only when the viewer's own page would show it, so a
// child never finds a household key, and a teen never finds an admin's or
// another person's. `expert`-level keys are excluded (SETTINGS.md Rule 4).
const settingsProvider: SearchProvider = {
  kind: "setting",
  heading: "Settings",
  async search(query, actor) {
    const normalized = query.trim().toLowerCase();
    const viewer = settingsViewerFor(actor);
    const results: SearchResult[] = [];
    for (const key of getRegistry()) {
      if (results.length >= RESULT_CAP) break;
      if (!key.honoured_by.includes("home") || key.level === "expert" || !key.label.toLowerCase().includes(normalized)) continue;
      const place = placeSetting(key, viewer);
      if (!place) continue;
      results.push({
        kind: "setting",
        id: key.key,
        title: key.label,
        // `key.help`, when the key declares one, is a real, already-written
        // description of the same setting; otherwise the subtitle is left off.
        subtitle: key.help,
        href: settingHref(place, key.key),
      });
    }
    return results;
  },
};

export const SEARCH_PROVIDERS: readonly SearchProvider[] = [conversationsProvider, peopleProvider, appsProvider, settingsProvider];
