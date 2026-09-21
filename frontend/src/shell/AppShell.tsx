import { forwardRef, useState, type ComponentPropsWithoutRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Shell } from "@maipai/ui/src/Shell";
import type { NavGroup } from "@maipai/ui/src/blocks/dashboard/components/nav-main";
import { isActiveNavPath } from "@maipai/ui/src/nav";
import { getIcon, type IconName } from "@maipai/ui/src/icons";
import { Button } from "@maipai/ui/src/ui/button";
import { Badge } from "@maipai/ui/src/ui/badge";
import { cn } from "@maipai/ui/src/utils";
import { NAV_ENTRIES } from "@/shell/nav";
import { APP_CATALOG } from "@/shell/appCatalog";
import { usePinnedApps } from "@/shell/usePinnedApps";
import { useAppearance, type Appearance } from "@/shell/useAppearance";
import { useLook } from "@/shell/useLook";
import { ThemeToggle } from "@/shell/ThemeToggle";
import { ModelPicker } from "@/shell/ModelPicker";
import { NotificationBell, NotificationToaster, usePendingNotificationCount } from "@/shell/NotificationBell";
import { ProfileSwitcher } from "@/shell/ProfileSwitcher";
import { PhoneHeaderExtras } from "@/shell/PhoneHeaderExtras";
import { HubStatusCard } from "@/shell/HubStatusCard";
import { HomeFooterBar } from "@/shell/HomeFooterBar";
import { routeHeader } from "@/shell/routeHeader";
import { useSearchCommand } from "@/shell/search/useSearchCommand";
import type { SearchResultItem } from "@/shell/search/providers";
import type { Roster } from "@/lib/api";
import type { ReactNode } from "react";
import { version } from "../../../package.json";

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

// The "MaiPai Home" text, the accent on the second word, shared by
// Brand (the rail's own tile-plus-tagline mark, look-scaled) and
// PhoneWordmark (a fixed size per the phone reference, not look-scaled)
// below - a code review, HOME-UI-02f: the two had retyped this same
// text/accent pairing independently, a real drift risk (the "Studio"
// look's own accent-glow/size pass already touched Brand's copy once).
// Each caller keeps its own sizing className; only the text itself is
// one definition now.
function WordmarkText({ className }: { className?: string }) {
  return (
    <span className={className}>
      MaiPai <span className="text-primary">Home</span>
    </span>
  );
}

// The product mark (spec "The shell, exactly": "the MaiPai Home glyph
// on the rounded gradient tile, 40 px" plus the tagline under the
// wordmark) - Home's own logo image inside the kit's gradient tile
// treatment, not a lucide icon (IconTile is for category icons; the
// brand mark is the product's own art).
//
// forwardRef + spread ...props (ui-v0.4.4 follow-up, found by pixel-
// measuring a live capture): app-sidebar.tsx wraps `brand` in
// `<SidebarMenuButton asChild>`, a Radix Slot contract that clones its
// single child with the button's own props (className, data-slot,
// data-active, and so on) merged in - a contract only a component that
// actually accepts and forwards its own props can honor. This
// component took none (a bare `function Brand()`), so every className
// app-sidebar.tsx ever set on that wrapper - v0.4.1 through v0.4.4's
// own padding fixes included - was silently dropped before it reached
// this Link; the brand tile was never actually receiving the rail's
// own inset, no version of it, which is why pixel-measuring the built
// capture kept finding it clipped at x 0 no matter what the wrapper's
// own className said. `props.className` last in `cn()` so the kit's
// own values (padding, gap) win over this component's base layout
// classes where they overlap, matching every other `asChild` child in
// this file's own nav rows (NavLink already forwards correctly).
export const Brand = forwardRef<HTMLAnchorElement, ComponentPropsWithoutRef<"a">>(function Brand({ className, ...props }, ref) {
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
    <Link
      ref={ref}
      to="/"
      aria-label="MaiPai Home"
      {...props}
      className={cn("flex min-h-12 min-w-12 flex-1 items-center gap-2.5 group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:justify-center", className)}
    >
      {/* borderRadius: var(--tile-radius), same token IconTile.tsx draws
          every other tile through - the reference's own gradient product
          tile (owner ruling, "Two looks, one setting": "the logo on a
          40px gradient tile... 12px radius") in Studio, the circle that
          shipped in Calm. */}
      {/* size-10 (40px) is Calm's own tile; Studio's exact 48px mark
          (owner findings, "The Studio look, the numbers," 2026-09-20
          18:15) replaces it under studio: - the accent glow already
          here matches that same finding's "accent glow" on the mark. */}
      <span
        className="flex size-10 studio:size-12 shrink-0 items-center justify-center bg-gradient-to-br from-[var(--hue-blue)] to-[var(--hue-violet)] p-1.5"
        style={{ borderRadius: "var(--tile-radius)", boxShadow: "0 0 16px color-mix(in srgb, var(--hue-violet) 25%, transparent)" }}
      >
        <img src="/brand/maipai-home-icon-light.png" alt="" className="size-full object-contain brand-logo-light" />
        <img src="/brand/maipai-home-icon-dark.png" alt="" className="size-full object-contain brand-logo-dark" />
      </span>
      <span className="min-w-0 group-data-[collapsible=icon]:hidden">
        {/* text-lg (18px) was Studio's own rough estimate; 19px with
            -0.4px tracking is the exact reference figure (owner
            findings, "The Studio look, the numbers," 2026-09-20
            18:15) - arbitrary values since neither is a Tailwind
            step. */}
        <WordmarkText className="block truncate text-base font-semibold tracking-tight studio:text-[19px] studio:tracking-[-0.4px]" />
        {/* Deliberate type-floor exception (docs/UI.md, lane 7 item 3): a
            compact secondary label under the wordmark, the same category
            as a nav group heading (11px uppercase secondary) or a badge -
            never truncated with an ellipsis (COORDINATOR, 2026-09-20: "the
            tagline wraps to a second line... nothing in the rail is ever
            cut"), wraps onto its own second line instead. */}
        {/* Studio's own exact 11px, a deliberate type-floor exception too
            (owner findings, "The Studio look, the numbers," 2026-09-20
            18:15) - a hair under Calm's own text-xs (12px). */}
        <span className="block text-xs studio:text-[11px] text-muted-foreground">Your AI. On your terms.</span>
      </span>
    </Link>
  );
});

// HOME-UI-02f's own phone-only header title (Shell.tsx's `phoneHeaderTitle`):
// the owner's phone reference, "The phone composition" (2026-09-20) -
// "the product wordmark at the left (16px semibold, the accent on the
// second word as the logo does), a small version pill beside it... nothing
// else." Deliberately not Brand: Brand is the rail's own 40px tile-plus-
// tagline mark, sized and spaced for a sidebar row, not a compact header
// - this is its own, smaller reading of the same wordmark.
function PhoneWordmark() {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <WordmarkText className="truncate text-base font-semibold tracking-tight" />
      <Badge variant="secondary" className="shrink-0">
        v{version}
      </Badge>
    </div>
  );
}

// HOME-UI-02f's own avatar menu content (Shell.tsx's `phoneHeaderActions`
// render prop): a dedicated component, not inline in AppShell's own
// return, specifically so `usePendingNotificationCount()`'s poll only
// runs where this actually renders - `phoneHeaderActions` is a render
// prop Shell.tsx only ever calls on phone (`showPhoneHeader`), so
// keeping the hook inline at AppShell's own top level (an earlier draft
// did) meant it polled and re-rendered the WHOLE shell every 15 seconds
// on desktop too, for a boolean only this phone-only avatar dot reads
// (a code review, HOME-UI-02f).
function PhoneAvatarMenu({
  person,
  onPersonChange,
  onSignOut,
  openSearch,
  setAppearance,
}: {
  person: Roster;
  onPersonChange: () => Promise<void>;
  onSignOut: () => void;
  openSearch: () => void;
  setAppearance: (value: Appearance) => void;
}) {
  const pendingNotifications = usePendingNotificationCount();
  return (
    <ProfileSwitcher
      person={person}
      onSwitched={onPersonChange}
      onSignOut={onSignOut}
      dot={pendingNotifications > 0}
      extraActions={(close) => <PhoneHeaderExtras openSearch={openSearch} close={close} setAppearance={setAppearance} />}
    />
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
 * the feature." Nav groups follow the owner's "Navigation, corrected"
 * ruling (2026-09-20, home/docs/design/home-pages-2026-09-20.md):
 * **Home** (Home, Chat, Apps), **Household** (People - Memories moved
 * onto a person's own profile, reached from there, not a rail item of
 * its own), **System** (Settings, Privacy - Privacy's own move into a
 * Settings section is HOME-UI-03's, not touched here). Manage is
 * omitted because Home has no Engines/Packages/Updates/Repairs/Backups
 * pages of its own yet (they stay a Settings section,
 * RepairsSection.tsx, until HOME-STACK-04 gives them real
 * destinations). Conversations is gone entirely - it is Chat's own
 * thread list now, never a rail item. `phoneNavMax={4}` on `<Shell>`
 * below matches the same ruling's own phone tab bar: "Home, Chat, Apps,
 * More" - three real destinations, not the kit's own default four,
 * before folding the rest (People, Settings, Privacy) under More. The
 * kit's own header search field covers touch/phone reachability;
 * Cmd/Ctrl+K and HomePage's own search remain as additional entry
 * points.
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
    navGroup("Home", ["/", "/chat", "/apps"]),
    navGroup("Household", ["/people"]),
    navGroup("System", ["/settings", "/privacy"]),
  ];

  const { title, subtitle } = routeHeader(location.pathname, person);

  return (
    <>
      {/* A new arrival becoming a Toast used to live entirely inside
          NotificationBell - the phone header fold hides that whole
          component on phone (phoneHeaderActions renders PhoneAvatarMenu
          instead of headerActions there), which silently took this
          toast behavior with it (a code review, HOME-UI-02f). Mounted
          here, unconditionally, so a toast fires the same way
          regardless of viewport or which header branch is showing. */}
      <NotificationToaster />
      <Shell
        nav={groups}
        brand={<Brand />}
        railStorageKey="maipai-home:shell-rail"
        phoneNavMax={4}
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
        phoneHeaderTitle={
          <>
            {/* The reference's own phone header shows only the wordmark,
                but the page's real title still needs to exist somewhere
                as a real heading - a phone with no h1 at all is both an
                accessibility regression (nothing announces which page
                this is to a screen reader) and a real break for every
                phone capture in scripts/screenshot.ts, all of which wait
                on getByRole("heading", { level: 1 }) to know a page has
                actually loaded (found running this item's own capture:
                the desktop headerTitle's own h1 was the ONLY h1 on any
                page - no page's own content renders one - so removing it
                from the phone header removed it everywhere on phone).
                sr-only keeps it real and announced without showing on
                screen, matching the reference's own "nothing else". */}
            <h1 className="sr-only">{title}</h1>
            <PhoneWordmark />
          </>
        }
        phoneHeaderActions={(openSearch) => (
          <PhoneAvatarMenu person={person} onPersonChange={onPersonChange} onSignOut={onSignOut} openSearch={openSearch} setAppearance={setAppearance} />
        )}
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
    </>
  );
}
