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
import { KIWIX_BINARIES } from "@/lib/kiwixCatalog";
import { KIWIX_CATALOG_URL } from "@/lib/referenceLibrary";
import { EMBED_MODEL_URL } from "@/lib/embedAssets";
import { BACKGROUND_MODEL_URL, BACKGROUND_MODEL_SMALL_URL } from "@/lib/backgroundAssets";
import { WAKEWORD_ALL_ASSETS } from "@/lib/wakewordAssets";
import { VISION_ALL_ASSETS } from "@/lib/visionAssets";
import { SILERO_VAD_ASSET } from "@/lib/sttAssets";
import { voiceCatalogUrl } from "@/lib/voiceCatalog";
import { listPackageIds, loadPackage, type LoadedPackage } from "@/lib/plugins";
import { telegramConfigured } from "@/lib/telegramChannel";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import type { PrivacyConnection } from "@/wire";
import { getHouseholdSettingValue } from "@/lib/settings";
import { INTERNET_PROBE_ENABLED_KEY, INTERNET_PROBE_DNS_NAME_KEY, INTERNET_PROBE_TCP_ADDRESS_KEY, INTERNET_PROBE_TCP_PORT_KEY } from "@/settings/coreKeys";

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

/** The hub's own outbound connections. Every one but the update check
 * below is a download the household asked for by turning something on
 * or pressing a button; there is no analytics and no connection MaiPai
 * makes to anything of ours (the org's zero-phone-home rule). The
 * update check (step 10) is the one periodic, not household-triggered
 * call, and it reaches GitHub's own public release API for this
 * open-source project - never a MaiPai-operated server. */
export function platformConnections(): PrivacyConnection[] {
  // Catalog entries marked `implemented: false` are recorded decisions
  // with no pinned download at all; nothing can fetch them, so nothing
  // about them belongs in a table of connections that really happen.
  const modelHosts = hostsOf(CATALOG.filter((m) => m.download).map((m) => m.download!.url));
  const engineHosts = hostsOf(
    ENGINE_BINARIES.flatMap((b) => [b.archive.url, ...(b.extraArchives ?? []).map((a) => a.url)]),
  );
  const wakewordHosts = hostsOf(WAKEWORD_ALL_ASSETS.map((a) => a.url));
  const visionHosts = hostsOf(VISION_ALL_ASSETS.map((a) => a.url));
  const voiceHost = hostsOf([voiceCatalogUrl()]);
  const sttHosts = hostsOf([SILERO_VAD_ASSET.url]);
  const internetProbeOn = getHouseholdSettingValue(INTERNET_PROBE_ENABLED_KEY) !== false;
  const internetProbeDns = String(getHouseholdSettingValue(INTERNET_PROBE_DNS_NAME_KEY) ?? "example.com");
  const internetProbeAddress = String(getHouseholdSettingValue(INTERNET_PROBE_TCP_ADDRESS_KEY) ?? "1.1.1.1");
  const internetProbePort = Number(getHouseholdSettingValue(INTERNET_PROBE_TCP_PORT_KEY) ?? 443);

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
    row("platform:face-vision-models", visionHosts, {
      when: "once, when someone starts face enrollment in the browser",
      what: DOWNLOAD_CARRIES,
    }),
    row("platform:voice-list", voiceHost, {
      when: "when an adult opens the list of voices to pick one",
      what: "a request for the list of available voices, and your home's internet address. No recording, and no voice of anyone in the house.",
    }),
    // Home fetches the small Silero model only for local utterance
    // endpointing; transcription model downloads belong to the Stack.
    row("platform:stt-models", sttHosts, {
      when: "the first time someone uses streaming speech input, when Home downloads its small voice-activity model to cut speech into sentences; speech recognition runs on the Stack",
      what: DOWNLOAD_CARRIES,
    }),
    // Memory recall uses this embedder (memory.ts: embed() on every
    // remember() and recall query), so the row reflects current use,
    // not the retired keyword scorer. #112.
    row("platform:text-embedding-model", hostsOf([EMBED_MODEL_URL]), {
      when: "when the hub needs the small text-to-numbers model that memory recall uses to find related memories; downloaded once",
      what: DOWNLOAD_CARRIES,
    }),
    // #112: the background memory helper's own model download was missing
    // from this table - the page told families "if it is not on this
    // list, it does not happen" while the helper downloads ~2.5 GB on
    // first use.
    row("platform:background-model", hostsOf([BACKGROUND_MODEL_URL, BACKGROUND_MODEL_SMALL_URL]), {
      when: "the first time the hub needs its memory helper, the small model that decides what to remember and writes conversation summaries",
      what: DOWNLOAD_CARRIES,
    }),
    // Home Assistant doesn't get a row here (it's the household's own LAN
    // device, not a third party leaving the house); Telegram genuinely
    // does, and only appears once an adult has actually set up the bot -
    // an unconfigured household reaches nothing, and the table should say
    // so by omission, the same "no host, no row" rule every row above
    // already follows.
    row("platform:telegram", telegramConfigured() ? "api.telegram.org" : null, {
      when: "when a notification you or your household chose to send to Telegram fires",
      what: "the rendered notification text and your linked Telegram chat id. Nothing anyone in the house said or asked otherwise.",
    }),
    // Step 10: the one periodic (not household-triggered) outbound call
    // this hub makes on its own, per this file's own header - checking
    // for a new MaiPai Home release, listed here in the same commit that
    // added it (org standard: "adding an outbound endpoint updates the
    // privacy page, no exceptions"). GitHub's public API, never a
    // MaiPai-operated server.
    row("platform:update-check", "api.github.com", {
      when: "automatically, at most once a day",
      what: "a request for this project's latest release information, and, only when a MaiPai robot is paired, a second request for MaiPai Bot's latest release information, plus your home's internet address. No name or device ID goes with either. Nothing anyone in the house said, asked, or saved.",
    }),
    row("platform:internet-probe", `DNS resolver (${internetProbeDns}) and ${internetProbeAddress}:${internetProbePort}`, {
      when: internetProbeOn ? "automatically, once a minute; turn it off under Household, General" : "not while the internet check is turned off under Household, General",
      what: "one DNS name lookup and an empty TCP connection that sends no data, only your home's internet address. Nothing anyone in the house said or saved is sent.",
    }),
    // KIWIX-SIDECAR-01's own gap: kiwix-serve itself sends nothing (it
    // only listens on this computer), but installing it in the first
    // place downloads a real program from Kiwix, missed when that item
    // landed - found while REFERENCE-LIBRARY-01 was adding the row
    // below right next to it.
    row("platform:kiwix-tools", hostsOf(KIWIX_BINARIES.map((b) => b.archive.url)), {
      when: "once, when the hub sets up the program that serves your offline reference books",
      what: DOWNLOAD_CARRIES,
    }),
    // REFERENCE-LIBRARY-01: exact wording from docs/plans/
    // knowledge-sources-2026-09-24.md's own Privacy paragraph.
    // A review found the first draft's destination named only the
    // catalog lookup host - the real ZIM bytes come from a second host
    // (the load balancer verified live, 2026-09-24: lb.download.kiwix.org,
    // docs/dev.md), which then hands off to whichever regional mirror it
    // picks, a third host that genuinely can't be named in advance. Both
    // hosts this repo has actually seen a real connection to are listed
    // structurally now, not left to prose alone.
    row("platform:reference-library", hostsOf([KIWIX_CATALOG_URL, "https://lb.download.kiwix.org/"]), {
      when: "when an adult installs or updates one of your household's offline reference books",
      what: "the file name of the book being downloaded, and your home's internet address, sent to Kiwix and to a third-party download mirror Kiwix picks for you. Nothing anyone in the house said, asked, or saved.",
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
    direction: "outbound",
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
        direction: "outbound",
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
// Session C step 8 (session-c-brain-and-voice.md): "listed on the
// privacy page as inbound only." Every row elsewhere in this file is
// OUTBOUND - the hub reaching a third party - so `PrivacyConnection`'s
// own fields (`destination`, `who` - a host the hub connects TO) don't
// literally fit a connection running the other direction: nothing
// leaves the house here, something reaches IN. Deliberately still a row
// on this same table rather than a separate page or mechanism, since
// "can anything reach into my house, and how" is exactly the question
// this page exists to answer honestly - `destination`/`who` are
// repurposed to describe the CALLER, not a host the hub reaches out to,
// with the reversal spelled out in `what` so nobody reads it as an
// outbound row by mistake.
function inboundConnections(): PrivacyConnection[] {
  return [
    {
      id: "platform:inbound-api",
      source: "MaiPai Home",
      sourceKind: "platform",
      destination: "your own network only - nothing leaves the house for this row",
      when: "only if an adult generates an API token in Settings and gives it to another app or device",
      what:
        "the reverse of every other row here: an app or device you configured (Home Assistant's own Assist pipeline, a script, a voice satellite) can send text or audio to the hub over your LAN and get a reply back, using the OpenAI-compatible chat API or the Wyoming voice-satellite protocol. Nothing is reachable without a token an adult generated and handed out; revoking it in Settings ends access immediately.",
      who: "whichever app or device holds the token an adult generated",
      optIn: true,
      retention: "no separate record kept beyond the normal conversation history any chat turn already creates",
      direction: "inbound",
    },
  ];
}

export function privacyConnections(manifests = loadedManifests()): PrivacyConnection[] {
  return [...platformConnections(), ...inboundConnections(), ...pluginConnections(manifests)];
}

/** Both halves of the page from one pass over the packages. */
export function privacyPageData(): { connections: PrivacyConnection[]; offlinePlugins: string[] } {
  const manifests = loadedManifests();
  return {
    connections: privacyConnections(manifests),
    offlinePlugins: offlinePluginNames(manifests),
  };
}
