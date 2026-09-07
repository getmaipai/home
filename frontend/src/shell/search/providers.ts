import { APP_CATALOG, filterApps } from "@/shell/appCatalog";
import { api } from "@/lib/api";
import { NAV_ENTRIES } from "@/shell/nav";

export interface SearchResultItem {
  id: string;
  label: string;
  sublabel?: string;
  icon: string;
  to: string;
  state?: Record<string, unknown>;
}

export interface SearchGroup {
  heading: string;
  items: SearchResultItem[];
}

const RESULTS_PER_PROVIDER = 6;

// "Last token prefix-matched" (docs/plans/session-b-ui.md step 6): typing
// "kitchen we" still finds "Weather" by its last fragment, the same way a
// launcher lets you keep typing past an irrelevant first word rather than
// restarting the search. An empty token matches nothing - the palette's
// own empty-query state is the plain apps list, not every record in the
// house (see `pagesProvider` below, the one provider that answers an
// empty query on purpose).
function lastToken(query: string): string {
  const parts = query.trim().toLowerCase().split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const token = lastToken(query);
  if (!token) return false;
  return fields.some((field) => !!field && field.toLowerCase().split(/\s+/).some((word) => word.startsWith(token)));
}

// Each provider is independent and best-effort (step 6: "a failing
// provider contributes nothing") - a network error or an unexpected
// shape from one never keeps the rest of the palette from answering, so
// every provider catches its own failure rather than relying on the
// caller to isolate it.

function pagesProvider(query: string): SearchGroup {
  // The one provider that answers an empty query: with nothing typed yet
  // the palette is just an app switcher (the nav note's "search plus
  // launcher" combination), which only makes sense if the plain page list
  // shows up before a single keystroke.
  const items = NAV_ENTRIES.filter((e) => (e.to === "/apps") && (query.trim() === "" || matchesQuery(query, e.label))).map(
    (e) => ({ id: `page:${e.to}`, label: e.label, icon: e.icon, to: e.to }),
  );
  return { heading: "Pages", items: items.slice(0, RESULTS_PER_PROVIDER) };
}

async function peopleProvider(query: string): Promise<SearchGroup> {
  try {
    const people = await api.people();
    const items = people
      .filter((p) => matchesQuery(query, p.display_name, p.nickname))
      .slice(0, RESULTS_PER_PROVIDER)
      // No per-person deep link exists yet (PeoplePage.tsx has no route
      // per person) - every match opens the roster, same interim shape
      // the settings and commands providers below use.
      .map((p) => ({ id: `person:${p.id}`, label: p.display_name, sublabel: p.role, icon: "users", to: "/people" }));
    return { heading: "People", items };
  } catch {
    return { heading: "People", items: [] };
  }
}

async function memoriesProvider(query: string): Promise<SearchGroup> {
  try {
    const memories = await api.memories();
    const items = memories
      .filter((m) => matchesQuery(query, m.text, m.category))
      .slice(0, RESULTS_PER_PROVIDER)
      // Reuses MemoryPage's own `?ids=` deep-link filter (chatMemoryChip.tsx,
      // step 4/5) rather than inventing a second way to jump to one record.
      .map((m) => ({ id: `memory:${m.id}`, label: m.text, sublabel: m.category, icon: "brain", to: `/memory?ids=${encodeURIComponent(m.id)}` }));
    return { heading: "Memories", items };
  } catch {
    return { heading: "Memories", items: [] };
  }
}

// Mocked, same reason chatThreadListAdapter.ts is (step 4, pending
// Session A's per-thread conversation routes): there is exactly one real
// conversation per person today, and its title lives only inside
// ChatPage's own runtime, not anywhere this module can read it from. This
// answers the one thing that's actually true - "Chat" is a real
// destination - without fabricating a list of conversations that don't
// exist as separate records yet.
function conversationsProvider(query: string): SearchGroup {
  const items = matchesQuery(query, "Chat", "Conversation")
    ? [{ id: "conversation:main", label: "Chat", icon: "message-circle", to: "/chat" }]
    : [];
  return { heading: "Conversations", items };
}

async function settingsProvider(query: string): Promise<SearchGroup> {
  try {
    const keys = await api.settingsRegistry();
    const items = keys
      .filter((k) => matchesQuery(query, k.label, k.help))
      .slice(0, RESULTS_PER_PROVIDER)
      // No per-key deep link yet either - step 7 ("settings as an
      // editor") is what gives Settings a URL-bound tree to jump into;
      // until then every match opens the page itself.
      .map((k) => ({ id: `setting:${k.key}`, label: k.label, sublabel: k.help, icon: "settings", to: "/settings" }));
    return { heading: "Settings", items };
  } catch {
    return { heading: "Settings", items: [] };
  }
}

async function commandsProvider(query: string): Promise<SearchGroup> {
  try {
    const commands = await api.commands();
    const items = commands
      .filter((c) => matchesQuery(query, c.trigger))
      .slice(0, RESULTS_PER_PROVIDER)
      // Commands get their own management page in step 7 ("becomes its
      // own schema page linked from the tree") - Settings is the nearest
      // real destination until then.
      .map((c) => ({ id: `command:${c.id}`, label: c.trigger, icon: "sparkles", to: "/settings" }));
    return { heading: "Commands", items };
  } catch {
    return { heading: "Commands", items: [] };
  }
}

/** Runs every provider for the current query, each isolated from the
 * others' failures, and returns only the groups that found something -
 * an empty group would just be a heading with nothing under it. */
export async function runSearchProviders(query: string): Promise<SearchGroup[]> {
  const groups = await Promise.all([
    Promise.resolve({ heading: "Apps", items: filterApps(APP_CATALOG, query).slice(0, RESULTS_PER_PROVIDER).map((app) => ({ id: `app:${app.to}`, label: app.label, sublabel: app.description, icon: app.icon, to: app.to })) }),
    Promise.resolve(pagesProvider(query)),
    peopleProvider(query),
    memoriesProvider(query),
    Promise.resolve(conversationsProvider(query)),
    settingsProvider(query),
    commandsProvider(query),
  ]);
  return groups.filter((g) => g.items.length > 0);
}
