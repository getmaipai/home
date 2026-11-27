export type RouteLoader = () => Promise<unknown>;

export function createRoutePreloader(loaders: Readonly<Record<string, RouteLoader>>) {
  const loaded = new Map<string, Promise<void>>();

  return (path: string): void => {
    const entry = Object.entries(loaders).find(([route]) => routeMatches(route, path));
    if (!entry) return;
    const [route, loader] = entry;
    if (loaded.has(route)) return;

    const promise = Promise.resolve()
      .then(loader)
      .then(() => undefined)
      .catch(() => {
        // A speculative load must stay silent; the route's real lazy load
        // can retry when the person follows the link.
        loaded.delete(route);
      });
    loaded.set(route, promise);
  };
}

export const routeLoaders: Record<string, RouteLoader> = {};
const routePreloader = createRoutePreloader(routeLoaders);
let preloadRegistered = false;

export function registerRoutePreloaders(loaders: Readonly<Record<string, RouteLoader>>): void {
  if (preloadRegistered) return;
  preloadRegistered = true;
  Object.assign(routeLoaders, loaders);
}

export function preloadRoute(path: string): void {
  routePreloader(path);
}

function routeMatches(route: string, path: string): boolean {
  const routeParts = route.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (routeParts.at(-1) === "*") {
    routeParts.pop();
    return pathParts.length >= routeParts.length && routeParts.every((part, index) => part.startsWith(":") || part === pathParts[index]);
  }
  const required = routeParts.filter((part) => !part.endsWith("?")).length;
  return pathParts.length >= required && pathParts.length <= routeParts.length && pathParts.every((part, index) => {
    const routePart = routeParts[index];
    return routePart !== undefined && (routePart.startsWith(":") || routePart === part);
  });
}

export function installRoutePreloadListeners(preload: (path: string) => void): () => void {
  const onPointerOver = (event: PointerEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    preloadFromEvent(event, preload);
  };
  const onFocusIn = (event: FocusEvent) => preloadFromEvent(event, preload);

  document.addEventListener("pointerover", onPointerOver, { capture: true, passive: true });
  document.addEventListener("focusin", onFocusIn, { capture: true, passive: true });
  return () => {
    document.removeEventListener("pointerover", onPointerOver, true);
    document.removeEventListener("focusin", onFocusIn, true);
  };
}

function preloadFromEvent(event: Event, preload: (path: string) => void): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  if (!anchor || !anchor.closest('[data-slot="app-rail"], [data-slot="phone-nav"], [role="navigation"]')) return;

  const url = new URL(anchor.href, document.baseURI);
  if (url.origin !== window.location.origin) return;
  preload(url.pathname);
}
