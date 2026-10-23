const LAST_APP_ROUTE_KEY = "maipai.settings.last-app-route";

export function rememberLastAppRoute(path: string): void {
  if (!path.startsWith("/") || path.startsWith("/settings")) return;
  try {
    window.sessionStorage.setItem(LAST_APP_ROUTE_KEY, path);
  } catch {
    // Session storage may be unavailable in private or restricted contexts.
  }
}

export function lastAppRoute(): string {
  try {
    const stored = window.sessionStorage.getItem(LAST_APP_ROUTE_KEY);
    if (stored?.startsWith("/") && !stored.startsWith("/settings")) return stored;
  } catch {
    // Fall through to the chat landing page.
  }
  return "/chat";
}

function appHrefForRoute(path: string): string {
  const pathname = path.split(/[?#]/, 1)[0] ?? path;
  if (pathname === "/chat" || pathname.startsWith("/chat/")) return "/chat";
  if (pathname === "/files" || pathname.startsWith("/files/")) return "/files";
  // LEFTNAV-APPS-01: a package app (and its sections) selects its own rail icon, not Home.
  const packageApp = /^\/apps\/[a-z][a-z0-9-]*(?=\/|$)/.exec(pathname)?.[0];
  if (packageApp) return packageApp;
  if (pathname === "/people" || pathname.startsWith("/people/")) return "/people";
  return "/";
}

/** One rail selection value for normal app routes and every settings area. */
export function activeAppHref(pathname: string, packageAreaApps: Readonly<Record<string, string>> = {}): string {
  // A package app's own settings area (`/settings/<area id>`): the app it belongs to stays selected.
  const areaId = /^\/settings\/([^/]+)/.exec(pathname)?.[1];
  const app = areaId ? packageAreaApps[areaId] : undefined;
  if (app) return app;
  if (pathname.startsWith("/settings/")) {
    if (pathname === "/settings/chat" || pathname.startsWith("/settings/chat/")) return "/chat";
    return appHrefForRoute(lastAppRoute());
  }
  return appHrefForRoute(pathname);
}

/** The words for the settings column's back link: the app the person came from (Chat, Library, a package app by its own name, Home). */
export function backLabelFor(path: string, appLabels: Readonly<Record<string, string>> = {}): string {
  const pathname = path.split(/[?#]/, 1)[0] ?? path;
  const packageApp = /^\/apps\/([a-z][a-z0-9-]*)(?=\/|$)/.exec(pathname)?.[1];
  if (packageApp) return appLabels[packageApp] ?? "Back";
  if (pathname === "/chat" || pathname.startsWith("/chat/")) return "Chat";
  if (pathname === "/files" || pathname.startsWith("/files/")) return "Library";
  if (pathname === "/people" || pathname.startsWith("/people/")) return "People";
  if (pathname === "/") return "Home";
  return "Back";
}
