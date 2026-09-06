import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Page } from "@/kit/primitives/Page";
import { SettingsRenderer } from "@/kit/settings/SettingsRenderer";
import { Input } from "@/kit/ui/input";
import { Button } from "@/kit/ui/button";
import { cn } from "@/kit/utils";
import { BackupsSection } from "@/apps/settings/BackupsSection";
import { ModelsSection } from "@/apps/settings/ModelsSection";
import { ChangeSecretSection } from "@/apps/settings/ChangeSecretSection";
import { VoiceCatalogSection } from "@/apps/settings/VoiceCatalogSection";
import { ClonedVoicesSection } from "@/apps/settings/ClonedVoicesSection";
import { HuggingFaceTokenSection } from "@/apps/settings/HuggingFaceTokenSection";
import { RoutingStatsSection } from "@/apps/settings/RoutingStatsSection";
import { CommandsSection } from "@/apps/settings/CommandsSection";
import { isOwnerOrAdminRole, type Roster } from "@/lib/api";

interface SettingsPageProps {
  person: Roster;
  /** Re-fetches the signed-in person from App.tsx's own state. Threaded
   * down for ChangeSecretSection: a code review-adjacent gap this session
   * flagged and deferred earlier tonight (docs/dev.md's PIN-change slice)
   * - setting a first PIN left this page showing "doesn't have one yet"
   * until the next full reload, since `person` was only ever loaded once
   * at the top of the app with no way for a page to ask for a fresh copy. */
  onPersonChange: () => void;
}

interface TreeEntry {
  id: string;
  label: string;
}

const HOUSEHOLD_TREE: TreeEntry[] = [
  { id: "settings-household.system", label: "System" },
  { id: "settings-household.ai", label: "AI model tuning" },
  { id: "settings-household.integrations", label: "Integrations" },
  { id: "settings-household.notifications", label: "Notifications" },
  { id: "section-hf-token", label: "Hugging Face token" },
  { id: "section-models", label: "AI models" },
  { id: "section-backups", label: "Backups" },
  { id: "section-routing", label: "Plugin routing" },
];

const PERSON_TREE: TreeEntry[] = [
  { id: "settings-profile.appearance", label: "Appearance" },
  { id: "settings-person.persona", label: "Personality" },
  { id: "settings-person.voice", label: "Voice" },
  // Matches groupSettings.ts's SECTION_TITLES entry for this same
  // section exactly, not just "close enough" - a code review, 2026-09-05,
  // found this hardcoded copy had already drifted from that rename
  // ("Notifications" here, "My notifications" on the actual card),
  // reintroducing a smaller version of the duplicate-heading confusion
  // this whole tree/tabs round was built to fix.
  { id: "settings-person.notifications", label: "My notifications" },
  { id: "section-voice-catalog", label: "Voice catalog" },
  { id: "section-cloned-voices", label: "Cloned voices" },
  { id: "section-change-secret", label: "PIN / password" },
  { id: "section-commands", label: "Commands" },
];

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// The one real piece of shape the Household and Me tab bodies shared - a
// hand-built section, hidden while a search is active, in its own
// vertical stack - pulled out on its own after a code review (2026-09-05)
// caught the two ~60-line bodies drifting (PERSON_TREE's own copy of the
// "My notifications" label going stale). The sections themselves stay
// inline in each branch: they differ too much (different components,
// different props, an owner/admin gate only the household branch needs)
// to earn a shared list-of-components abstraction on top of this.
function ExtraSections({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  if (hidden) return null;
  return <div className="flex flex-col gap-6">{children}</div>;
}

// Step 7's own shape (docs/plans/session-b-ui.md: "a tree sidebar..., a
// search filter..., scope tabs... URL-bound"), built now rather than at
// its own turn: a design review (2026-09-05), reference in hand (VS
// Code's own Settings editor - a User/Workspace tab pair, a tree on the
// left, a search box, each setting stacked title/description/control),
// found the flat single-column list from step 2 read as "nothing like"
// that reference. Tabs map onto the two scopes this page already
// rendered stacked: "Household" (VS Code's Workspace) and "Me" (User).
// Device-scope has no real keys yet (docs/SETTINGS.md's third scope,
// still theoretical) - no tab for it until one does; inventing an empty
// tab ahead of need is exactly what docs/UI.md warns against.
export function SettingsPage({ person, onPersonChange }: SettingsPageProps) {
  // Shares the real definition (backend/src/wire.ts's isOwnerOrAdminRole,
  // the same one backend/src/lib/access.ts's isOwnerOrAdmin and
  // apps/people/roles.ts's requiresSecret use) instead of a third
  // hand-copy of "owner or admin" (a code review, 2026-09-04, found
  // exactly that here).
  const canManageBackups = isOwnerOrAdminRole(person.role);
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  // Household-scope settings are readable by anyone signed in but
  // writable only by owner/admin (backend/src/lib/settings.ts's
  // assertCanAccessScope) - Jesse, 2026-09-05, asked directly whether
  // "Household" was meant to be the admin-only tab. It should be: a
  // non-admin landing there would see live-looking controls that
  // silently 403 on every change. Forced to "me" for anyone else, with
  // no tab switcher shown at all - there is only one scope they can act
  // on, so there is nothing to switch between.
  const tab: "household" | "me" = !canManageBackups ? "me" : searchParams.get("tab") === "me" ? "me" : "household";

  function setTab(next: "household" | "me") {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set("tab", next);
      return params;
    });
  }

  const tree = tab === "household" ? HOUSEHOLD_TREE : PERSON_TREE;

  // The tree highlights whichever section is scrolled near the top of
  // the content pane, the same "scrollspy" VS Code's own Settings editor
  // does (Jesse, 2026-09-05: "show active highlighted item") - a
  // shrunk-root IntersectionObserver (only the top 30% of the scroll
  // container counts) rather than "whatever crosses 0%", so a section
  // only takes the highlight once it's actually near the reading
  // position, not the instant its bottom edge peeks into view.
  const [activeId, setActiveId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topmost = visible.reduce((a, b) => (a.boundingClientRect.top <= b.boundingClientRect.top ? a : b));
        setActiveId(topmost.target.id);
      },
      { root, rootMargin: "0px 0px -70% 0px", threshold: 0 },
    );
    // Re-scans on every DOM change under `root`, not just when `tree`/
    // `search` change: a code review (2026-09-05) found the original
    // version ran once at mount, before SettingsRenderer's own network-
    // backed queries had resolved - none of the section elements existed
    // yet, so it observed nothing and never got a second chance (neither
    // dependency changes once the data actually arrives). A
    // MutationObserver re-syncs on that first data-arrival, on a tab
    // switch, on a search keystroke, and on the advanced-settings fold
    // toggle alike, so nothing else has to know or track exactly when
    // section elements come and go.
    function resync() {
      observer.disconnect();
      for (const entry of tree) {
        const el = document.getElementById(entry.id);
        if (el) observer.observe(el);
      }
    }
    resync();
    const mutationObserver = new MutationObserver(resync);
    mutationObserver.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
    };
  }, [tree]);

  return (
    <Page title="Settings">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 pb-4">
        {/* Household/Me is the primary scope switcher, not a nice-to-have
            nav aid - it stays visible and reachable at every width, even
            once the tree sidebar below hides for lack of room. A design
            review (2026-09-05) caught an earlier draft hiding both
            together under the same breakpoint, which made "Me" scope
            settings (Voice, Personality, Change PIN, Commands)
            unreachable on anything narrower than 1024px. Shown only to
            owner/admin: a non-admin has nothing to switch to (see `tab`
            above) - there is no tab bar to render for one destination. */}
        {canManageBackups ? (
          <div className="flex w-full max-w-xs gap-1 rounded-lg border border-border p-1 text-sm">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setTab("household")}
              className={cn("h-auto flex-1 rounded-md px-2 py-1.5", tab === "household" ? "bg-muted font-medium" : "text-muted-foreground")}
            >
              Household
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setTab("me")}
              className={cn("h-auto flex-1 rounded-md px-2 py-1.5", tab === "me" ? "bg-muted font-medium" : "text-muted-foreground")}
            >
              Me
            </Button>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
          {/* The tree sidebar: a second, page-local sidebar alongside the
              shell's own global one (VS Code's own settings editor is the
              same idea - its own tree lives inside the editor tab, not in
              place of the activity bar). Scrolls the content pane to a
              section rather than owning a second copy of it. `lg`, not
              `md`: the tree plus the shell's own global sidebar leaves the
              content column badly squeezed below ~1024px (found live at
              an 800px viewport - a settings row wrapped into a near-
              vertical stack of single words). Below that width, the tree
              hides and the content gets the full column back. */}
          <aside className="hidden w-48 shrink-0 flex-col gap-0.5 lg:flex">
            {tree.map((entry) => (
              <Button
                key={entry.id}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => scrollToSection(entry.id)}
                className={cn(
                  "h-auto justify-start rounded-md px-2 py-1.5 text-left font-normal",
                  activeId === entry.id ? "bg-muted font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {entry.label}
              </Button>
            ))}
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search settings"
              aria-label="Search settings"
            />
            <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
              {tab === "household" ? (
                <>
                  <SettingsRenderer scope="household" scopeValue="household" filter={search} />
                  <ExtraSections hidden={!!search.trim()}>
                    {/* voice.hf_token is a household-scope key: writing it
                        already requires owner/admin (lib/settings.ts's
                        assertCanAccessScope), same gate as backups/models
                        below. */}
                    {canManageBackups ? (
                      <div id="section-hf-token">
                        <HuggingFaceTokenSection />
                      </div>
                    ) : null}
                    {canManageBackups ? (
                      <div id="section-models">
                        <ModelsSection />
                      </div>
                    ) : null}
                    {canManageBackups ? (
                      <div id="section-backups">
                        <BackupsSection person={person} />
                      </div>
                    ) : null}
                    {canManageBackups ? (
                      <div id="section-routing">
                        <RoutingStatsSection />
                      </div>
                    ) : null}
                  </ExtraSections>
                </>
              ) : (
                <>
                  <SettingsRenderer scope="person" scopeValue={`person:${person.id}`} filter={search} />
                  <ExtraSections hidden={!!search.trim()}>
                    <div id="section-voice-catalog">
                      <VoiceCatalogSection personId={person.id} />
                    </div>
                    {/* Not gated to owner/admin: selecting a voice (cloned
                        or catalog) is a person-scope choice any signed-in
                        person already makes for themselves via
                        tts.voice_id. Upload and delete carry their own,
                        narrower checks (routes/voice.ts). */}
                    <div id="section-cloned-voices">
                      <ClonedVoicesSection person={person} />
                    </div>
                    <div id="section-change-secret">
                      <ChangeSecretSection person={person} onChanged={onPersonChange} />
                    </div>
                    {/* Household-wide list, visible to anyone signed in
                        (the same GET /api/plugins visibility); create/
                        delete carry their own, narrower checks
                        (lib/commands.ts), rendered inside the section
                        itself rather than gating the whole thing here. */}
                    <div id="section-commands">
                      <CommandsSection person={person} />
                    </div>
                  </ExtraSections>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </Page>
  );
}
