import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeaderTitle } from "@/shell/pageHeaderTitle";
import { useContext, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@maipai/ui/src/dashboard/components/ui/tabs";
import { useHeaderExtra } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/HeaderExtraContext";
import { useIsPhoneLayout } from "@maipai/ui/src/dashboard/layouts/full/FullLayout";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { SchemaPage } from "@maipai/ui/src/schema/SchemaPage";
import { ArticleSpeechContext } from "@maipai/ui/src/primitives/ArticleView";
import { ListenStatusContext } from "@/shell/mediaHost";
import { PageNodeSchema } from "@maipai/ui/src/schema/types";
import { cn } from "@maipai/ui/src/utils";
import { ApiError, api, type Roster } from "@/lib/api";
import { NotFoundPage } from "@/shell/pages/NotFoundPage";
import { useAppRows } from "@/shell/useAppCatalog";
import { useTabItem } from "@/shell/tabIdentity";
import { MinimizeButton } from "@/shell/media/MinimizeButton";
import { MusicVisualizerSection } from "@/shell/media/MusicVisualizerSection";
import { appHomeLabel, isMediaApp, isMediaPlayPage, usesFamilyHeader } from "@/shell/mediaApps";
import { SectionSidebar } from "@maipai/ui/src/primitives/SectionSidebar";
import { WeatherForecastPage, dedupeLocations, type WeatherLocation } from "@maipai/ui/src/elements/weather-forecast-page";
import { useAppSidebar } from "@/shell/useAppSidebar";
import { MediaHubFrame } from "@/shell/MediaHubFrame";
import { useMediaHubActive } from "@/shell/mediaHubSession";
import { PackageAppHeaderActions, publishPackageAppHeader, sectionsBarEntries } from "@/shell/pages/packageAppHeaderBar";
import { PhoneNav } from "@maipai/ui/src/PhoneNav";
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

/** The advice chips the Weather app's details carry (the host builds them as short labels); anything else draws nothing. */
function weatherChips(value: unknown): Array<{ id: string; label: string; icon?: string }> {
  return Array.isArray(value) ? value.filter((item): item is { id: string; label: string; icon?: string } => !!item && typeof item.id === "string" && typeof item.label === "string") : [];
}

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
    moon: moonDetail(details.moon),
  } : undefined, localTime: string(details, "timezone") ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: string(details, "timezone") }).format(new Date()) : undefined };
}

/** The Weather moon tile's data from a page document's `moon` object; the next full and new moon dates ride along only when they are strings. */
function moonDetail(value: unknown): { phase: string; illumination: number; nextFull?: string; nextNew?: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const moon = value as Record<string, unknown>;
  if (typeof moon.phase !== "string" || typeof moon.illumination !== "number") return undefined;
  return { phase: moon.phase, illumination: moon.illumination, ...(typeof moon.nextFull === "string" ? { nextFull: moon.nextFull } : {}), ...(typeof moon.nextNew === "string" ? { nextNew: moon.nextNew } : {}) };
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
/** The reader keeps its own speech context (the dev server loads the package-path copy and the kit's own copy as two objects), so the
 * shell's Listen status is handed over here, beside the page that holds the reader. */
function ArticleSpeechBridge({ children }: { children: React.ReactNode }) {
  const speech = useContext(ListenStatusContext);
  return <ArticleSpeechContext.Provider value={speech}>{children}</ArticleSpeechContext.Provider>;
}

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
      return { location: weatherLocation(place, { ...(data.blocks?.[0]?.props ?? {}), details: data.details }), advice: weatherChips(data.details?.advice), summary: typeof data.details?.summary === "string" ? data.details.summary : undefined };
    },
  })) });
  const weatherSearchQuery = useQuery({ queryKey: ["weather-search", weatherSearch], queryFn: () => api.searchPlaces(weatherSearch), enabled: packageId === "weather" && pageId === "index" && weatherSearch.trim().length > 1 });
  const weatherLocations = dedupeLocations(weatherVisiblePlaces.map((place, index) => weatherForecasts[index]?.data?.location ?? weatherLocation(place, {})).filter((place) => place.detail));
  const weatherSelectedPlace = weatherLocations.find((place) => place.id === weatherSelectedId) ?? weatherLocations[0];
  const weatherSelectedForecast = weatherForecasts.find((query) => query.data?.location.id === weatherSelectedPlace?.id)?.data;
  const weatherSelectedAdvice = weatherSelectedForecast?.advice;
  const rows = useAppRows();
  const app = rows?.find((row) => row.package === packageId);
  useTabItem(app?.label ?? "Apps");

  const page = useQuery({ ...appPageQuery(packageId, pageId), enabled: packageId !== "", retry: false });

  // A page document is static until the package changes, so every page this app can open is fetched once, up front: moving between its
  // pages then shows the next page at once instead of replacing the whole panel with a loading skeleton while its document loads.
  const queryClient = useQueryClient();
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
  // On a phone the app's name and its two icon buttons live in the shell's top bar, not in a row of the page.
  const phone = useIsPhoneLayout();
  const inShellBar = phone && app !== undefined;
  useHeaderExtra(PageHeaderTitle, PackageAppHeaderActions);
  // An app with sections shows them in the kit's floating bottom bar on a phone (not as a row of pills), with Search last when the
  // app has a search page; a page that plays something (a video, a book) draws no bar.
  const sectionsBar = inShellBar && app && app.sections.length > 0 && !isMediaPlayPage(packageId, pageId) ? sectionsBarEntries(app, appHomeLabel(packageId, media), pagesOf(app).includes("search")) : null;
  // The reader draws its own Back and action pill, so on a phone the shell bar shrinks to the menu button and the pill sits beside it
  // (packageAppNews.css) instead of under an empty bar.
  const readingStory = packageId === "news" && pageId === "story";
  const reading = inShellBar && readingStory;
  useEffect(() => {
    if (!reading) return;
    document.documentElement.setAttribute("data-app-reading", "");
    return () => document.documentElement.removeAttribute("data-app-reading");
  }, [reading]);
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

  const sidebar = app?.sidebar;
  const arrivedState = (location.state as { pageState?: Record<string, unknown> } | null)?.pageState ?? {};
  const sidebarProps = useAppSidebar(app, sidebar, pageId, arrivedState, person.id);
  const pageDoc = page.data as { title?: string; body?: Array<{ type?: string }> } | undefined;
  const activeLabel = sidebarProps?.groups?.flatMap((group) => group.items).find((item) => item.active)?.label;
  const contextTitle = sidebarProps ? contextTitleFor(activeLabel, pageDoc?.title) : undefined;
  useEffect(() => {
    publishPackageAppHeader(app ? { to: app.to, label: app.label, ...(contextTitle ? { title: contextTitle } : {}), ...(app.settings_area?.id ? { settingsArea: app.settings_area.id } : {}) } : null);
    return () => publishPackageAppHeader(null);
  }, [app?.to, app?.label, app?.settings_area?.id, contextTitle]); // eslint-disable-line react-hooks/exhaustive-deps -- app is read through its own fields

  if (packageId === "" || (page.error instanceof ApiError && page.error.status === 404)) return <NotFoundPage />;

  // NEWS-ARTICLE-PANE-01: with a sidebar column the app's title names where the person is (the chosen row: Today, My Mix, Saved, a
  // topic, a source), never the app's own name, which the column already carries. A page whose body draws its own header (a story
  // feed or an article) keeps its title for assistive technology only, so the same words are not drawn twice.
  const content = (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", packageId === "music" && pageId === "play" && "relative z-10", !readingStory && "gap-2", (sidebarProps || media) && !readingStory && "lg:p-4 lg:ps-6", (sidebarProps || media) && !sectionsBar && !readingStory && "py-4")} data-testid="package-app" data-package={packageId}>
      {sectionsBar ? <PhoneNav variant="floating" label={`${app?.label ?? "App"} sections`} entries={sectionsBar.entries} more={sectionsBar.more} {...(sectionsBar.trailing ? { trailing: sectionsBar.trailing } : {})} /> : null}
      {app ? <AppToolbar inShellBar={inShellBar} sectionsInBar={sectionsBar !== null} hideSectionsOnWide={sidebar !== undefined} to={app.to} homeLabel={appHomeLabel(packageId, media)} sections={app.sections} current={pageId} familyHeader={familyHeader} /> : null}
      <AsyncState
        data={page.isError ? null : page.data}
        error={page.isError}
        isFetching={page.isFetching}
        onRetry={() => page.refetch()}
        errorMessage="Could not open this app. Check your connection and try again."
        loadingLabel="Opening the app"
      >
        {(shown) => { const doc = sectionsBar?.trailing && pageId !== "search" ? withoutSearchBox(shown) : shown; return (hasQuery && !sameQuery ? null : <>
          {packageId === "weather" && pageId === "index" ? null : <ArticleSpeechBridge><SchemaPage key={`${packageId}/${pageId}`} page={doc} packageId={packageId} hideTitle sidebar={sidebarProps !== null} floatingBar={sectionsBar !== null} /></ArticleSpeechBridge>}
          {media && packageId !== "music" && isMediaPlayPage(packageId, pageId) ? <div className="flex"><MinimizeButton appHome={`/apps/${packageId}`} /></div> : null}
          {packageId === "videos" && pageId === "watch" ? <VideoDetails id={new URLSearchParams(location.search).get("id") ?? String((location.state as { pageState?: { id?: string } } | null)?.pageState?.id ?? "")} /> : null}
          {packageId === "music" && pageId === "play" ? <MusicVisualizerSection id={new URLSearchParams(location.search).get("id") ?? String((location.state as { pageState?: { id?: string } } | null)?.pageState?.id ?? "")} /> : null}
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
            }} locale={navigator.language} unit={weatherUnit === "celsius" ? "C" : "F"} advice={weatherSelectedAdvice} summary={weatherSelectedForecast?.summary} />
          </> : null}
        </>); }}
      </AsyncState>
    </div>
  );
  // NEWS-SIDEBAR-01: an app that declares a sidebar gets its own column beside the content from wide screens up (the kit's one
  // section sidebar); its section tabs give way to it there, and a phone keeps them.
  const framed = sidebarProps ? (
    <div className="flex min-h-0 flex-1" data-workspace-fill="" data-slot="package-app-frame" data-testid="package-app-frame">
      <SectionSidebar standalone density="compact" title={app?.label} {...sidebarProps} />
      {content}
    </div>
  ) : content;
  return media && hubActive ? <MediaHubFrame packageId={packageId}>{framed}</MediaHubFrame> : framed;
}

/** A page document without its search box: on a phone the sections bar's Search item takes its place. */
function withoutSearchBox(doc: unknown): unknown {
  const page = doc as { body?: Array<{ type?: string }> };
  return Array.isArray(page.body) ? { ...page, body: page.body.filter((node) => node.type !== "search") } : doc;
}

/** The app's own sections as tabs (when it has any). */
function AppToolbar({ inShellBar = false, sectionsInBar = false, hideSectionsOnWide = false, to, homeLabel, sections, current, familyHeader }: { inShellBar?: boolean; sectionsInBar?: boolean; hideSectionsOnWide?: boolean; to: string; homeLabel: string; sections: Array<{ page: string; label: string }>; current: string; familyHeader: boolean }) {
  const navigate = useNavigate();
  // MEDIA-POLISH-01: a media app's own header, as the native app has it (YouTube's): its name large with its icon controls on the
  // end side, then its sections as chip tabs. The play page has no header: the picture starts the page.
  if (familyHeader) {
    if (isMediaPlayPage(to.split("/")[2] ?? "", current)) return null;
    const tabs = sections.length > 0 ? (
      <div className={cn("-mx-4 min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain px-4 touch-pan-x lg:mx-0 lg:px-0", hideSectionsOnWide && "lg:hidden")} data-slot="app-section-tabs">
        <Tabs value={current} onValueChange={(value) => navigate(value === "index" ? to : `${to}/${String(value)}`)}>
          <TabsList variant="pill" aria-label="Sections">
            <TabsTrigger value="index">{homeLabel}</TabsTrigger>
            {sections.map((section) => (
              <TabsTrigger key={section.page} value={section.page}>{section.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
    ) : null;
    // In the shell bar (a phone) the title and icon buttons are drawn there; only the section tabs stay in the page.
    if (inShellBar) return tabs && !sectionsInBar ? <div className="flex flex-col gap-2 px-4 lg:px-0">{tabs}</div> : null;
    return tabs ? <div className="flex flex-col gap-2 px-4 lg:px-0">{tabs}</div> : null;
  }
  if (inShellBar) {
    if (sections.length === 0 || sectionsInBar) return null;
    return (
      <div className="-mx-4 min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain px-4 touch-pan-x" data-slot="app-section-tabs">
        <Tabs value={current} onValueChange={(value) => navigate(value === "index" ? to : `${to}/${String(value)}`)}>
          <TabsList variant="pill" aria-label="Sections">
            <TabsTrigger value="index">{homeLabel}</TabsTrigger>
            {sections.map((section) => (
              <TabsTrigger key={section.page} value={section.page}>{section.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
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
    </div>
  );
}
