import { listPackageIds, loadManifestOnly } from "@/lib/plugins";
import { getHouseholdSettingValue } from "@/lib/settings";
import { serviceComponent } from "@/lib/serviceComponent";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import type { AppNeed, StatusApp } from "@/lib/statusApps";
export type { StatusApp } from "@/lib/statusApps";

const CORE_APPS: StatusApp[] = [
  { id: "home", name: "Home", needs: [{ kind: "engine", id: "hub", name: "MaiPai Home", purpose: "Open the household hub", required: true }] },
  { id: "chat", name: "Chat", needs: [
    { kind: "engine", id: "chat", name: "MaiPai's AI", purpose: "Answer chat turns", required: true },
    { kind: "engine", id: "understanding", name: "Understanding", purpose: "Find useful context", required: false },
    { kind: "engine", id: "memory", name: "Memory", purpose: "Recall household context", required: false },
    { kind: "engine", id: "voice", name: "Voice", purpose: "Speak replies aloud", required: false },
  ] },
];

let statusAppsForTests: StatusApp[] | undefined;
export function __setStatusAppsForTests(apps: StatusApp[] | undefined): void { statusAppsForTests = apps; }
export function __resetStatusAppsForTests(): void { statusAppsForTests = undefined; }

export function appsFromManifests(manifests: PackageManifest[]): StatusApp[] {
  return manifests.filter((manifest) => manifest.kind === "app").map((manifest) => ({
    id: manifest.id,
    name: manifest.display,
    needs: (manifest.needs ?? []) as AppNeed[],
  }));
}

const BUILT_IN_PLUGIN_SERVICES: Record<string, AppNeed[]> = {
  "media-lookup": [
    { kind: "service", id: "www.wikidata.org", name: "Wikidata", purpose: "Find films and television shows", required: false },
    { kind: "service", id: "en.wikipedia.org", name: "Wikipedia", purpose: "Summarize media details", required: false },
  ],
  knowledge: [{ kind: "service", id: "en.wikipedia.org", name: "Wikipedia", purpose: "Look up requested background facts", required: false }],
  "almanac-onthisday": [{ kind: "service", id: "en.wikipedia.org", name: "Wikipedia", purpose: "Read events for this date", required: false }],
  weather: [
    { kind: "service", id: "api.open-meteo.com", name: "Open-Meteo", purpose: "Get weather forecasts", required: false },
    { kind: "service", id: "geocoding-api.open-meteo.com", name: "Open-Meteo geocoding", purpose: "Find the requested place", required: false },
  ],
  music: [{ kind: "service", id: "musicbrainz.org", name: "MusicBrainz", purpose: "Look up requested music artists", required: false }],
  sports: [{ kind: "service", id: "statsapi.mlb.com", name: "MLB Stats API", purpose: "Read requested baseball scores", required: false }],
  news: [{ kind: "service", id: "feeds.npr.org", name: "NPR", purpose: "Read requested headlines", required: false }],
  websearch: [{ kind: "service", id: "searxng", name: "Household web search", purpose: "Search when configured by the household", required: false }],
};

export function listStatusApps(): StatusApp[] {
  if (statusAppsForTests) return statusAppsForTests.map((app) => ({ ...app, needs: [...app.needs] }));
  const packageApps: PackageManifest[] = [];
  const installedServices = new Map<string, AppNeed>();
  for (const id of listPackageIds()) {
    const result = loadManifestOnly(id);
    if (!result.ok) continue;
    if (result.value.kind === "app") packageApps.push(result.value);
    if (result.value.kind === "plugin") {
      for (const need of BUILT_IN_PLUGIN_SERVICES[id] ?? []) installedServices.set(need.id, need);
    }
  }
  const core = CORE_APPS.map((app) => ({ ...app, needs: [...app.needs] }));
  const chat = core.find((app) => app.id === "chat")!;
  const searxngConfigured = Boolean(getHouseholdSettingValue("search.searxng_url"));
  chat.needs.push(...[...installedServices.values()].filter((need) => need.id !== "searxng" || searxngConfigured));
  const known = new Set(core.map((app) => app.id));
  const installed = appsFromManifests(packageApps).filter((app) => !known.has(app.id)).map((app) => ({
    ...app,
    needs: [...app.needs, ...(BUILT_IN_PLUGIN_SERVICES[app.id] ?? [])],
  }));
  return [...core, ...installed];
}

export function configuredServiceComponents(): string[] {
  return [...new Set(listStatusApps().flatMap((app) => app.needs
    .filter((need) => need.kind === "service")
    .map((need) => serviceComponent(need.id))))];
}

export function findUndeclaredNeeds(apps: StatusApp[]): string[] {
  const messages: string[] = [];
  for (const app of apps) {
    if (app.needs.length === 0) {
      messages.push(`${app.id}: declares no needs`);
      continue;
    }
    for (const need of app.needs) {
      if (
        need.id === "" ||
        need.name === "" ||
        need.purpose === "" ||
        typeof need.required !== "boolean"
      ) {
        const needId = need.id ?? "(no id)";
        messages.push(`${app.id}: need ${needId} is incomplete`);
      }
    }
  }
  return messages;
}
