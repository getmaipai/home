// SHELL-SEARCH-02 (docs/plans/shell-search-2026-09-23.md): one provider
// per findable kind, each a thin query over the store that domain
// already owns - never a second index, never a parallel copy of data
// another route already serves. A provider that throws is dropped from
// the response with a log warning, never a failed request (searchRoute
// below is what actually enforces that; this file is just the list).
import { listConversations } from "@/lib/conversationHistory";
import { listActivePeople } from "@/lib/access";
import { listApps } from "@/lib/apps";
import { getRegistry } from "@/lib/settingsRegistry";
import { placeSetting, settingHref, settingsViewerFor } from "@/lib/settingsAreas";
import type { PersonRow } from "@/types";
import { searchMedia } from "@/lib/media/search";
import { list as listMemories } from "@/lib/memory";
import { listAlarms } from "@/lib/alarms";
import { listCompanionCards } from "@/lib/companionsApp";
import { listCommands } from "@/lib/commands";
import { isOwnerOrAdmin } from "@/lib/access";

export interface SearchResult {
  kind: string;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  /** SEARCH-MODERN-02: [start, end) of the first match in `title`, so a client can highlight it. */
  match?: [number, number];
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
        href: `/chat?conversation=${row.id}`,
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
        href: "/people",
      }));
  },
};

// No "apps" provider (SEARCH-APPS-LINK-01): the packages that
// listInstalledManifests() returns are tools the model calls, not pages,
// and Routes.tsx has no /apps route, so every result linked a dead page.
// The shell's own Apps results come from the frontend APP_CATALOG, whose
// destinations are real routes.

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

// APP-KIND-03: installed package apps, found by name, description and the keywords their index page declares.
// The same list and gate as GET /api/apps (listApps), so a person only ever finds an app they may open.
const appsProvider: SearchProvider = {
  kind: "app",
  heading: "Apps",
  async search(query, actor) {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return listApps(actor)
      .filter((app) => words.every((word) => `${app.label} ${app.description} ${app.keywords.join(" ")}`.toLowerCase().includes(word)))
      .slice(0, RESULT_CAP)
      .map((app) => ({ kind: "app", id: app.package, title: app.label, subtitle: app.description, href: app.to }));
  },
};

const mediaProvider: SearchProvider = {
  kind: "media",
  heading: "Media",
  async search(query, actor) {
    return searchMedia(actor, query).flatMap((group) => group.rows).slice(0, RESULT_CAP).map((row) => ({
      kind: "media", id: row.id, title: row.title, ...(row.subtitle ? { subtitle: row.subtitle } : {}), href: row.href,
    }));
  },
};

function titleOf(text: string): string {
  const line = text.trim().replace(/\s+/g, " ");
  return line.length > 100 ? `${line.slice(0, 97)}...` : line;
}

// SEARCH-MODERN-01: memories through the memory page's own list() (canRead
// already narrows it to what this actor may see), plain memories only, never
// entity or episode records.
const memoriesProvider: SearchProvider = {
  kind: "memory",
  heading: "Memories",
  async search(query, actor) {
    const needle = query.trim().toLowerCase();
    return listMemories(actor)
      .filter((m) => m.record_kind === "memory" && `${m.text} ${m.category}`.toLowerCase().includes(needle))
      .slice(0, RESULT_CAP)
      .map((m) => ({ kind: "memory", id: m.id, title: titleOf(m.text), subtitle: m.category, href: `/memory?ids=${encodeURIComponent(m.id)}` }));
  },
};

// The actor's own alarms and reminders (listAlarms is already per person).
const alarmsProvider: SearchProvider = {
  kind: "alarm",
  heading: "Alarms",
  async search(query, actor) {
    const needle = query.trim().toLowerCase();
    return listAlarms(actor)
      .filter((a) => `${a.label} ${a.tag} ${a.time}`.toLowerCase().includes(needle))
      .slice(0, RESULT_CAP)
      .map((a) => ({ kind: "alarm", id: a.id, title: a.label || "Alarm", subtitle: a.time, href: "/clock" }));
  },
};

// Companions through the same card list the Companions page draws, so a
// person finds only companions their age band and household settings allow.
const companionsProvider: SearchProvider = {
  kind: "companion",
  heading: "Companions",
  async search(query, actor) {
    const needle = query.trim().toLowerCase();
    return listCompanionCards(actor)
      .filter((card) => `${card.name} ${card.tagline}`.toLowerCase().includes(needle))
      .slice(0, RESULT_CAP)
      .map((card) => ({ kind: "companion", id: card.id, title: card.name, subtitle: card.tagline, href: "/companions" }));
  },
};

// Household chat commands: the same owner-or-admin gate as GET /api/commands.
const commandsProvider: SearchProvider = {
  kind: "command",
  heading: "Commands",
  async search(query, actor) {
    if (!isOwnerOrAdmin(actor)) return [];
    const listed = listCommands(actor);
    if (!listed.ok) return [];
    const needle = query.trim().toLowerCase();
    return listed.value
      .filter((c) => c.trigger.toLowerCase().includes(needle))
      .slice(0, RESULT_CAP)
      .map((c) => ({ kind: "command", id: c.id, title: c.trigger, href: "/settings" }));
  },
};

export const SEARCH_PROVIDERS: readonly SearchProvider[] = [conversationsProvider, peopleProvider, appsProvider, settingsProvider, mediaProvider, memoriesProvider, alarmsProvider, companionsProvider, commandsProvider];

// SEARCH-MODERN-02: one score over every provider's matches. Exact title 0,
// title starts with the query 1, a word in the title starts with it 2, the
// query appears elsewhere in the title 3, subtitle only 4. Lower is better;
// results keep their provider's own order within a score (stable sort).
export function matchScore(result: SearchResult, query: string): number {
  const q = query.trim().toLowerCase();
  const title = result.title.toLowerCase();
  if (title === q) return 0;
  if (title.startsWith(q)) return 1;
  if (title.split(/[\s\-_/]+/).some((word) => word.startsWith(q))) return 2;
  if (title.includes(q)) return 3;
  return 4;
}

/** Orders each group's results by score, marks the title match, and orders groups by their best result (ties keep provider order). */
export function rankGroups(groups: SearchGroup[], query: string): SearchGroup[] {
  const q = query.trim().toLowerCase();
  const ranked = groups.map((group) => {
    const scored = group.results.map((result, index) => ({ result, index, score: matchScore(result, q) }));
    scored.sort((a, b) => a.score - b.score || a.index - b.index);
    const results = scored.map(({ result }) => {
      const at = result.title.toLowerCase().indexOf(q);
      return at >= 0 ? { ...result, match: [at, at + q.length] as [number, number] } : result;
    });
    return { group: { ...group, results }, best: scored[0]?.score ?? 5 };
  });
  return ranked.map((entry, index) => ({ ...entry, index })).sort((a, b) => a.best - b.best || a.index - b.index).map((entry) => entry.group);
}
