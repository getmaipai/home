import { networkInterfaces } from "node:os";
import engineCatalogJson from "@maipai/spec/search/searxng-engines.json" with { type: "json" };
import { SearxngEngines } from "@maipai/spec/gen/ts/searxng-engines.js";
import { db } from "@/db";
import { people } from "@/db/schema";
import { getHouseholdSettingValue } from "@/lib/settings";
import { consumeSearxngRequestToken, FETCH_USER_AGENT } from "@/lib/packageHost";
import { lastSearxngCanaryResult } from "@/lib/searxngHealth";
import { raiseIssue, resolveIssue } from "@/lib/issues";
import { isStackConfigured } from "@/lib/stackEngine";

const CATALOG = SearxngEngines.parse(engineCatalogJson);
const CHECK_CACHE_MS = 5 * 60_000;
const JSON_CANARY_MAX_AGE_MS = 15 * 60_000;
const MANUAL_REFRESH_COOLDOWN_MS = 60_000;
const FETCH_TIMEOUT_MS = 3_000;
const MAX_RESPONSE_CHARS = 512_000;
const SAFE_SEARCH_ISSUE = "searxng_safe_search_engines";

export type SearchCheckState = "pass" | "warn" | "fail" | "unknown";
export type SearchCheck = { id: string; title: string; state: SearchCheckState; detail: string; fix: string | null };
export type SearchEngineGroup = { id: string; label: string; enabledEngines: string[]; state: SearchCheckState };
export type SearchEngineError = { name: string; percentage: number };
export type SearchInstanceStatus = {
  mode: "off" | "owner" | "stack";
  checkedAt: string;
  version: string | null;
  checks: SearchCheck[];
  groups: SearchEngineGroup[];
  engineErrors: SearchEngineError[];
};

type CheckerOptions = {
  force?: boolean;
  respectCooldown?: boolean;
  fetcher?: SearchInstanceFetch;
  now?: number;
};

type CachedStatus = { storedAt: number; status: SearchInstanceStatus };
export type SearchInstanceFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
let fetchOverride: SearchInstanceFetch | null = null;
const cache = new Map<string, CachedStatus>();
const lastManualRefresh = new Map<string, number>();

export function __setSearchInstanceFetchForTests(fetcher: SearchInstanceFetch | null): void {
  fetchOverride = fetcher;
}

export function __resetSearchInstanceCheckForTests(): void {
  fetchOverride = null;
  cache.clear();
  lastManualRefresh.clear();
}

export class SearchInstanceRefreshCooldownError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Search service check is cooling down");
    this.name = "SearchInstanceRefreshCooldownError";
  }
}

function configuredUrl(): { configured: boolean; baseUrl: string | null } {
  const value = getHouseholdSettingValue("search.searxng_url");
  if (typeof value !== "string" || value.trim().length === 0) return { configured: false, baseUrl: null };
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { configured: true, baseUrl: null };
    if (parsed.username || parsed.password) return { configured: true, baseUrl: null };
    return { configured: true, baseUrl: parsed.toString().replace(/\/$/, "") };
  } catch {
    return { configured: true, baseUrl: null };
  }
}

function emptyStatus(now: number): SearchInstanceStatus {
  const stackOwned = isStackConfigured();
  return {
    mode: stackOwned ? "stack" : "off",
    checkedAt: new Date(now).toISOString(),
    version: null,
    checks: [{ id: "service", title: "MaiPai can reach your search service", state: "unknown", detail: stackOwned ? "MaiPai's Stack manages web search." : "Web search is off until a SearXNG address is set.", fix: stackOwned ? null : "Set the address of a SearXNG service you run." }],
    groups: [],
    engineErrors: [],
  };
}

function invalidAddressStatus(now: number): SearchInstanceStatus {
  const checks: SearchCheck[] = [
    { id: "reachability", title: "MaiPai can reach your search service", state: "fail", detail: "MaiPai can't reach your search service.", fix: "Check the address and that SearXNG is running." },
    { id: "json-format", title: "Search results come back in a form MaiPai reads", state: "unknown", detail: "MaiPai couldn't check the search format until the address is fixed.", fix: "Use an http or https SearXNG address." },
    { id: "limiter", title: "Not blocked by its limiter", state: "unknown", detail: "MaiPai couldn't check the limiter until the address is fixed.", fix: null },
    { id: "version", title: "Up to date", state: "unknown", detail: "MaiPai couldn't check the version until the address is fixed.", fix: null },
    { id: "web-engines", title: "Enough web engines", state: "unknown", detail: "MaiPai couldn't check the enabled search engines until the address is fixed.", fix: null },
    { id: "wikipedia", title: "Wikipedia is on", state: "unknown", detail: "MaiPai couldn't check the reference engines until the address is fixed.", fix: null },
    { id: "pictures", title: "Pictures can be found", state: "unknown", detail: "MaiPai couldn't check the picture engines until the address is fixed.", fix: null },
    { id: "safe-search", title: "Safe search works for children and teens", state: "unknown", detail: "MaiPai couldn't check safe-search support until the address is fixed.", fix: null },
    { id: "news", title: "News engines", state: "unknown", detail: "MaiPai couldn't check the news engines until the address is fixed.", fix: null },
    { id: "video", title: "Video engines", state: "unknown", detail: "MaiPai couldn't check the video engines until the address is fixed.", fix: null },
    { id: "engine-errors", title: "Engines having trouble", state: "unknown", detail: "This SearXNG doesn't share error numbers.", fix: null },
    { id: "privacy-engines", title: "Extra engines that send searches abroad", state: "unknown", detail: "MaiPai couldn't check the extra engines until the address is fixed.", fix: null },
    { id: "default-safe-search", title: "Default safe search", state: "unknown", detail: "MaiPai couldn't check the default safe-search level until the address is fixed.", fix: null },
  ];
  return { mode: "owner", checkedAt: new Date(now).toISOString(), version: null, checks, groups: CATALOG.groups.map((group) => ({ id: group.id, label: group.label, enabledEngines: [], state: "unknown" })), engineErrors: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

type Probe = { kind: "json" | "json-disabled" | "sso" | "blocked" | "other" | "skipped"; status?: number };

function looksLikeSignInPage(text: string, contentType: string): boolean {
  if (contentType.toLowerCase().includes("text/html")) return true;
  const start = text.slice(0, 500).toLowerCase();
  return start.includes("<html") || start.includes("<!doctype html") || start.includes("sign in") || start.includes("log in");
}

function looksLikeLimiterBlock(text: string): boolean {
  const sample = text.slice(0, 2_000).toLowerCase();
  return sample.includes("captcha") || sample.includes("bot detection") || sample.includes("blocked by the limiter") || sample.includes("too many requests");
}

async function request(baseUrl: string, path: string, fetcher: SearchInstanceFetch): Promise<{ status: number; text: string; contentType: string } | null> {
  if (!consumeSearxngRequestToken()) return { status: -1, text: "", contentType: "" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetcher(`${baseUrl}${path}`, {
      method: "GET",
      headers: { accept: path.endsWith("/search") ? "application/json" : "application/json, text/plain", "user-agent": FETCH_USER_AGENT },
      redirect: "manual",
      signal: controller.signal,
    });
    const text = (await response.text()).slice(0, MAX_RESPONSE_CHARS);
    return { status: response.status, text, contentType: response.headers.get("content-type") ?? "" };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function enabledNames(config: Record<string, unknown> | null): Set<string> {
  const rows = Array.isArray(config?.engines) ? config.engines : [];
  return new Set(rows.flatMap((row) => isRecord(row) && row.enabled === true && typeof row.name === "string" ? [row.name] : []));
}

function engineRows(config: Record<string, unknown> | null): Array<Record<string, unknown>> {
  const rows = Array.isArray(config?.engines) ? config.engines : [];
  return rows.filter(isRecord);
}

function groupSummaries(enabled: Set<string>, known: boolean): SearchEngineGroup[] {
  return CATALOG.groups.map((group) => {
    const groupEnabled = group.engines.filter((engine) => enabled.has(engine.name)).map((engine) => engine.name);
    const required = group.id === "general" || group.id === "reference" || group.id === "images";
    const hasMinimum = group.id === "general" ? groupEnabled.length >= CATALOG.minimums.webEngines
      : group.id === "reference" ? groupEnabled.includes("wikipedia")
        : group.id === "images" ? groupEnabled.length >= CATALOG.minimums.pictureEngines
          : true;
    return { id: group.id, label: group.label, enabledEngines: groupEnabled, state: !known ? "unknown" : required && !hasMinimum ? "fail" : "pass" };
  });
}

function configEngineNames(config: Record<string, unknown> | null, category: string): Set<string> {
  return new Set(engineRows(config).flatMap((engine) => {
    const categories = Array.isArray(engine.categories) ? engine.categories : [];
    const categoryMatch = category === "general" ? categories.some((item) => item === "general" || item === "web") : categories.includes(category);
    return engine.enabled === true && engine.safesearch === true && categoryMatch && typeof engine.name === "string" ? [engine.name] : [];
  }));
}

function enabledForCategory(config: Record<string, unknown> | null, category: string): Set<string> {
  return new Set(engineRows(config).flatMap((engine) => {
    const categories = Array.isArray(engine.categories) ? engine.categories : [];
    const categoryMatch = category === "general" ? categories.some((item) => item === "general" || item === "web") : categories.includes(category);
    return engine.enabled === true && categoryMatch && typeof engine.name === "string" ? [engine.name] : [];
  }));
}

function minorsInHousehold(): boolean {
  return db.select().from(people).all().some((person) => !person.deletedAt && (person.role === "child" || person.role === "teen"));
}

function displaySafeSearch(value: unknown): string | null {
  if (value === 0) return "Off";
  if (value === 1) return "Moderate";
  if (value === 2) return "Strict";
  return null;
}

function staleVersion(value: unknown, now: number): boolean | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})[.-](\d{1,2})(?:[.-](\d{1,2}))?/.exec(value);
  if (!match) return null;
  const released = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3] ?? 1));
  return now - released > 183 * 24 * 60 * 60_000;
}

function relevantEngineNames(): Set<string> {
  const homeGroups = new Set(["general", "reference", "images", "news", "video"]);
  return new Set(CATALOG.groups.filter((group) => homeGroups.has(group.id)).flatMap((group) => group.engines.map((engine) => engine.name)));
}

function readEngineErrors(value: unknown): SearchEngineError[] | null {
  if (!isRecord(value)) return null;
  const names = relevantEngineNames();
  const errors: SearchEngineError[] = [];
  for (const [name, rows] of Object.entries(value)) {
    if (!names.has(name) || !Array.isArray(rows)) continue;
    const percentages = rows.flatMap((row) => isRecord(row) && typeof row.percentage === "number" ? [row.percentage] : []);
    if (percentages.length) errors.push({ name, percentage: Math.max(...percentages) });
  }
  return errors;
}

function engineLabel(name: string): string {
  const engine = CATALOG.groups.flatMap((group) => group.engines).find((item) => item.name === name);
  if (name === "wikicommons.images") return "Wikimedia Commons images";
  if (name === "brave.images") return "Brave images";
  if (name.endsWith(".images")) return `${name.slice(0, -7)} images`;
  return engine?.operator ?? name;
}

function buildChecks(args: {
  healthResponse: Awaited<ReturnType<typeof request>>;
  config: Record<string, unknown> | null;
  configStatus: number | null;
  stats: unknown;
  probe: Probe;
  jsonProbeWasRecent: boolean;
  now: number;
}): { checks: SearchCheck[]; engineErrors: SearchEngineError[]; groups: SearchEngineGroup[]; hasUnsafeMinorEngines: boolean | null } {
  const { healthResponse, config, configStatus, probe, jsonProbeWasRecent, now } = args;
  const checks: SearchCheck[] = [];
  const healthOk = healthResponse?.status === 200 && healthResponse.text.trim().toUpperCase() === "OK";
  const healthState: SearchCheckState = healthResponse?.status === -1 ? "unknown" : healthOk ? "pass" : "fail";
  checks.push({ id: "reachability", title: "MaiPai can reach your search service", state: healthState, detail: healthState === "unknown" ? "MaiPai couldn't check reachability because recent searches used the shared request limit." : healthOk ? "SearXNG answered its health check." : "MaiPai can't reach your search service.", fix: healthOk ? null : healthState === "unknown" ? "Check again after a few seconds." : "Check the address and that SearXNG is running." });

  const jsonProbeOk = probe.kind === "json" || (jsonProbeWasRecent && probe.kind === "skipped");
  const jsonDetail = probe.kind === "json-disabled" ? "JSON results are turned off."
    : probe.kind === "sso" ? "The address opens a sign-in page."
      : probe.kind === "blocked" ? "Your SearXNG's limiter is blocking MaiPai."
        : probe.kind === "other" ? "Search results didn't come back in a form MaiPai reads."
          : jsonProbeOk ? "JSON results are enabled." : "A recent check could not confirm JSON results.";
  const jsonState: SearchCheckState = jsonProbeOk ? "pass" : probe.kind === "skipped" || probe.kind === "blocked" ? "unknown" : "fail";
  checks.push({ id: "json-format", title: "Search results come back in a form MaiPai reads", state: jsonState, detail: jsonDetail, fix: jsonState === "pass" || probe.kind === "blocked" || probe.kind === "skipped" ? null : probe.kind === "sso" ? "Use an address that skips your sign-in page." : "Add json to search.formats." });

  const limiterConfig = isRecord(config?.limiter) ? config.limiter : null;
  const limiterEnabled = typeof limiterConfig?.enabled === "boolean" ? limiterConfig.enabled : null;
  const isBlocked = probe.kind === "blocked";
  const limiterState: SearchCheckState = isBlocked ? "fail" : limiterEnabled === null || (limiterEnabled && !(probe.kind === "json" || probe.kind === "json-disabled" || probe.kind === "sso" || jsonProbeWasRecent)) ? "unknown" : "pass";
  checks.push({ id: "limiter", title: "Not blocked by its limiter", state: limiterState, detail: isBlocked ? "Your SearXNG's limiter is blocking MaiPai." : limiterEnabled ? "The limiter is on and the test search was not blocked." : limiterEnabled === false ? "The limiter is off." : "MaiPai couldn't read the limiter state.", fix: isBlocked ? "Add this hub's address to pass_ip in limiter.toml." : null });

  const versionOld = staleVersion(config?.version, now);
  checks.push({ id: "version", title: "Up to date", state: versionOld === true ? "warn" : versionOld === false ? "pass" : "unknown", detail: versionOld === true ? "Your SearXNG is over 6 months old; some engines may stop working." : versionOld === false ? `SearXNG ${config?.version} is less than 6 months old.` : "SearXNG version is unavailable or could not be dated.", fix: versionOld === true ? "Update SearXNG." : null });

  const configKnown = configStatus === 200 && config !== null;
  const enabled = enabledNames(config);
  const general = CATALOG.groups.find((group) => group.id === "general")?.engines ?? [];
  const enabledWeb = enabledForCategory(config, "general");
  const webCount = general.filter((engine) => enabledWeb.has(engine.name)).length;
  checks.push({ id: "web-engines", title: "Enough web engines", state: !configKnown ? "unknown" : webCount < CATALOG.minimums.webEngines ? "fail" : "pass", detail: !configKnown ? "MaiPai couldn't read the enabled search engines." : webCount < CATALOG.minimums.webEngines ? "Fewer than two web engines are on." : `${webCount} general web engines are on.`, fix: webCount < CATALOG.minimums.webEngines ? "Enable engines from the General web list." : null });

  const reference = CATALOG.groups.find((group) => group.id === "reference")?.engines ?? [];
  const wikiOn = enabledWeb.has("wikipedia");
  const wikidataOn = enabledWeb.has("wikidata");
  checks.push({ id: "wikipedia", title: "Wikipedia is on", state: !configKnown ? "unknown" : wikiOn ? "pass" : "fail", detail: !configKnown ? "MaiPai couldn't read the reference engines." : wikiOn ? (wikidataOn ? "Wikipedia and Wikidata are on." : "Wikipedia is on; Wikidata is off.") : "Wikipedia is off.", fix: !wikiOn ? `Enable ${reference.find((engine) => engine.name === "wikipedia")?.name ?? "wikipedia"}.` : !wikidataOn ? "Enable wikidata for better reference matches." : null });

  const imageGroup = CATALOG.groups.find((group) => group.id === "images");
  const enabledImages = enabledForCategory(config, "images");
  const imageOn = imageGroup?.engines.filter((engine) => enabledImages.has(engine.name)) ?? [];
  checks.push({ id: "pictures", title: "Pictures can be found", state: !configKnown ? "unknown" : imageOn.length === 0 ? "fail" : "pass", detail: !configKnown ? "MaiPai couldn't read the picture engines." : imageOn.length === 0 ? "No picture engines are on, so answers can't show pictures from the web." : `${imageOn.length} picture engine${imageOn.length === 1 ? " is" : "s are"} on.`, fix: imageOn.length === 0 ? "Enable wikicommons.images and brave.images." : null });

  const hasMinor = minorsInHousehold();
  const safeWeb = configEngineNames(config, "general");
  const safeImages = configEngineNames(config, "images");
  const catalogSafeWeb = new Set(general.filter((engine) => engine.safe_search && !engine.privacy_flag).map((engine) => engine.name));
  const catalogSafeImages = new Set((imageGroup?.engines ?? []).filter((engine) => engine.safe_search && !engine.privacy_flag).map((engine) => engine.name));
  const hasSafeWeb = [...safeWeb].some((name) => catalogSafeWeb.has(name));
  const hasSafeImage = [...safeImages].some((name) => catalogSafeImages.has(name));
  const hasUnsafeMinorEngines = !configKnown ? null : hasMinor && (!hasSafeWeb || !hasSafeImage);
  const safeState: SearchCheckState = !configKnown ? "unknown" : hasSafeWeb && hasSafeImage ? "pass" : hasMinor ? "fail" : "warn";
  checks.push({ id: "safe-search", title: "Safe search works for children and teens", state: safeState, detail: safeState === "pass" ? "A safe web engine and a safe picture engine are on." : safeState === "unknown" ? "MaiPai couldn't check safe-search support." : "No child-safe engines are on for pictures.", fix: safeState === "pass" ? null : "Enable a safe-search engine for web and pictures." });

  for (const id of ["news", "video"] as const) {
    const group = CATALOG.groups.find((item) => item.id === id);
    const enabledGroup = group?.engines.filter((engine) => enabledNames(config).has(engine.name)).map((engine) => engine.name) ?? [];
    checks.push({ id, title: id === "news" ? "News engines" : "Video engines", state: configKnown ? "pass" : "unknown", detail: configKnown ? enabledGroup.length ? `${enabledGroup.join(", ")} are on.` : `No ${id} engines are on.` : `MaiPai couldn't read the ${id} engines.`, fix: null });
  }

  const errors = readEngineErrors(args.stats);
  if (errors === null) {
    checks.push({ id: "engine-errors", title: "Engines having trouble", state: "unknown", detail: "This SearXNG doesn't share error numbers.", fix: null });
  } else {
    const struggling = errors.filter((entry) => entry.percentage >= 50);
    checks.push({ id: "engine-errors", title: "Engines having trouble", state: struggling.length ? "warn" : "pass", detail: struggling.length ? struggling.map((entry) => `${engineLabel(entry.name)} is failing in about ${Math.round(entry.percentage)}% of its searches.`).join(" ") : "No engine has an error rate above 50%.", fix: struggling.length ? "Check whether these engines are still enabled and available." : null });
  }

  const extraGroup = CATALOG.groups.find((group) => group.id === "extra");
  const flagged = extraGroup?.engines.filter((engine) => enabled.has(engine.name) && engine.privacy_flag) ?? [];
  checks.push({ id: "privacy-engines", title: "Extra engines that send searches abroad", state: !configKnown ? "unknown" : flagged.length ? "warn" : "pass", detail: !configKnown ? "MaiPai couldn't check the extra engines." : flagged.length ? flagged.map((engine) => `${engine.name} is on: search words go to a company in ${engine.country}. MaiPai never uses it for children or teens.`).join(" ") : "No privacy-flagged extra engines are on.", fix: null });

  const safeSearch = displaySafeSearch(config?.safe_search);
  checks.push({ id: "default-safe-search", title: "Default safe search", state: safeSearch ? "pass" : "unknown", detail: safeSearch ? `Your SearXNG's default is ${safeSearch}. MaiPai sends each person's own level with every search.` : "MaiPai couldn't read the default safe-search level.", fix: null });

  return { checks, engineErrors: errors ?? [], groups: groupSummaries(enabled, configKnown), hasUnsafeMinorEngines };
}

async function updateSafeSearchRepair(hasUnsafeMinorEngines: boolean | null): Promise<void> {
  if (hasUnsafeMinorEngines === null) return;
  if (hasUnsafeMinorEngines) {
    await raiseIssue({
      source: "websearch",
      key: SAFE_SEARCH_ISSUE,
      severity: "error",
      title: "Child-safe search engines are missing",
      detail: "A child or teen profile has no enabled safe-search engine for web or picture searches.",
    });
  } else {
    resolveIssue("websearch", SAFE_SEARCH_ISSUE);
  }
}

function hubAddress(): string | null {
  const all = Object.values(networkInterfaces()).flatMap((items) => items ?? []);
  return all.find((item) => !item.internal && item.family === "IPv4")?.address ?? null;
}

export function buildSearchInstanceSnippet(status: SearchInstanceStatus): { settingsYml: string; limiterToml: string | null } {
  const failed = new Set(status.checks.filter((check) => check.state === "fail").map((check) => check.id));
  const sections: string[] = [];
  if (failed.has("json-format")) sections.push("search:\n  formats:  # Keep any other formats you already list.\n    - html\n    - json");
  const engineNames = new Set<string>();
  const group = CATALOG.groups.find((item) => item.id === "images");
  if (failed.has("pictures")) for (const engine of group?.engines.slice(0, 2) ?? []) engineNames.add(engine.name);
  if (failed.has("wikipedia")) engineNames.add("wikipedia");
  if (failed.has("web-engines")) {
    const web = CATALOG.groups.find((item) => item.id === "general")?.engines ?? [];
    for (const engine of web.slice(0, CATALOG.minimums.webEngines)) engineNames.add(engine.name);
  }
  if (failed.has("safe-search")) {
    const webSafe = CATALOG.groups.find((item) => item.id === "general")?.engines.find((engine) => engine.safe_search && !engine.privacy_flag);
    const imageSafe = group?.engines.find((engine) => engine.safe_search && !engine.privacy_flag);
    const safeWebNames = new Set(CATALOG.groups.find((item) => item.id === "general")?.engines.filter((engine) => engine.safe_search && !engine.privacy_flag).map((engine) => engine.name));
    const safeImageNames = new Set(group?.engines.filter((engine) => engine.safe_search && !engine.privacy_flag).map((engine) => engine.name));
    const enabledGeneral = new Set(status.groups.find((item) => item.id === "general")?.enabledEngines ?? []);
    const enabledImages = new Set(status.groups.find((item) => item.id === "images")?.enabledEngines ?? []);
    if (webSafe && ![...enabledGeneral].some((name) => safeWebNames.has(name))) engineNames.add(webSafe.name);
    if (imageSafe && ![...enabledImages].some((name) => safeImageNames.has(name))) engineNames.add(imageSafe.name);
  }
  if (engineNames.size) {
    sections.push(`engines:\n${[...engineNames].map((name) => `  - name: ${name}\n    disabled: false`).join("\n")}`);
  }
  const settingsYml = sections.length ? `# Merge these settings into your existing settings.yml.\n${sections.join("\n")}` : "# No settings changes are needed.";
  let limiterToml: string | null = null;
  if (failed.has("limiter")) {
    const address = hubAddress();
    limiterToml = address
      ? `# Add this hub address to SearXNG's limiter.toml.\n[botdetection.ip_lists]\npass_ip = [\"${address}\"]`
      : "# Add this hub's address to pass_ip in limiter.toml. Find the address SearXNG sees for this hub.";
  }
  return { settingsYml, limiterToml };
}

export async function checkSearchInstance(options: CheckerOptions = {}): Promise<SearchInstanceStatus> {
  const now = options.now ?? Date.now();
  const configured = configuredUrl();
  if (!configured.configured) return emptyStatus(now);
  const baseUrl = configured.baseUrl;
  if (!baseUrl) return invalidAddressStatus(now);

  const cached = cache.get(baseUrl);
  if (!options.force && cached && now - cached.storedAt < CHECK_CACHE_MS) return cached.status;
  if (options.force && options.respectCooldown) {
    const last = lastManualRefresh.get(baseUrl) ?? 0;
    const elapsed = now - last;
    if (elapsed < MANUAL_REFRESH_COOLDOWN_MS) throw new SearchInstanceRefreshCooldownError(Math.ceil((MANUAL_REFRESH_COOLDOWN_MS - elapsed) / 1000));
    lastManualRefresh.set(baseUrl, now);
  }

  const fetcher = options.fetcher ?? fetchOverride ?? globalThis.fetch;
  const healthResponse = await request(baseUrl, "/healthz", fetcher);
  const configResponse = await request(baseUrl, "/config", fetcher);
  const configValue = configResponse?.status === 200 ? parseJson(configResponse.text) : null;
  const config = isRecord(configValue) ? configValue : null;

  const lastCanary = lastSearxngCanaryResult(baseUrl);
  const canaryIsRecent = lastCanary !== null && now - Date.parse(lastCanary.checkedAt) < JSON_CANARY_MAX_AGE_MS;
  let probe: Probe = canaryIsRecent ? (lastCanary.jsonOk ? { kind: "skipped" } : { kind: "other" }) : { kind: "skipped" };
  if (!canaryIsRecent) {
    const response = await request(baseUrl, `/search?q=Earth&format=json&safesearch=2`, fetcher);
    if (response) {
      if (response.status === -1) probe = { kind: "skipped" };
      else if (response.status === 429 || looksLikeLimiterBlock(response.text)) probe = { kind: "blocked", status: response.status };
      else if (looksLikeSignInPage(response.text, response.contentType)) probe = { kind: "sso", status: response.status };
      else if (response.status === 403) probe = { kind: "json-disabled", status: response.status };
      else if (response.status >= 300 && response.status < 400) probe = { kind: "sso", status: response.status };
      else if (response.status === 200 && isRecord(parseJson(response.text))) probe = { kind: "json", status: response.status };
      else probe = { kind: "other", status: response.status };
    }
  }

  const statsResponse = await request(baseUrl, "/stats/errors", fetcher);
  const stats = statsResponse?.status === 200 ? parseJson(statsResponse.text) : null;
  const result = buildChecks({ healthResponse, config, configStatus: configResponse?.status ?? null, stats, probe, jsonProbeWasRecent: canaryIsRecent && lastCanary?.jsonOk === true, now });
  const status: SearchInstanceStatus = {
    mode: "owner",
    checkedAt: new Date(now).toISOString(),
    version: typeof config?.version === "string" ? config.version : null,
    checks: result.checks,
    groups: result.groups,
    engineErrors: result.engineErrors,
  };
  await updateSafeSearchRepair(result.hasUnsafeMinorEngines);
  cache.set(baseUrl, { storedAt: now, status });
  return status;
}
