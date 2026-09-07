import { useState } from "react";
import { Link } from "react-router-dom";
import { Page } from "@/kit/primitives/Page";
import { Button } from "@/kit/ui/button";
import { Input } from "@/kit/ui/input";
import { getIcon } from "@/kit/icons";
import { APP_CATALOG, filterApps } from "@/shell/appCatalog";
import { usePinnedApps } from "@/shell/usePinnedApps";
import { cn, FOCUS_RING } from "@/kit/utils";
import type { Roster } from "@/lib/api";

const SearchIcon = getIcon("search");
const PinIcon = getIcon("pin");
const categories = ["All apps", "Favorites", ...new Set(APP_CATALOG.map((app) => app.category))];

export function AppsPage({ person }: { person: Roster }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All apps");
  const { pinned, togglePin, isLoading, isSaving, error } = usePinnedApps(person.id);
  const apps = filterApps(APP_CATALOG, query, category, pinned);
  return (
    <Page title="Apps" hideTitle>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
          <div className="mb-8">
            <p className="mb-2 text-xs font-medium tracking-widest text-primary uppercase">Your app library</p>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">A place for everything.</h2>
            <p className="mt-3 text-sm text-muted-foreground">Find an app, make it a favorite, and jump right in.</p>
          </div>
          <div className="relative mb-5">
            <SearchIcon aria-hidden className="absolute start-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search apps" placeholder="Search apps by name or what you want to do…" className="h-12 rounded-2xl bg-card ps-12" />
          </div>
          <div role="group" aria-label="Filter apps" className="mb-6 flex flex-wrap gap-2">
            {categories.map((name) => <Button key={name} variant={category === name ? "secondary" : "ghost"} size="sm" className="rounded-full" aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</Button>)}
          </div>
          {error ? <p role="alert" className="mb-4 text-sm text-destructive">{error}</p> : null}
          <p role="status" className="mb-4 text-xs text-muted-foreground">{isLoading && category === "Favorites" ? "Loading favorites…" : `${apps.length} ${apps.length === 1 ? "app" : "apps"}`}</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {apps.map((app) => {
              const Icon = getIcon(app.icon);
              const favorite = pinned.includes(app.to);
              return <div key={app.to} className="group relative rounded-2xl border border-border/60 bg-card transition-colors hover:border-primary/40 focus-within:border-primary/40">
                <Link to={app.to} className={cn("flex h-full flex-col rounded-2xl p-5", FOCUS_RING)}>
                  <span className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Icon aria-hidden className="size-6" strokeWidth={1.6} /></span>
                  <span className="font-semibold">{app.label}</span>
                  <span className="mt-1 text-sm leading-relaxed text-muted-foreground">{app.description}</span>
                  <span className="mt-5 text-xs text-muted-foreground">{app.category}<span className="float-end text-primary">Open ↗</span></span>
                </Link>
                <Button variant="ghost" size="icon" className={cn("absolute end-3 top-3 rounded-full", favorite && "bg-primary/10 text-primary")} aria-label={`${favorite ? "Unpin" : "Pin"} ${app.label}`} aria-pressed={favorite} disabled={isLoading || isSaving} onClick={() => togglePin(app.to)}><PinIcon aria-hidden className="size-4" /></Button>
              </div>;
            })}
          </div>
          {apps.length === 0 && !(isLoading && category === "Favorites") ? <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center">
            <p className="font-medium">{query ? "No matching apps" : "Keep your favorites close"}</p>
            <p className="mt-2 text-sm text-muted-foreground">{query ? "Try another name or a shorter search." : "Pin apps to find them here, on Home, and in your sidebar."}</p>
            <Button variant="outline" className="mt-5 rounded-full" onClick={() => { setQuery(""); setCategory("All apps"); }}>Browse all apps</Button>
          </div> : null}
        </div>
      </div>
    </Page>
  );
}
