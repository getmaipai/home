// ROUTER-BUILD-01b: the search assist's pinned weights. A small signed-release
// asset (a JSON manifest: embedding identity, feature shape, classes, coef,
// intercept, per-tool thresholds). Any problem returns a named reason and
// opens one Repairs row; the caller then runs the turn as if the assist did
// not exist (ROUTER-ARCH-01 2.2, fail open). Nothing here throws.
//
// The manifest shape mirrors the 01a spec schema (search-assist-weights);
// once that spec tag is pinned this zod schema should be replaced by the
// generated one.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { downloadUrl, type DownloadOptions } from "@/lib/modelDownload";
import { raiseIssue, resolveIssue } from "@/lib/issues";
import { EMBED_PREPROCESS } from "@/lib/llm";
import { modelsDir } from "@/lib/paths";

const ISSUE_SOURCE = "search-assist";

export const WeightsReason = z.enum(["weights_missing", "weights_checksum", "embed_mismatch"]);
export type WeightsReason = z.infer<typeof WeightsReason>;

export const SearchAssistManifest = z.object({
  /** The embedding identity the head was trained on. `prefix` is "" for raw
   * text (what Home sends); the feature builder never adds one itself. */
  embed: z.object({ model: z.string().min(1), dims: z.number().int().positive(), preprocess: z.string().min(1), prefix: z.string() }),
  features: z.enum(["alone", "pair", "concat"]),
  classes: z.array(z.string().min(1)).min(2),
  coef: z.array(z.array(z.number().finite())).min(1),
  intercept: z.array(z.number().finite()).min(1),
  /** Per tool: the class whose probability is compared, and the recorded
   * threshold. `null` means argmax. */
  thresholds: z.record(z.string(), z.object({ class: z.string().min(1), value: z.number().min(0).max(1).nullable() })),
  label_spec_version: z.string().min(1),
  dataset_sha256: z.string().min(1),
  bench_record: z.string().min(1),
});
export type SearchAssistManifest = z.infer<typeof SearchAssistManifest>;

/** Throws on a bad shape or on coef/intercept/classes that do not line up. */
export function parseSearchAssistManifest(raw: unknown): SearchAssistManifest {
  const m = SearchAssistManifest.parse(raw);
  const width = m.embed.dims * (m.features === "concat" ? 2 : 1);
  const binary = m.classes.length === 2 && m.coef.length === 1;
  if (!binary && m.coef.length !== m.classes.length) throw new Error("coef rows do not match classes");
  if (m.intercept.length !== m.coef.length) throw new Error("intercept does not match coef");
  if (m.coef.some((row) => row.length !== width)) throw new Error("coef width does not match dims and features");
  for (const t of Object.values(m.thresholds)) if (!m.classes.includes(t.class)) throw new Error("threshold names an unknown class");
  return m;
}

export interface WeightsPin {
  file: string;
  url: string;
  sha256: string;
}

/** The production pin stays absent until Jesse releases the signed asset; the
 * loader then reports weights_missing and the shadow log carries off_reason. */
export const SEARCH_ASSIST_PIN: WeightsPin | null = null;

export interface ExpectedEmbed {
  model?: string;
  dims?: number;
  preprocess?: string;
  prefix?: string;
}

export interface LoadOptions {
  dir?: string;
  pin?: WeightsPin | null;
  /** What the Stack embed role reports right now. `preprocess` defaults to
   * EMBED_PREPROCESS and `prefix` to "" (Home embeds raw text). */
  expected?: ExpectedEmbed;
  download?: (url: string, dest: string, opts: DownloadOptions) => Promise<void>;
}

export type LoadedWeights = SearchAssistManifest;
export type WeightsResult = LoadedWeights | { missing: WeightsReason };

const COPY: Record<WeightsReason, { title: string; detail: string }> = {
  weights_missing: {
    title: "Search assist is off: its weights file is not installed",
    detail: "The small file that helps the chat decide when to search the web could not be downloaded, so chats run as usual without it. Check that this computer can reach the internet, then restart MaiPai Home to try again.",
  },
  weights_checksum: {
    title: "Search assist is off: its weights file did not check out",
    detail: "The weights file is damaged or is not the version this release expects, so chats run as usual without it. Restart MaiPai Home to download it again; if this stays, update MaiPai Home from the Updates page.",
  },
  embed_mismatch: {
    title: "Search assist is off: it was built for a different embedding model",
    detail: "The weights were trained on a different embedding model or setting than the one your Stack runs, so chats run as usual without it. Update MaiPai Home from the Updates page to get matching weights.",
  },
};

async function fail(reason: WeightsReason, raise: boolean): Promise<{ missing: WeightsReason }> {
  if (raise) {
    try {
      await raiseIssue({ source: ISSUE_SOURCE, key: reason, severity: "warning", ...COPY[reason] });
    } catch {
      // Repairs is best effort; the turn must still run without the assist.
    }
  }
  return { missing: reason };
}

function clearRows(): void {
  try {
    for (const key of WeightsReason.options) resolveIssue(ISSUE_SOURCE, key);
  } catch {
    // best effort
  }
}

function identityMatches(m: SearchAssistManifest, expected: ExpectedEmbed): boolean {
  const want = { preprocess: EMBED_PREPROCESS, prefix: "", ...expected };
  if (m.embed.preprocess !== want.preprocess) return false;
  if (m.embed.prefix !== want.prefix) return false;
  if (want.model !== undefined && m.embed.model !== want.model) return false;
  if (want.dims !== undefined && m.embed.dims !== want.dims) return false;
  return true;
}

/** Never throws. A good load resolves every Repairs row this loader owns. */
export async function loadSearchAssistWeights(opts: LoadOptions = {}): Promise<WeightsResult> {
  try {
    const pin = opts.pin === undefined ? SEARCH_ASSIST_PIN : opts.pin;
    // No pin means nothing exists to download or repair: report it, but do
    // not raise a Repairs row nobody can act on.
    if (pin === null) return { missing: "weights_missing" };
    const path = join(opts.dir ?? join(modelsDir, "search-assist"), pin.file);
    if (!existsSync(path)) {
      try {
        await (opts.download ?? downloadUrl)(pin.url, path, { expectedSha256: pin.sha256 });
      } catch {
        return await fail("weights_missing", true);
      }
      if (!existsSync(path)) return await fail("weights_missing", true);
    }
    const bytes = readFileSync(path);
    // A damaged file is removed so the next load downloads it again (the
    // downloader skips a destination that already exists).
    const discard = () => rmSync(path, { force: true });
    if (createHash("sha256").update(bytes).digest("hex") !== pin.sha256) {
      discard();
      return await fail("weights_checksum", true);
    }
    let manifest: SearchAssistManifest;
    try {
      manifest = parseSearchAssistManifest(JSON.parse(bytes.toString("utf8")));
    } catch {
      discard();
      return await fail("weights_checksum", true);
    }
    if (!identityMatches(manifest, opts.expected ?? {})) return await fail("embed_mismatch", true);
    clearRows();
    return manifest;
  } catch {
    return await fail("weights_missing", true);
  }
}
