// MEDIA-HUB-06: whether the person came in through the Media hub this tab. The flag lives in sessionStorage, so a tab opened
// from Media keeps the Media column showing while it moves between media app pages, and a tab opened from an app's own pinned
// icon (or Chat, Library, a non-media app) never shows it. Every read and write is wrapped in try/catch: blocked storage just
// means the column stays hidden and nothing throws.
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { isMediaApp } from "@/shell/mediaApps";

const FLAG_KEY = "maipai.media-hub";
const FLAG_ON = "1";

function readFlag(): boolean {
  try {
    return sessionStorage.getItem(FLAG_KEY) === FLAG_ON;
  } catch {
    return false;
  }
}

function writeFlag(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(FLAG_KEY, FLAG_ON);
    else sessionStorage.removeItem(FLAG_KEY);
  } catch {
    // storage blocked: the column stays hidden, nothing else to do
  }
}

export function enterMediaHub(): void {
  writeFlag(true);
}

export function useMediaHubActive(): boolean {
  const { pathname } = useLocation();
  const mediaAppMatch = /^\/apps\/([a-z][a-z0-9-]*)/.exec(pathname);
  const inMediaApp = Boolean(mediaAppMatch && isMediaApp(mediaAppMatch[1] ?? ""));
  const active = pathname === "/media" || (inMediaApp && readFlag());

  useEffect(() => {
    if (pathname === "/media") writeFlag(true);
    else if (!inMediaApp) writeFlag(false);
  }, [pathname, inMediaApp]);

  return active;
}
