// The "what leaves the house" table (getmaipai/.github/CLAUDE.md >
// Privacy architecture). MaiPai's whole promise is that nothing leaves
// your house, and the standard makes that checkable rather than a claim:
// every outbound connection is listed with when it happens, what it
// carries, and who receives it, in language a busy parent can read.
//
// Two sources, one table. A package declares its own connections in its
// manifest's `data_sources[]`, which is already PrivacyRow-shaped, so
// those are read straight off the manifests rather than restated here
// (org standard 4: one definition, one place). The hub's own downloads
// are not declared anywhere else, so they are declared here once, and
// each one takes its destination from the URL the downloader actually
// uses rather than a second copy of the host name that could drift.
import { CATALOG } from "@/lib/modelCatalog";
import { ENGINE_BINARIES } from "@/lib/engineCatalog";
import { EMBED_MODEL_URL } from "@/lib/embedAssets";
import { WAKEWORD_ALL_ASSETS } from "@/lib/wakewordAssets";
import { voiceCatalogUrl } from "@/lib/voiceCatalog";
import { listPackageIds, loadPackage, type LoadedPackage } from "@/lib/plugins";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import type { PrivacyConnection } from "@/wire";

/** The host a URL actually reaches, so a row can never name a different
 * service from the one the code connects to. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** The distinct hosts a set of pinned URLs reaches, as one readable
 * string, or null when there are none. Null drops the row: a catalog
 * with nothing downloadable pinned in it (every entry `implemented:
 * false`, say) would otherwise render a row with a blank destination
 * and a blank "who gets it", which reads worse than no row at all
 * because it looks like something is being withheld. Found in a code
 * review, 2026-09-05. */
function hostsOf(urls: string[]): string | null {
  const hosts = [...new Set(urls.map(hostOf))].filter((h) => h.length > 0);
  return hosts.length > 0 ? hosts.join(", ") : null;
}

/** What a plain file download tells the other end. Every hub connection
 * below carries exactly this and nothing else, which is the single most
 * important sentence on the whole page, so it is written once. */
const DOWNLOAD_CARRIES =
  "the name of the file being downloaded, and your home's internet address. Nothing anyone in the house said, asked, or saved.";

const THIRD_PARTY_RETENTION = "we do not know and cannot control it; see that service's own policy";

/** The hub's own outbound connections. Every one is a download the
 * household asked for by turning something on or pressing a button;
 * there is no update ping, no analytics, and no connection MaiPai makes
 * to anything of ours (the org's zero-phone-home rule). */
export function platformConnections(): PrivacyConnection[] {
  // Catalog entries marked `implemented: false` are recorded decisions
  // with no pinned download at all; nothing can fetch them, so nothing
  // about them belongs in a table of connections that really happen.
  const modelHosts = hostsOf(CATALOG.filter((m) => m.download).map((m) => m.download!.url));
  const engineHosts = hostsOf(
    ENGINE_BINARIES.flatMap((b) => [b.archive.url, ...(b.extraArchives ?? []).map((a) => a.url)]),
  );
  const wakewordHosts = hostsOf(WAKEWORD_ALL_ASSETS.map((a) => a.url));
  const voiceHost = hostsOf([voiceCatalogUrl()]);

  const rows: (PrivacyConnection | null)[] = [
    row("platform:language-models", modelHosts, {
      when: "only when an adult picks a language model to download, in Settings",
      what: DOWNLOAD_CARRIES,
    }),
    row("platform:engine", engineHosts, {
      when: "once, when the hub sets up the program that runs the models on your computer",
      what: DOWNLOAD_CARRIES,
    }),
    row("platform:wake-word-models", wakewordHosts, {
      when: "once, when someone turns on listening for a wake word",
      what: DOWNLOAD_CARRIES,
    }),
    row("platform:voice-list", voiceHost, {
      when: "when an adult opens the list of voices to pick one",
      what: "a request for the list of available voices, and your home's internet address. No recording, and no voice of anyone in the house.",
    }),
    // The three rows below are the ones a code review (2026-09-05) found
    // missing while this page told every family "if it is not on this
    // list, it does not happen". Turning on the speaking voice runs
    // `uvx pocket-tts serve` (ttsSupervisor.ts), which installs a Python
    // package and then downloads a voice model - and, if the household
    // saved a Hugging Face token so cloned voices work, that token goes
    // with it. A credential leaving the house is the single most
    // important thing this table can say, and it was not saying it.
    row("platform:tts-program", "pypi.org, files.pythonhosted.org", {
      when: "the first time someone turns on the speaking voice",
      what: DOWNLOAD_CARRIES,
    }),
    row("platform:tts-model", "huggingface.co", {
      when: "the first time the hub speaks out loud, and again after an update",
      what:
        "the name of the voice model being downloaded, your home's internet address, and - only if an adult saved a Hugging Face access token in Settings so cloned voices work - that token. Nothing anyone in the house said, and no recording of anyone's voice.",
    }),
    row("platform:tts-voice-files", "huggingface.co", {
      when: "when someone picks a voice, to fetch that one voice's sample",
      what: "the name of the chosen voice file, and your home's internet address. No recording of anyone in the house.",
    }),
    // Real, but nothing in MaiPai reaches it today: memory recall uses a
    // deterministic keyword and entity scorer (memory.ts), not an
    // embedder. The row stays because the download path exists in the
    // code and an honest table lists what CAN happen; the wording is
    // what stops it implying a search feature that is not there. Another
    // code-review catch, same pass.
    row("platform:text-embedding-model", hostsOf([EMBED_MODEL_URL]), {
      when: "only if something asks the hub to turn text into numbers for searching. Nothing in MaiPai does this today.",
      what: DOWNLOAD_CARRIES,
    }),
  ];
  return rows.filter((r): r is PrivacyConnection => r !== null);
}

/** One hub row, or null when there is no host to name. `who` is always
 * the same as `destination` for the hub's own downloads: there is no
 * middleman, the connection goes straight from the house to that host. */
function row(
  id: string,
  host: string | null,
  fields: { when: string; what: string },
): PrivacyConnection | null {
  if (!host) return null;
  return {
    id,
    source: "MaiPai Home",
    sourceKind: "platform",
    destination: host,
    when: fields.when,
    what: fields.what,
    who: host,
    // The hub's own downloads have no per-connection opt-in toggle to
    // point at; `when` says exactly what triggers each one, and the page
    // only renders the opt-in line for package rows, where the manifest
    // really declares it.
    optIn: true,
    retention: THIRD_PARTY_RETENTION,
  };
}

/** Every bundled package, loaded once. A code review (2026-09-05) found
 * the connections and the never-connects list each walking and Zod-
 * validating every manifest and recipe separately, so one page view read
 * and parsed all twelve files twice. */
function loadedManifests(): PackageManifest[] {
  return listPackageIds()
    .sort()
    .map((id) => loadPackage(id))
    .filter((r): r is { ok: true; value: LoadedPackage } => r.ok)
    .map((r) => r.value.manifest);
}

/** Every bundled package's declared connections, read from the manifests
 * themselves. A package with an empty `data_sources[]` contributes
 * nothing, which is the honest answer for one that never leaves the
 * house. */
export function pluginConnections(manifests = loadedManifests()): PrivacyConnection[] {
  const rows: PrivacyConnection[] = [];
  for (const manifest of manifests) {
    for (const source of manifest.data_sources ?? []) {
      rows.push({
        id: `${manifest.id}:${source.id}`,
        source: manifest.display,
        sourceKind: "plugin",
        destination: source.destination,
        when: source.when,
        what: source.what,
        who: source.who,
        optIn: source.opt_in,
        retention: source.retention,
      });
    }
  }
  return rows;
}

/** The packages that reach nothing outside the house at all, by name.
 * The page says so out loud: a table with packages missing from it reads
 * like an omission unless the missing ones are accounted for.
 *
 * "Declares no data sources" is NOT enough to earn a place here, because
 * `data_sources` is optional in the manifest schema: a package that
 * reaches the network and simply forgot to declare where would be listed
 * to the family as connecting to nothing at all, which is an affirmative
 * false claim and worse than leaving it out. A package qualifies only if
 * it also holds no `net:` permission, so it is structurally incapable of
 * reaching anything. Anything that declares neither way is left off both
 * lists rather than vouched for. Found in a code review, 2026-09-05. */
export function offlinePluginNames(manifests = loadedManifests()): string[] {
  return manifests
    .filter(
      (m) =>
        (m.data_sources ?? []).length === 0 && !(m.permissions ?? []).some((p) => p.startsWith("net:")),
    )
    .map((m) => m.display);
}

/** The whole table: the hub's own connections first, then each
 * package's. */
export function privacyConnections(manifests = loadedManifests()): PrivacyConnection[] {
  return [...platformConnections(), ...pluginConnections(manifests)];
}

/** Both halves of the page from one pass over the packages. */
export function privacyPageData(): { connections: PrivacyConnection[]; offlinePlugins: string[] } {
  const manifests = loadedManifests();
  return {
    connections: privacyConnections(manifests),
    offlinePlugins: offlinePluginNames(manifests),
  };
}
