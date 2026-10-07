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
