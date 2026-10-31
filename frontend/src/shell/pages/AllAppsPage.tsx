import { useMemo } from "react";
import { AppDirectory, type DirectoryApp } from "@maipai/ui/src/primitives/AppDirectory";
import type { Roster } from "@/lib/api";
import { useAppCatalog } from "@/shell/useAppCatalog";
import { isPinnableApp } from "@/shell/appCatalog";
import { usePinnedApps } from "@/shell/usePinnedApps";
import { useTabItem } from "@/shell/tabIdentity";

/** APPS-DIRECTORY-01: every installed app, with search, Favorites first and a star on each. Favorites are the person's
 * pins (`ui.pinned_apps`): the same list the rail draws and the app page's own star edits, so there is one list and
 * one place that saves it. The built-in apps that are always in the rail (Home, Chat, Library, Family) open from here too; Wikipedia, Reminders and Clock can be starred like the rest. */
export function AllAppsPage({ person }: { person: Roster }) {
  useTabItem("All apps");
  const catalog = useAppCatalog();
  const { pinned, togglePin, isLoading, isSaving } = usePinnedApps(person.id);

  const apps = useMemo<DirectoryApp[]>(() => {
    const toApp = (entry: (typeof catalog)[number], favorite: boolean, builtIn: boolean): DirectoryApp => ({
      id: entry.to, name: entry.label, to: entry.to, icon: entry.icon, description: entry.description, category: entry.category, keywords: entry.keywords, favorite, builtIn,
    });
    const packageApps = catalog.filter((entry) => isPinnableApp(entry.to));
    const order = [...new Set(pinned)];
    const favorites = order.flatMap((to) => packageApps.filter((entry) => entry.to === to)).map((entry) => toApp(entry, true, false));
    const rest = packageApps.filter((entry) => !order.includes(entry.to)).map((entry) => toApp(entry, false, false));
    const builtIn = catalog.filter((entry) => !isPinnableApp(entry.to)).map((entry) => toApp(entry, false, true));
    return [...favorites, ...rest, ...builtIn];
  }, [catalog, pinned]);

  return (
    <AppDirectory
      apps={apps}
      hideTitle
      busy={isLoading || isSaving}
      onToggleFavorite={(app) => togglePin(app.to)}
    />
  );
}
