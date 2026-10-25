import { useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { getIcon } from "@maipai/ui/src/icons";
import { usePinnedApps } from "@/shell/usePinnedApps";

// On a phone the shell already draws a bar across the top (the menu button's band). A package app puts its name and its two icon
// buttons (settings, favorites) in that bar instead of in a row of its own, so the stories start a whole row higher. The bar's
// content is a stable component (useHeaderExtra's rule), so the page publishes what it shows through this small store.
export interface PackageAppHeaderState {
  personId: string;
  to: string;
  label: string;
  settingsArea?: string;
}

let current: PackageAppHeaderState | null = null;
const listeners = new Set<() => void>();

export function publishPackageAppHeader(next: PackageAppHeaderState | null): void {
  const same = current === next || (current !== null && next !== null && current.personId === next.personId && current.to === next.to && current.label === next.label && current.settingsArea === next.settingsArea);
  if (same) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function snapshot(): PackageAppHeaderState | null {
  return current;
}

const StarIcon = getIcon("star");
const GearIcon = getIcon("settings");

export function PackageAppHeaderBar() {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  if (!state) return null;
  return <Bar state={state} />;
}

function Bar({ state }: { state: PackageAppHeaderState }) {
  const { isPinned, togglePin, isLoading, isSaving } = usePinnedApps(state.personId);
  const pinned = isPinned(state.to);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <span className="min-w-0 flex-1 truncate text-base font-semibold">{state.label}</span>
      {state.settingsArea ? (
        <Button variant="ghost" size="icon-lg" render={<Link to={`/settings/${state.settingsArea}`} aria-label={`${state.label} settings`} />}>
          <GearIcon aria-hidden="true" />
        </Button>
      ) : null}
      <Button variant="ghost" size="icon-lg" disabled={isLoading || isSaving} aria-pressed={pinned} aria-label={pinned ? "Remove from favorites" : "Add to favorites"} onClick={() => togglePin(state.to)}>
        <StarIcon aria-hidden="true" fill={pinned ? "currentColor" : "none"} />
      </Button>
    </div>
  );
}
