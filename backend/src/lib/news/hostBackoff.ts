// One News host's refusal quiets both page enrichment and picture downloads. No host enters a log or counter.
const quiet = new Map<string, number>();
export const NEWS_HOST_BACKOFF_MS = 3_600_000;
export function newsHostQuiet(host: string, now: number): boolean { return (quiet.get(host) ?? 0) > now; }
export function quietNewsHost(host: string, now: number): void { quiet.set(host, now + NEWS_HOST_BACKOFF_MS); }
export function __resetNewsHostBackoffForTests(): void { quiet.clear(); }
