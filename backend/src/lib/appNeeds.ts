import { listPackageIds, loadManifestOnly } from "@/lib/plugins";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import type { AppNeed, StatusApp } from "@/lib/statusApps";

const CORE_APPS: StatusApp[] = [
  {
    id: "home",
    name: "Home",
    needs: [{ kind: "engine", id: "hub", name: "MaiPai Home", purpose: "Open the household hub", required: true }],
  },
  {
    id: "chat",
    name: "Chat",
    needs: [
      { kind: "engine", id: "chat", name: "MaiPai's AI", purpose: "Answer chat turns", required: true },
      { kind: "engine", id: "understanding", name: "Understanding", purpose: "Find useful context", required: false },
      { kind: "engine", id: "memory", name: "Memory", purpose: "Recall household context", required: false },
      { kind: "engine", id: "voice", name: "Voice", purpose: "Speak replies aloud", required: false },
    ],
  },
];

export function appsFromManifests(manifests: PackageManifest[]): StatusApp[] {
  return manifests.filter((manifest) => manifest.kind === "app").map((manifest) => ({
    id: manifest.id,
    name: manifest.display,
    needs: (manifest.needs ?? []) as AppNeed[],
  }));
}

export function listStatusApps(): StatusApp[] {
  const packageApps: PackageManifest[] = [];
  for (const id of listPackageIds()) {
    const result = loadManifestOnly(id);
    if (result.ok && result.value.kind === "app") packageApps.push(result.value);
  }
  const known = new Set(CORE_APPS.map((app) => app.id));
  return [...CORE_APPS, ...appsFromManifests(packageApps).filter((app) => !known.has(app.id))];
}
