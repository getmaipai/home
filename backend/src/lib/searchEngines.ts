// One list of the image engines a minor's pictures never come from (owner,
// 2026-10-06: Yandex Images only as an optional adult engine the household
// enables in its own SearXNG). The search request and the picture rules both
// read it (principle 4); SEARXNG-SET-04 extends this one list.
export const ADULT_ONLY_IMAGE_ENGINES = ["yandex images", "yandex"] as const;

/** Whether a SearXNG engine name is adult-only. */
export function isAdultOnlyImageEngine(name: string): boolean {
  const n = name.toLowerCase().trim();
  return (ADULT_ONLY_IMAGE_ENGINES as readonly string[]).includes(n);
}
