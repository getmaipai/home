import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { i18n } from "@lingui/core";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { MediaShelf } from "@maipai/ui/src/primitives/MediaShelf";
import { getIcon } from "@maipai/ui/src/icons";
import type { Roster } from "@/lib/api";
import { useAppCatalog } from "@/shell/useAppCatalog";
import { isPinnableApp } from "@/shell/appCatalog";
import { usePinnedApps } from "@/shell/usePinnedApps";
import { useTabItem } from "@/shell/tabIdentity";

/** APPS-DIRECTORY-01 / PRO-LOOK-APPS-01: the launcher presents the same
 * ui.pinned_apps setting as the rail, with a favorites shelf and an A to Z grid. */
export function AllAppsPage({ person }: { person: Roster }) {
  useTabItem("All apps");
  const catalog = useAppCatalog();
  const { pinned, togglePin, movePin, isLoading, isSaving } = usePinnedApps(person.id);
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { searchRef.current?.focus(); }, []);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(i18n._({ id: "All", message: "All" }));
  const [editing, setEditing] = useState(false);
  const apps = useMemo(() => catalog.map((entry) => ({
    id: entry.to,
    name: entry.label,
    to: entry.to,
    icon: entry.icon,
    description: entry.description,
    category: entry.category,
    keywords: entry.keywords,
    favorite: isPinnableApp(entry.to) && pinned.includes(entry.to),
    builtIn: !isPinnableApp(entry.to),
  })), [catalog, pinned]);
  const categories = useMemo(() => [i18n._({ id: "All", message: "All" }), ...new Set(apps.map((app) => app.category).sort((a, b) => a.localeCompare(b)))], [apps]);
  const filtered = useMemo(() => apps.filter((app) =>
    (category === i18n._({ id: "All", message: "All" }) || app.category === category) &&
    `${app.name} ${app.description} ${app.category} ${app.keywords.join(" ")}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  ).sort((a, b) => a.name.localeCompare(b.name)), [apps, category, query]);
  const favorites = useMemo(() => {
    const byRoute = new Map(apps.map((app) => [app.to, app]));
    return [...new Set(pinned)].flatMap((to) => { const app = byRoute.get(to); return app?.favorite ? [app] : []; });
  }, [apps, pinned]);

  const starLabel = (app: (typeof apps)[number]) => app.favorite
    ? i18n._({ id: "Remove {name} from favorites", message: "Remove {name} from favorites", values: { name: app.name } })
    : i18n._({ id: "Add {name} to favorites", message: "Add {name} to favorites", values: { name: app.name } });
  const tile = (app: (typeof apps)[number]) => {
    const Icon = getIcon(app.icon);
    return <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/70 via-accent to-muted text-foreground"><Icon aria-hidden className="size-1/2" /></div>;
  };
  const actions = (app: (typeof apps)[number]) => app.builtIn ? null : <div className="flex items-center gap-1">
    <Button type="button" variant="ghost" size="icon-sm" aria-label={starLabel(app)} aria-pressed={app.favorite} disabled={isLoading || isSaving} onClick={() => togglePin(app.to)}>
      {(() => { const Star = getIcon("star"); return <Star aria-hidden fill={app.favorite ? "currentColor" : "none"} />; })()}
    </Button>
    {editing && app.favorite ? <>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={i18n._({ id: "Move {name} up", message: "Move {name} up", values: { name: app.name } })} disabled={isLoading || isSaving || pinned.indexOf(app.to) === 0} onClick={() => movePin(app.to, -1)}>{(() => { const Up = getIcon("arrow-up"); return <Up aria-hidden />; })()}</Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={i18n._({ id: "Move {name} down", message: "Move {name} down", values: { name: app.name } })} disabled={isLoading || isSaving || pinned.indexOf(app.to) === pinned.length - 1} onClick={() => movePin(app.to, 1)}>{(() => { const Down = getIcon("arrow-down"); return <Down aria-hidden />; })()}</Button>
    </> : null}
  </div>;
  function onGridKeyDown(event: KeyboardEvent<HTMLElement>) {
    const grid = event.currentTarget.querySelector('[data-layout="grid"]');
    const tiles = [...(grid?.querySelectorAll<HTMLButtonElement>("button[aria-label]") ?? [])].filter((button) => !button.hasAttribute("data-slot"));
    const current = event.target as HTMLElement;
    const index = tiles.indexOf(current.closest("button") as HTMLButtonElement);
    const focus = (next: number) => { if (tiles[next]) { event.preventDefault(); tiles[next]!.focus(); } };
    if (event.target === searchRef.current && event.key === "ArrowDown") focus(0);
    else if (event.target === searchRef.current && event.key === "Enter" && query.trim() && filtered.length === 1) { event.preventDefault(); navigate(filtered[0]!.to); }
    else if (index >= 0 && event.key === "ArrowRight") focus(index + 1);
    else if (index > 0 && event.key === "ArrowLeft") focus(index - 1);
    else if (index >= 0 && event.key === "Home") focus(0);
    else if (index >= 0 && event.key === "End") focus(tiles.length - 1);
    else if (index >= 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      const from = tiles[index]!.getBoundingClientRect();
      const candidates = tiles.map((tile, i) => ({ tile, i, rect: tile.getBoundingClientRect() })).filter(({ rect }) => event.key === "ArrowDown" ? rect.top > from.top + from.height / 2 : rect.bottom < from.bottom - from.height / 2);
      candidates.sort((a, b) => Math.abs(a.rect.top - from.top) - Math.abs(b.rect.top - from.top) || Math.abs(a.rect.left - from.left) - Math.abs(b.rect.left - from.left));
      if (candidates[0]) focus(candidates[0].i);
    } else if (index < 0 && (event.key === "ArrowUp" || event.key === "ArrowLeft") && event.target instanceof HTMLElement && event.target.closest('[data-layout="grid"]')) {
      event.preventDefault(); searchRef.current?.focus();
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="all-apps-launcher">
      <h1 className="sr-only">{i18n._({ id: "All apps", message: "All apps" })}</h1>
      <div className="max-w-2xl">
        <Input ref={searchRef} type="search" shape="pill" fill="surface" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); }
          if (event.key === "ArrowDown") { event.preventDefault(); searchRef.current?.closest('[data-testid="all-apps-launcher"]')?.querySelector<HTMLButtonElement>('[data-layout="grid"] button[aria-label]:not([data-slot])')?.focus(); }
          if (event.key === "Enter" && query.trim() && filtered.length === 1) { event.preventDefault(); navigate(filtered[0]!.to); }
        }} placeholder={i18n._({ id: "Search apps", message: "Search apps" })} aria-label={i18n._({ id: "Search apps", message: "Search apps" })} autoComplete="off" />
      </div>
      <nav aria-label={i18n._({ id: "App categories", message: "App categories" })} className="flex flex-nowrap gap-2 overflow-x-auto">
        {categories.map((item) => <Chip key={item} tone="surface" selectedTone="inverse" size="strip" selected={category === item} onClick={() => setCategory(item)}>{item}</Chip>)}
      </nav>
      <section aria-label={i18n._({ id: "Favorites", message: "Favorites" })} className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-section font-semibold">{i18n._({ id: "Favorites", message: "Favorites" })}</h2>
          <Button type="button" variant="quiet-link" size="sm" aria-pressed={editing} onClick={() => setEditing((value) => !value)}>{editing ? i18n._({ id: "Done", message: "Done" }) : i18n._({ id: "Edit", message: "Edit" })}</Button>
        </div>
        {favorites.length ? <MediaShelf
          items={favorites}
          getKey={(app) => app.id}
          getLabel={(app) => app.name}
          label={i18n._({ id: "Favorite apps", message: "Favorite apps" })}
          renderItem={tile}
          renderCaption={(app) => <span className="flex min-w-0 flex-col items-center gap-1"><span className="text-row font-semibold">{app.name}</span>{actions(app)}</span>}
          onSelect={(app) => navigate(app.to)}
          aspect="square"
          variant="plain"
          tileSize="pro"
          bleed
          hideWhenEmpty
        /> : <p className="text-supporting text-muted-foreground">{i18n._({ id: "Star an app to keep it here.", message: "Star an app to keep it here." })}</p>}
      </section>
      <div role="presentation" onKeyDown={onGridKeyDown}>
      <section aria-label={i18n._({ id: "All apps", message: "All apps" })} className="flex min-w-0 flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-section font-semibold">{i18n._({ id: "All apps", message: "All apps" })}</h2>
          <span className="text-supporting text-muted-foreground">{i18n._({ id: "A to Z", message: "A to Z" })}</span>
        </div>
        {filtered.length ? <MediaShelf
          items={filtered}
          getKey={(app) => app.id}
          getLabel={(app) => app.name}
          label={i18n._({ id: "All apps", message: "All apps" })}
          renderItem={tile}
          renderCaption={(app) => <span className="flex min-w-0 flex-col items-center gap-1"><span className="text-row font-semibold">{app.name}</span>{actions(app)}</span>}
          onSelect={(app) => navigate(app.to)}
          aspect="square"
          layout="grid"
          variant="plain"
        /> : <p className="text-supporting text-muted-foreground" role="status">{i18n._({ id: "No apps match your search.", message: "No apps match your search." })}</p>}
      </section>
      </div>
    </div>
  );
}
