import { Link } from "react-router-dom";
import { Button } from "@maipai/ui/src/ui/button";
import { getIcon } from "@maipai/ui/src/icons";
import { useIsDark } from "@/shell/ThemeToggle";
import { usePendingNotificationCount } from "@/shell/NotificationBell";
import type { Appearance } from "@/shell/useAppearance";

interface PhoneHeaderExtrasProps {
  /** Opens the kit's own command palette (Shell.tsx's `phoneHeaderActions`
   * render prop) - the phone header has no visible search field to click,
   * so this row is the only way left to reach it. */
  openSearch: () => void;
  /** Closes the avatar menu this renders inside (ProfileSwitcher's own
   * popover) - every row here acts like the existing Profile/Sign out
   * rows, which already close on click. */
  close: (opts?: { keepFocus?: boolean }) => void;
  setAppearance: (value: Appearance) => void;
}

// The phone header fold's own extra rows (HOME-UI-02f, owner reference
// "The phone composition," 2026-09-20: "search, theme and the bell move
// under the avatar's menu and into the palette on the phone"). Passed as
// ProfileSwitcher's own `extraActions`, not a second popover - one menu,
// not two, is the whole point of folding these in rather than just
// hiding them.
export function PhoneHeaderExtras({ openSearch, close, setAppearance }: PhoneHeaderExtrasProps) {
  const dark = useIsDark();
  const count = usePendingNotificationCount();
  const SearchIcon = getIcon("search");
  const ThemeIcon = getIcon(dark ? "sun" : "moon");
  const BellIcon = getIcon("bell");

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          // keepFocus: true - this closes the popover and immediately
          // opens the command palette, another overlay wanting the
          // same focus this popover's own default close behavior would
          // otherwise return to the avatar trigger (a code review,
          // HOME-UI-02f: the two could race for it).
          close({ keepFocus: true });
          openSearch();
        }}
        className="h-auto min-h-12 justify-start gap-2 px-2"
      >
        <SearchIcon className="h-4 w-4" aria-hidden />
        <span className="text-base">Search</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          setAppearance(dark ? "light" : "dark");
          close();
        }}
        className="h-auto min-h-12 justify-start gap-2 px-2"
      >
        <ThemeIcon className="h-4 w-4" aria-hidden />
        <span className="text-base">{dark ? "Switch to light appearance" : "Switch to dark appearance"}</span>
      </Button>
      <Button asChild type="button" variant="ghost" onClick={() => close()} className="h-auto min-h-12 justify-start gap-2 px-2">
        <Link to="/notifications">
          <BellIcon className="h-4 w-4" aria-hidden />
          <span className="text-base">Notifications{count > 0 ? ` (${count})` : ""}</span>
        </Link>
      </Button>
    </div>
  );
}
