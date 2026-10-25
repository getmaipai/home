import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@maipai/ui/src/dashboard/components/ui/tabs";
import { getIcon } from "@maipai/ui/src/icons";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { SchemaPage } from "@maipai/ui/src/schema/SchemaPage";
import { Player } from "@maipai/ui/src/primitives/Player";
import { PageNodeSchema } from "@maipai/ui/src/schema/types";
import { cn } from "@maipai/ui/src/utils";
import { ApiError, api, type Roster } from "@/lib/api";
import { NotFoundPage } from "@/shell/pages/NotFoundPage";
import { usePinnedApps } from "@/shell/usePinnedApps";
import { useAppRows } from "@/shell/useAppCatalog";
import { useTabItem } from "@/shell/tabIdentity";
import { appHomeLabel, isMediaApp, isMediaPlayPage, playPageOf, usesFamilyHeader } from "@/shell/mediaApps";
import { useMediaDock } from "@/shell/mediaHost";
import { SectionSidebar } from "@maipai/ui/src/primitives/SectionSidebar";
import { WeatherForecastPage, dedupeLocations, type WeatherLocation } from "@maipai/ui/src/elements/weather-forecast-page";
import { useAppSidebar } from "@/shell/useAppSidebar";
import { MediaHubFrame } from "@/shell/MediaHubFrame";
import { useMediaHubActive } from "@/shell/mediaHubSession";
import { FocalImageProvider } from "@maipai/ui/src/primitives/FocalImage";
import { analyzeFocalImage, warmFocalModel } from "@/lib/focalImageAnalyzer";
import "./packageAppNews.css";


function VideoDetails({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ["video-details", id],
    queryFn: () => api.appData<{ rows?: { title?: string; channel?: string; date?: string; published_at?: string; description?: string }[] }>("videos", "item", { id }),
    enabled: Boolean(id),
  });
  const item = query.data?.rows?.[0];
  if (!item) return null;
  const date = item.date ?? item.published_at;
  return <section className="flex flex-col gap-3" data-slot="video-details">
    <h2 className="text-xl font-bold tracking-tight text-foreground">{item.title}</h2>
    <p className="text-sm text-muted-foreground">{[item.channel, date].filter(Boolean).join(" · ")}</p>
    {item.description ? <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">{item.description}</div> : null}
  </section>;
}

const PAGE_FRESH_MS = 5 * 60_000;

function weatherLocation(place: { id: string; label: string; geo?: { lat?: number; lon?: number; area?: string | null } | null }, props: Record<string, unknown>): WeatherLocation {
  const current = (props.current && typeof props.current === "object" ? props.current : {}) as Record<string, unknown>;
  const daily = Array.isArray(props.daily) ? props.daily as Array<Record<string, unknown>> : [];
  const hourly = Array.isArray(props.hourly) ? props.hourly as Array<Record<string, unknown>> : [];
  const details = (props.details && typeof props.details === "object" ? props.details : {}) as Record<string, unknown>;
  const number = (source: Record<string, unknown>, key: string) => typeof source[key] === "number" ? source[key] as number : undefined;
  const numeric = (source: Record<string, unknown>, key: string) => {
    const value = source[key];
    return typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : undefined;
  };
  const string = (source: Record<string, unknown>, key: string) => typeof source[key] === "string" ? source[key] as string : undefined;
  const clock = (value: string) => {
    const match = /T(\d{2}):(\d{2})/.exec(value);
    if (!match) return value;
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(2020, 0, 1, Number(match[1]), Number(match[2]))));
  };
  const hasWeather = number(current, "temp") !== undefined && string(current, "condition") !== undefined;
  return { id: place.id, city: place.label.replace(/ \(home\)$/, ""), state: place.geo?.area ?? undefined, latitude: place.geo?.lat, longitude: place.geo?.lon, timezone: string(details, "timezone"), isMyLocation: place.label.endsWith(" (home)"), detail: hasWeather ? {
    temp: number(current, "temp")!, condition: string(current, "condition")!, code: numeric(current, "code") ?? 3, isDay: current.is_day !== false && current.is_day !== 0 && current.is_day !== "0",
    high: number(daily[0] ?? {}, "high"), low: number(daily[0] ?? {}, "low"),
    hourly: hourly.map((hour) => ({ time: clock(String(hour.time ?? "")), temp: Number(hour.temp ?? 0), pop: number(hour, "pop") })),
    daily: daily.map((day) => ({ date: String(day.date ?? ""), high: Number(day.high ?? 0), low: Number(day.low ?? 0), code: Number(day.code ?? 3), pop: number(day, "pop") })),
    feelsLike: number(details, "feels_like"), humidity: number(details, "humidity"), precipitation: number(details, "precipitation"),
    wind: number(details, "wind_speed") !== undefined ? { speed: number(details, "wind_speed")!, direction: number(details, "wind_direction") ?? 0 } : undefined,
    pressure: number(details, "pressure"), visibility: number(details, "visibility") === undefined ? undefined : number(details, "visibility")! / 1000,
    sunrise: string(details, "sunrise") ? clock(string(details, "sunrise")!) : undefined, sunset: string(details, "sunset") ? clock(string(details, "sunset")!) : undefined, uvIndex: number(details, "uv_index"),
  } : undefined, localTime: string(details, "timezone") ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: string(details, "timezone") }).format(new Date()) : undefined };
}

/** One page document of a package app. A document the interpreter cannot parse is an error state with a retry, never a crashed page. */
/** Page titles that name a kind of page, not a place: never drawn as the app's title. */
const GENERIC_PAGE_TITLES: ReadonlySet<string> = new Set(["Channel", "Story"]);

/** The title that says where the person is inside an app with a sidebar column: the chosen row's label, else the page's own title
 * unless that only names a kind of page. Undefined when neither says anything, so the app keeps its name for assistive technology. */
export function contextTitleFor(activeLabel: string | undefined, pageTitle: string | undefined): string | undefined {
  if (activeLabel) return activeLabel;
  return pageTitle && !GENERIC_PAGE_TITLES.has(pageTitle) ? pageTitle : undefined;
}

function appPageQuery(packageId: string, pageId: string) {
  return {
    queryKey: ["app-page", packageId, pageId],
    queryFn: async () => {
      const doc = await api.appPage(packageId, pageId);
      if (!PageNodeSchema.safeParse(doc).success) throw new Error("This app's page is not valid.");
      return doc;
    },
    staleTime: PAGE_FRESH_MS,
  };
}

/** Every page of this app the person can reach from its tabs or its sidebar: the index, the sections, the sidebar's page entries, and the
 * pages its entries and search open. */
function pagesOf(app: NonNullable<ReturnType<typeof useAppRows>>[number]): string[] {
  const ids = new Set<string>(["index", ...app.sections.map((section) => section.page)]);
  const base = `/apps/${app.package}`;
  const fromAction = (action: unknown): void => {
    const to = typeof action === "object" && action !== null ? (action as { navigate?: { to?: unknown } }).navigate?.to : undefined;
    if (typeof to !== "string") return;
    if (to === base) ids.add("index");
    else if (to.startsWith(`${base}/`)) ids.add(to.slice(base.length + 1).split("/")[0] ?? "");
  };
  for (const group of app.sidebar?.groups ?? []) {
    for (const entry of group.pages ?? []) ids.add(entry.page);
    const rows = group.rows as { open?: unknown; manage?: { open?: unknown } } | undefined;
    fromAction(rows?.open);
    fromAction(rows?.manage?.open);
  }
  fromAction((app.sidebar?.search as { submit?: unknown } | undefined)?.submit);
  ids.delete("");
  return [...ids].sort();
}

/** APP-KIND-04: one route, `apps/*`, for every installed package app. `/apps/<package>` opens its `index` page and
 * `/apps/<package>/<page>` another of its pages. The page is a spec `page` document the hub serves
 * (`GET /api/plugins/:id/pages/:pageId`), drawn by the kit's SchemaPage inside the package scope: it can read only
 * its own package and navigate only inside its own app. Home holds no per-package code. An unknown, hidden,
 * disabled or uninstalled app or page is the same "not found" page. */
export function PackageAppPage({ person }: { person: Roster }) {
  const splat = useParams()["*"] ?? "";
  const [packageId = "", pageSegment = ""] = splat.split("/").filter(Boolean);
  const pageId = pageSegment || "index";
  const [weatherSelectedId, setWeatherSelectedId] = useState("");
  const [weatherSearch, setWeatherSearch] = useState("");
  const [weatherMessage, setWeatherMessage] = useState("");
  const [weatherResults, setWeatherResults] = useState<Array<{ name: string; area: string | null; lat: number; lon: number }>>([]);
  const weatherPlaces = useQuery({ queryKey: ["weather-places", person.id], queryFn: () => api.appData<{ rows: Array<{ id: string; label: string }> }>("weather", "places"), staleTime: PAGE_FRESH_MS, enabled: packageId === "weather" && pageId === "index" });
  const weatherEntities = useQuery({ queryKey: ["weather-place-entities", person.id], queryFn: () => api.entities("place"), enabled: packageId === "weather" && pageId === "index" });
  const weatherSettings = useQuery({ queryKey: ["settings-values", `person:${person.id}`], queryFn: () => api.settingsValues(`person:${person.id}`), enabled: packageId === "weather" && pageId === "index" });
  const weatherHomeId = weatherSettings.data?.find((row) => row.key === "household.home")?.value;
  const weatherUnit = weatherSettings.data?.find((row) => row.key === "weather.unit")?.value === "celsius" ? "celsius" : "fahrenheit";
  const weatherVisiblePlaces = (weatherPlaces.data?.rows ?? []).map((place) => {
    const entity = weatherEntities.data?.find((row) => row.id === place.id);
    return { ...place, geo: entity?.geo ? { lat: Number(entity.geo.lat), lon: Number(entity.geo.lon), area: entity.geo.area } : null };
  });
  const weatherForecasts = useQueries({ queries: weatherVisiblePlaces.map((place) => ({
    queryKey: ["weather-details", person.id, place.id, weatherUnit],
    enabled: packageId === "weather" && pageId === "index",
    queryFn: async () => {
      const data = await api.appData<{ blocks?: Array<{ props?: Record<string, unknown> }>; details?: Record<string, unknown> }>("weather", "forecast", { place: place.id });
      return weatherLocation(place, { ...(data.blocks?.[0]?.props ?? {}), details: data.details });
    },
  })) });
  const weatherSearchQuery = useQuery({ queryKey: ["weather-search", weatherSearch], queryFn: () => api.searchPlaces(weatherSearch), enabled: packageId === "weather" && pageId === "index" && weatherSearch.trim().length > 1 });
  const weatherLocations = dedupeLocations(weatherVisiblePlaces.map((place, index) => weatherForecasts[index]?.data ?? weatherLocation(place, {})).filter((place) => place.detail));
  const weatherSelectedPlace = weatherLocations.find((place) => place.id === weatherSelectedId) ?? weatherLocations[0];
  const rows = useAppRows();
  const app = rows?.find((row) => row.package === packageId);
  useTabItem(app?.label ?? "Apps");

  const page = useQuery({ ...appPageQuery(packageId, pageId), enabled: packageId !== "", retry: false });

  // A page document is static until the package changes, so every page this app can open is fetched once, up front: moving between its
  // pages then shows the next page at once instead of replacing the whole panel with a loading skeleton while its document loads.
  const queryClient = useQueryClient();
  useEffect(() => { if (packageId === "news") warmFocalModel(); }, [packageId]);
  const preload = app ? pagesOf(app).join(",") : "";
  useEffect(() => {
    if (packageId === "" || preload === "") return;
    for (const id of preload.split(",")) void queryClient.prefetchQuery(appPageQuery(packageId, id));
  }, [queryClient, packageId, preload]);

  // MEDIA-VIDEOS-01: a page opened by link (`/apps/videos/watch?id=...`, a reload, a shared address) starts with its query as the page
  // state, which is where the kit's SchemaPage reads a `navigate` action's state. The page waits one render for it, so a data call
  // never goes out without its `$state.id`.
  const location = useLocation();
  const navigate = useNavigate();
  const media = isMediaApp(packageId);
  const hubActive = useMediaHubActive();
  const familyHeader = usesFamilyHeader(packageId);
  // Every package app reads its query as page state, so a reload or a shared link opens the same item.
  const urlState = packageId !== "";
  const queryState = useMemo<Record<string, string>>(() => (urlState ? Object.fromEntries(new URLSearchParams(location.search)) : {}), [urlState, location.search]);
  const hasQuery = Object.keys(queryState).length > 0;
  const arrived = (location.state as { pageState?: Record<string, unknown> } | null)?.pageState;
  const sameQuery = hasQuery && arrived !== undefined && Object.entries(queryState).every(([name, value]) => String(arrived[name]) === value);
  useEffect(() => {
    if (hasQuery && !sameQuery) navigate(`${location.pathname}${location.search}`, { replace: true, state: { pageState: { ...arrived, ...queryState } } });
  }, [hasQuery, sameQuery, location.pathname, location.search, arrived, queryState, navigate]);
  // APP-URL-01: a page a `navigate` action opened with state (a story's id, a channel's kind and key, a search's text) writes that state
  // into its own address, replacing the entry in place, so the address bar always names the item: it reloads, shares and goes back to it.
  useEffect(() => {
    if (packageId === "" || location.search !== "" || arrived === undefined) return;
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(arrived)) if (typeof value === "string" && value !== "") params.set(name, value);
    const search = params.toString();
    if (search) navigate(`${location.pathname}?${search}`, { replace: true, state: location.state });
  }, [packageId, location.pathname, location.search, location.state, arrived, navigate]);
  // MEDIA-POLISH-01: the docked mini bar. What the media host holds, drawn in a media app's area once the person started it, except
  // on the page that is playing it right now.
  const dock = useMediaDock();
  const held = dock.current;
  const onItsPlayPage = held !== null && held.appId === packageId && isMediaPlayPage(packageId, pageId) && (queryState.id === held.id || (packageId === "books" && pageId === "listen"));
  const docked = media && held !== null && held.started && !onItsPlayPage ? held : null;
  const CloseIcon = getIcon("x");

  const sidebar = app?.sidebar;
  const arrivedState = (location.state as { pageState?: Record<string, unknown> } | null)?.pageState ?? {};
  const sidebarProps = useAppSidebar(app, sidebar, pageId, arrivedState);

  if (packageId === "" || (page.error instanceof ApiError && page.error.status === 404)) return <NotFoundPage />;

  // NEWS-ARTICLE-PANE-01: with a sidebar column the app's title names where the person is (the chosen row: Today, My Mix, Saved, a
  // topic, a source), never the app's own name, which the column already carries. A page whose body draws its own header (a story
  // feed or an article) keeps its title for assistive technology only, so the same words are not drawn twice.
  const pageDoc = page.data as { title?: string; body?: Array<{ type?: string }> } | undefined;
  const activeLabel = sidebarProps?.groups?.flatMap((group) => group.items).find((item) => item.active)?.label;
  const ownHeader = pageDoc?.body?.some((node) => node.type === "answer_blocks") === true;
  const contextTitle = sidebarProps ? contextTitleFor(activeLabel, pageDoc?.title) : undefined;

  const content = (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col gap-2", (sidebarProps || media) && "p-4 lg:ps-6")} data-testid="package-app" data-package={packageId}>
      {familyHeader ? null : <h1 className="sr-only">{app?.label ?? "App"}</h1>}
      {app ? <AppToolbar hideSectionsOnWide={sidebar !== undefined} person={person} to={app.to} label={app.label} homeLabel={appHomeLabel(packageId, media)} settingsArea={app.settings_area?.id} sections={app.sections} current={pageId} familyHeader={familyHeader} title={contextTitle} titleSrOnly={sidebarProps ? ownHeader || contextTitle === undefined : false} /> : null}
      <AsyncState
        data={page.isError ? null : page.data}
        error={page.isError}
        isFetching={page.isFetching}
        onRetry={() => page.refetch()}
        errorMessage="Could not open this app. Check your connection and try again."
        loadingLabel="Opening the app"
      >
        {(doc) => (hasQuery && !sameQuery ? null : <>
          {packageId === "weather" && pageId === "index" ? null : packageId === "news" ? <FocalImageProvider analyze={analyzeFocalImage}><SchemaPage key={`${packageId}/${pageId}`} page={doc} packageId={packageId} hideTitle sidebar={sidebarProps !== null} /></FocalImageProvider> : <SchemaPage key={`${packageId}/${pageId}`} page={doc} packageId={packageId} hideTitle sidebar={sidebarProps !== null} />}
          {packageId === "videos" && pageId === "watch" ? <VideoDetails id={new URLSearchParams(location.search).get("id") ?? String((location.state as { pageState?: { id?: string } } | null)?.pageState?.id ?? "")} /> : null}
          {packageId === "weather" && pageId === "index" ? <>
            {weatherMessage ? <p role="status" className="text-sm text-muted-foreground">{weatherMessage}</p> : null}
            <WeatherForecastPage locations={weatherLocations} selectedId={weatherSelectedPlace?.id} onSelect={(id: string) => { if (id) setWeatherSelectedId(id); }} onSearch={(value: string) => { setWeatherSearch(value); setWeatherResults([]); setWeatherMessage(""); }} searchResults={(weatherSearchQuery.data ?? weatherResults).map((r) => ({ id: `${r.lat.toFixed(2)},${r.lon.toFixed(2)}`, city: r.name, state: r.area ?? undefined, latitude: r.lat, longitude: r.lon }))} onSelectResult={async (result) => {
              setWeatherMessage("");
              const latitude = Number(result.latitude!.toFixed(2)); const longitude = Number(result.longitude!.toFixed(2));
              const sameSpot = (geo: { lat?: number; lon?: number } | null | undefined) => geo?.lat !== undefined && geo.lon !== undefined && geo.lat.toFixed(2) === latitude.toFixed(2) && geo.lon.toFixed(2) === longitude.toFixed(2);
              const duplicate = weatherVisiblePlaces.find((place) => place.id === result.id || sameSpot(place.geo)) ?? (weatherHomeId ? weatherEntities.data?.find((place) => place.id === weatherHomeId && sameSpot(place.geo)) : undefined);
              if (duplicate || result.id === weatherHomeId) {
                const duplicateName = duplicate && "label" in duplicate ? duplicate.label.replace(/ \(home\)$/, "") : duplicate?.name;
                setWeatherMessage(`${duplicateName ?? result.city} is already in your list.`);
              } else {
                const entity = await api.createEntity({ kind: "place", name: result.city, place_kind: "map", scope: "person", geo: { lat: latitude, lon: longitude, precision: "exact", area: result.state ?? null, from: "search" } });
                const ids = (weatherPlaces.data?.rows ?? []).map((row) => row.id);
                if (!ids.includes(entity.id)) await api.setSetting(`person:${person.id}`, "weather.places", [...ids, entity.id]);
                await queryClient.invalidateQueries({ queryKey: ["weather-places", person.id] });
              }
              setWeatherSearch(""); setWeatherResults([]);
            }} onAddLocation={() => { if (weatherSearch.trim()) void weatherSearchQuery.refetch().then(({ data }) => setWeatherResults(data ?? [])); }} onRemoveLocation={(id) => {
              const location = weatherLocations.find((place) => place.id === id);
              if (id === weatherHomeId || (weatherPlaces.data?.rows ?? []).find((place) => place.id === id)?.label.endsWith(" (home)")) {
                setWeatherMessage(`${location?.city ?? "This place"} is your home place. Change it in Settings, Weather.`); return;
              }
              setWeatherMessage("");
              void api.deleteEntity(id).then(async () => {
                await queryClient.invalidateQueries({ queryKey: ["weather-places", person.id] });
                await queryClient.invalidateQueries({ queryKey: ["weather-place-entities", person.id] });
                setWeatherMessage(`${location?.city ?? "Place"} removed from your list.`);
              }).catch((error: unknown) => setWeatherMessage(error instanceof Error ? error.message : "Could not remove this place."));
            }} locale={navigator.language} unit={weatherUnit === "celsius" ? "C" : "F"} />
          </> : null}
        </>)}
      </AsyncState>
      {docked ? (
        <Player
          key={docked.id}
          media={docked.el}
          src={docked.src}
          kind={docked.kind}
          layout="mini"
          placement="dock"
          title={docked.title}
          subtitle={docked.subtitle}
          poster={docked.poster}
          mediaSession={false}
          onExpand={() => navigate(`/apps/${docked.appId}/${playPageOf(docked.appId)}?id=${encodeURIComponent(docked.id)}`, { state: { pageState: { id: docked.id } } })}
          onProgress={(p) => {
            api.mediaProgress(docked.appId, { media_id: docked.id, position_s: p.position_s, duration_s: p.duration_s, reason: p.reason }, p.reason === "unload").catch(() => {});
          }}
          actionsSlot={
            <Button variant="ghost" size="icon" aria-label={`Close the player: ${docked.title}`} onClick={dock.clear}>
              <CloseIcon aria-hidden="true" />
            </Button>
          }
        />
      ) : null}
    </div>
  );
  // NEWS-SIDEBAR-01: an app that declares a sidebar gets its own column beside the content from wide screens up (the kit's one
  // section sidebar); its section tabs give way to it there, and a phone keeps them.
  const framed = sidebarProps ? (
    <div className="flex min-h-0 flex-1" data-workspace-fill="" data-slot="package-app-frame" data-testid="package-app-frame">
      <SectionSidebar standalone density="compact" title={app?.label} headerActions={app ? <AppColumnActions person={person} to={app.to} label={app.label} settingsArea={app.settings_area?.id} /> : undefined} {...sidebarProps} />
      {content}
    </div>
  ) : content;
  return media && hubActive ? <MediaHubFrame packageId={packageId}>{framed}</MediaHubFrame> : framed;
}

/** COLUMN-UNIFY-01 (owner, 2026-10-19): the app's settings and favorite controls sit in the column's header, after its title, the way
 * Chat's column carries Chat settings, so the page keeps one row of its own. Below the `lg` breakpoint the column is not drawn and
 * the toolbar keeps them. */
function AppColumnActions({ person, to, label, settingsArea }: { person: Roster; to: string; label: string; settingsArea?: string }) {
  const { isPinned, togglePin, isLoading, isSaving } = usePinnedApps(person.id);
  const pinned = isPinned(to);
  const StarIcon = getIcon("star");
  const GearIcon = getIcon("settings");
  return (
    <>
      {settingsArea ? (
        <Button variant="ghost" size="icon" title={`${label} settings`} render={<Link to={`/settings/${settingsArea}`} aria-label={`${label} settings`} />}>
          <GearIcon aria-hidden="true" />
        </Button>
      ) : null}
      <Button variant="ghost" size="icon" disabled={isLoading || isSaving} aria-pressed={pinned} aria-label={pinned ? "Remove from favorites" : "Add to favorites"} title={pinned ? "Remove from favorites" : "Add to favorites"} onClick={() => togglePin(to)}>
        <StarIcon aria-hidden="true" fill={pinned ? "currentColor" : "none"} />
      </Button>
    </>
  );
}

/** The app's own sections as tabs (when it has any) and the pin control. Pins are per person and private. */
function AppToolbar({ hideSectionsOnWide = false, person, to, label, title, titleSrOnly = false, homeLabel, settingsArea, sections, current, familyHeader }: { title?: string; titleSrOnly?: boolean; hideSectionsOnWide?: boolean; person: Roster; to: string; label: string; homeLabel: string; settingsArea?: string; sections: Array<{ page: string; label: string }>; current: string; familyHeader: boolean }) {
  const navigate = useNavigate();
  const { isPinned, togglePin, isLoading, isSaving } = usePinnedApps(person.id);
  const pinned = isPinned(to);
  const StarIcon = getIcon("star");
  const GearIcon = getIcon("settings");
  // MEDIA-POLISH-01: a media app's own header, as the native app has it (YouTube's): its name large with its icon controls on the
  // end side, then its sections as chip tabs. The play page has no header: the picture starts the page.
  if (familyHeader) {
    if (isMediaPlayPage(to.split("/")[2] ?? "", current)) return null;
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1">
          <h1 className={cn("min-w-0 flex-1 truncate text-2xl font-bold tracking-tight sm:text-3xl", titleSrOnly && "sr-only")}>{title ?? label}</h1>
          {settingsArea ? (
            <Button variant="ghost" size="icon-lg" className={hideSectionsOnWide ? "lg:hidden" : undefined} render={<Link to={`/settings/${settingsArea}`} aria-label={`${label} settings`} />}>
              <GearIcon aria-hidden="true" />
            </Button>
          ) : null}
          <Button variant="ghost" size="icon-lg" className={hideSectionsOnWide ? "lg:hidden" : undefined} disabled={isLoading || isSaving} aria-pressed={pinned} aria-label={pinned ? "Remove from favorites" : "Add to favorites"} onClick={() => togglePin(to)}>
            <StarIcon aria-hidden="true" fill={pinned ? "currentColor" : "none"} />
          </Button>
        </div>
        {sections.length > 0 ? (
          <div className={hideSectionsOnWide ? "lg:hidden" : undefined} data-slot="app-section-tabs">
            <Tabs value={current} onValueChange={(value) => navigate(value === "index" ? to : `${to}/${String(value)}`)}>
              <TabsList variant="pill" aria-label="Sections">
                <TabsTrigger value="index">{homeLabel}</TabsTrigger>
                {sections.map((section) => (
                  <TabsTrigger key={section.page} value={section.page}>{section.label}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {sections.length > 0 ? (
        <div className={hideSectionsOnWide ? "lg:hidden" : undefined} data-slot="app-section-tabs">
          <Tabs value={current} onValueChange={(value) => navigate(value === "index" ? to : `${to}/${String(value)}`)}>
            <TabsList variant="line" aria-label="Sections">
              <TabsTrigger value="index">{homeLabel}</TabsTrigger>
              {sections.map((section) => (
                <TabsTrigger key={section.page} value={section.page}>{section.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      ) : <span />}
      <div className={cn("flex items-center gap-1", hideSectionsOnWide && "lg:hidden")}>
      {settingsArea ? (
        <Button variant="ghost" size="sm" render={<Link to={`/settings/${settingsArea}`} aria-label={`${label} settings`} />}>
          <GearIcon aria-hidden="true" />
          Settings
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        disabled={isLoading || isSaving}
        aria-pressed={pinned}
        onClick={() => togglePin(to)}
      >
        <StarIcon aria-hidden="true" fill={pinned ? "currentColor" : "none"} />
        {pinned ? "Remove from favorites" : "Add to favorites"}
      </Button>
      </div>
    </div>
  );
}
