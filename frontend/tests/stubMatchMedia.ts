// happy-dom's `matchMedia` does not evaluate real CSS media features
// (`pointer`, `hover`, `max-width`, ...) - this stubs `window.matchMedia`
// directly instead, the same reason `usehooks-ts`'s own implementation
// only ever calls `.matches`/`.addEventListener` on whatever `matchMedia`
// returns, never the query string itself. Pass a query-keyed map for a
// hook that reads `.matches`; an empty map is enough for a hook (like
// `useIsMobile`) that only needs a valid MediaQueryList-shaped object to
// call `.addEventListener` on without throwing, computing its own answer
// from `window.innerWidth` instead.
export function stubMatchMedia(matches: Record<string, boolean> = {}) {
  window.matchMedia = ((query: string) => ({
    matches: matches[query] ?? false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as typeof window.matchMedia;
}
