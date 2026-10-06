// One list for the privacy-flagged engines a minor's web or image request
// never names when enabled on the household's SearXNG.
export const PRIVACY_FLAGGED_SEARCH_ENGINES = ["yandex", "yandex images", "baidu", "baidu images"] as const;

// Retained for the image selection path's existing name.
export const ADULT_ONLY_IMAGE_ENGINES = ["yandex images", "yandex"] as const;

/** Whether a SearXNG engine name is privacy-flagged for minors. */
export function isPrivacyFlaggedSearchEngine(name: string): boolean {
  const n = name.toLowerCase().trim();
  return (PRIVACY_FLAGGED_SEARCH_ENGINES as readonly string[]).includes(n);
}

/** Whether a SearXNG engine name is adult-only. */
export function isAdultOnlyImageEngine(name: string): boolean {
  const n = name.toLowerCase().trim();
  return (ADULT_ONLY_IMAGE_ENGINES as readonly string[]).includes(n);
}
