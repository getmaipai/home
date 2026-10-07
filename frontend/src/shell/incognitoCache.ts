const KEY = "maipai.incognito";

export function readIncognitoCache(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function writeIncognitoCache(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(KEY, "1");
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked (private window, etc.) - silently skip.
  }
}
