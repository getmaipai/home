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
  if (pathname === "/people" || pathname.startsWith("/people/")) return "/people";
  return "/";
}

/** One rail selection value for normal app routes and every settings area. */
export function activeAppHref(pathname: string): string {
  if (pathname === "/settings/chat" || pathname.startsWith("/settings/chat/")) return "/chat";
  if (pathname === "/settings/account" || pathname.startsWith("/settings/account/") || pathname === "/settings/home" || pathname.startsWith("/settings/home/")) {
    return appHrefForRoute(lastAppRoute());
  }
  return appHrefForRoute(pathname);
}
