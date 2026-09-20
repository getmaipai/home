import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Shell } from "@maipai/ui/src/Shell";
import type { NavGroup } from "@maipai/ui/src/blocks/dashboard/components/nav-main";
import { isActiveNavPath } from "@maipai/ui/src/nav";
import { getIcon, type IconName } from "@maipai/ui/src/icons";
import { Button } from "@maipai/ui/src/ui/button";
import { NAV_ENTRIES } from "@/shell/nav";
import { APP_CATALOG } from "@/shell/appCatalog";
import { usePinnedApps } from "@/shell/usePinnedApps";
import { useAppearance } from "@/shell/useAppearance";
import { useLook } from "@/shell/useLook";
import { ThemeToggle } from "@/shell/ThemeToggle";
import { ModelPicker } from "@/shell/ModelPicker";
import { NotificationBell } from "@/shell/NotificationBell";
import { ProfileSwitcher } from "@/shell/ProfileSwitcher";
import { HubStatusCard } from "@/shell/HubStatusCard";
import { HomeFooterBar } from "@/shell/HomeFooterBar";
import { routeHeader } from "@/shell/routeHeader";
import { useSearchCommand } from "@/shell/search/useSearchCommand";
import type { SearchResultItem } from "@/shell/search/providers";
import type { Roster } from "@/lib/api";
import type { ReactNode } from "react";

interface AppShellProps {
  person: Roster;
  onSignOut: () => void;
  onPersonChange: () => Promise<void>;
  children: ReactNode;
}

/** The pin/unpin control for "each app's header" (docs/BACKLOG.md's
 * home-screen item, step 6) - the current page's own entry in the app
 * catalog, or nothing on Home itself (`/`), which has nothing to pin.
 * Still real once the rail's own groups cover every catalog route
 * (below): this feeds the dashboard's "Your apps" strip, a person's
 * own subset of the full app list, not rail reachability. */
function PinToggle({ person }: { person: Roster }) {
  const location = useLocation();
  const { isPinned, togglePin, isLoading, isSaving } = usePinnedApps(person.id);
  const entry = APP_CATALOG.find((e) => e.to !== "/" && isActiveNavPath(location.pathname, e.to));
  if (!entry || isLoading) return null;
  const pinned = isPinned(entry.to);
  const Icon = getIcon(pinned ? "pin-off" : "pin");
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={isSaving}
      aria-pressed={pinned}
      aria-label={pinned ? `Unpin ${entry.label}` : `Pin ${entry.label}`}
      onClick={() => togglePin(entry.to)}
    >
      <Icon aria-hidden />
    </Button>
  );
}

// The product mark (spec "The shell, exactly": "the MaiPai Home glyph
// on the rounded gradient tile, 40 px" plus the tagline under the
// wordmark) - Home's own logo image inside the kit's gradient tile
// treatment, not a lucide icon (IconTile is for category icons; the
// brand mark is the product's own art).
function Brand() {
  return (
    // min-h-12/min-w-12 (48px): docs/UI.md's touch-target floor, kept
    // for collapsed too (owner finding, "The collapsed rail,"
    // 2026-09-20) - measured live at 63x40 without it (the sidebar's
    // own hit-area pseudo-element, real for every plain nav row, never
    // credited here; this Link carries its own width/flex classes
    // SidebarMenuButton's merge doesn't fully clear). A 48px real link
    // around the 40px visual tile reads identically to a 40px link with
    // the sidebar's own invisible hit-area extension - same centered
    // icon, same footprint - so this is just a more direct way to the
    // same floor for the one row that has its own competing classes.
    <Link to="/" aria-label="MaiPai Home" className="flex min-h-12 min-w-12 flex-1 items-center gap-2.5 group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:justify-center">
      {/* borderRadius: var(--tile-radius), same token IconTile.tsx draws
          every other tile through - the reference's own gradient product
          tile (owner ruling, "Two looks, one setting": "the logo on a
          40px gradient tile... 12px radius") in Studio, the circle that
          shipped in Calm. */}
      <span
        className="flex size-10 shrink-0 items-center justify-center bg-gradient-to-br from-[var(--hue-blue)] to-[var(--hue-violet)] p-1.5"
        style={{ borderRadius: "var(--tile-radius)", boxShadow: "0 0 16px color-mix(in srgb, var(--hue-violet) 25%, transparent)" }}
      >
        <img src="/brand/maipai-home-icon-light.png" alt="" className="size-full object-contain brand-logo-light" />
        <img src="/brand/maipai-home-icon-dark.png" alt="" className="size-full object-contain brand-logo-dark" />
      </span>
      <span className="min-w-0 group-data-[collapsible=icon]:hidden">
        <span className="block truncate text-base font-semibold tracking-tight studio:text-lg">
          MaiPai <span className="text-primary">Home</span>
        </span>
        {/* Deliberate type-floor exception (docs/UI.md, lane 7 item 3): a
            compact secondary label under the wordmark, the same category
            as a nav group heading (11px uppercase secondary) or a badge -
            never truncated with an ellipsis (COORDINATOR, 2026-09-20: "the
            tagline wraps to a second line... nothing in the rail is ever
            cut"), wraps onto its own second line instead. */}
        <span className="block text-xs text-muted-foreground">Your AI. On your terms.</span>
      </span>
    </Link>
  );
}

function navGroup(label: string, paths: readonly string[]): NavGroup {
  const items = paths.flatMap((to) => { const entry = NAV_ENTRIES.find((e) => e.to === to); return entry ? [{ title: entry.label, url: entry.to, icon: entry.icon as IconName }] : []; });
  return { label, items };
}

/** Home's own wiring around the kit's Shell contract (docs/UI.md): the
 * kit owns the rail/phone-bar/header/footer layout and the search
 * dialog, Home supplies its brand, grouped nav, the hub card, the
 * footer summary, and the header's own actions (PinToggle, ModelPicker,
 * NotificationBell, ProfileSwitcher) - "the kit gets a slot, Home keeps
 * the feature." Nav groups follow the owner's ruling on Home's pages
 * under the kit (home/docs/design/home-pages-2026-09-20.md, "The shell,
 * exactly"): Home, Household, System - Manage is omitted because Home
 * has no Engines/Packages/Updates/Repairs/Backups pages of its own yet
 * (they stay a Settings section, RepairsSection.tsx, until HOME-STACK-04
 * gives them real destinations); Conversations sits under Home,
 * alongside Chat, since the ruling's own Household list (People,
 * Memories, Lists) has no chat-history entry and this is chat's own
 * history. The kit's own header search field (this step) covers touch/
 * phone reachability; Cmd/Ctrl+K and HomePage's own search remain as
 * additional entry points.
 *
 * Known gap, tracked not dropped (docs/BACKLOG.md): the kit's Shell has
 * no TV-focusable rail yet (the arrow-key/remote nav the old hand-built
 * Shell.tsx had via `@noriginmedia/norigin-spatial-navigation`) - a
 * shared/ui follow-up, not one of the five features the owner's ruling
 * protected.
 */
export function AppShell({ person, onSignOut, onPersonChange, children }: AppShellProps) {
  const { setAppearance } = useAppearance(person.id);
  useLook(person.id);
  const navigate = useNavigate();
  const location = useLocation();

  const [query, setQuery] = useState("");
  const { visibleGroups } = useSearchCommand(person.id, query, true);

  function selectSearchResult(item: SearchResultItem) {
    navigate(item.to, item.state ? { state: item.state } : undefined);
  }
  function askMaiPai(q: string) {
    navigate("/chat", { state: { initialText: q } });
  }

  const groups: NavGroup[] = [
    navGroup("Home", ["/", "/chat", "/conversations", "/apps"]),
    navGroup("Household", ["/people", "/memory"]),
    navGroup("System", ["/settings", "/privacy"]),
  ];

  const { title, subtitle } = routeHeader(location.pathname, person);

  return (
    <Shell
      nav={groups}
      brand={<Brand />}
      railStorageKey="maipai-home:shell-rail"
      sidebarFooter={<HubStatusCard person={person} />}
      footer={<HomeFooterBar person={person} />}
      headerTitle={
        <div className="min-w-0">
          {/* Studio (owner ruling, "Two looks, one setting"): "the page
              title at 32px semibold with the subtitle at 14px directly
              under it" - the reference's own larger scale. Calm keeps
              the size that shipped. */}
          <h1 className="truncate text-lg font-semibold sm:text-xl studio:text-[32px]">{title}</h1>
          {subtitle ? <p className="hidden truncate text-sm text-muted-foreground sm:block studio:text-sm">{subtitle}</p> : null}
        </div>
      }
      headerActions={
        <>
          <PinToggle person={person} />
          <ModelPicker person={person} />
          {/* The reference's own "three equal controls... separated by a
              hairline between the toggle and the bell" (owner ruling) -
              Home keeps its own five controls (PinToggle and ModelPicker
              are Home's, not the reference's), so the hairline lands
              where Home's own theme toggle sits, the same relative
              position the reference's own cluster uses. */}
          <span aria-hidden className="hidden studio:mx-1 studio:block studio:h-6 studio:w-px studio:bg-border" />
          <ThemeToggle setAppearance={setAppearance} />
          <NotificationBell />
          <ProfileSwitcher person={person} onSwitched={onPersonChange} onSignOut={onSignOut} />
        </>
      }
      search={{
        groups: visibleGroups,
        query,
        onQueryChange: setQuery,
        onSelect: selectSearchResult,
        onAsk: askMaiPai,
        askLabel: "Ask MaiPai",
        placeholder: "Search, or ask MaiPai...",
      }}
    >
      {children}
    </Shell>
  );
}
