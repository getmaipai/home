// VIDEO-CREATE-02 (U3): a package's own picture and loop files. `GET /api/plugins/:id/assets/<path>` serves a file from the package folder's
// `assets/` directory (backend/packages/<id>/assets, or the store-installed copy). Only a few media types are served, the name is resolved inside
// the folder with symbolic links followed (nothing outside it is reachable, whatever the request says), and the access rule is the package's
// pages' (apps.ts `appAssetAllowed`). The URL is not versioned, so the cache is short and revalidated; the ETag is a hash of the bytes (304 when unchanged).
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { resolvePackageDir } from "@/lib/packageResolve";
import { parseRange } from "@/lib/media/serve";

export const ASSET_TYPES: Readonly<Record<string, string>> = { mp4: "video/mp4", webp: "image/webp", png: "image/png", jpg: "image/jpeg" };
/** No asset is bigger than this: the loops are tens of kilobytes, and the Video package keeps each under 300 KB. */
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;

export interface PackageAsset { path: string; size: number; mediaType: string; etag: string }

const hashes = new Map<string, { stamp: string; etag: string }>();

/** The clean relative path of a requested asset, or null for anything that is not a plain name under the folder. */
export function cleanAssetPath(raw: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  if (!decoded || decoded.length > 200 || decoded.includes("\0") || decoded.includes("\\")) return null;
  const parts = decoded.split("/");
  if (parts.some((part) => part === "" || part.startsWith("."))) return null;
  return parts.join("/");
}

/** The file for `rel` in `packageId`'s assets folder, or null when the name is unclean, the type is not served, or the file is missing or outside the folder. */
export function packageAssetFile(packageId: string, rel: string): PackageAsset | null {
  if (!/^[a-z][a-z0-9_-]*$/.test(packageId)) return null;
  const clean = cleanAssetPath(rel);
  if (!clean) return null;
  const mediaType = ASSET_TYPES[clean.slice(clean.lastIndexOf(".") + 1).toLowerCase()];
  if (!mediaType || !clean.includes(".")) return null;
  try {
    const root = realpathSync(join(resolvePackageDir(packageId), "assets"));
    const candidate = resolve(root, clean);
    if (!candidate.startsWith(root + sep)) return null;
    const real = realpathSync(candidate);
    if (!real.startsWith(root + sep)) return null;
    const info = statSync(real);
    if (!info.isFile() || info.size === 0 || info.size > MAX_ASSET_BYTES) return null;
    const stamp = `${info.size}:${info.mtimeMs}`;
    let held = hashes.get(real);
    if (!held || held.stamp !== stamp) {
      held = { stamp, etag: `"${createHash("sha256").update(new Uint8Array(readFileSync(real))).digest("hex").slice(0, 32)}"` };
      hashes.set(real, held);
    }
    return { path: real, size: info.size, mediaType, etag: held.etag };
  } catch {
    return null;
  }
}

/** The response for one asset: the whole file (200), a byte range (206, which a video element needs), or 304 when the caller already has it. */
export function assetResponse(asset: PackageAsset, headers: { range?: string | null; ifNoneMatch?: string | null }): Response {
  const base = { "x-content-type-options": "nosniff", "cache-control": "private, max-age=3600, must-revalidate", etag: asset.etag, "accept-ranges": "bytes" };
  if (headers.ifNoneMatch && headers.ifNoneMatch.split(",").some((tag) => tag.trim() === asset.etag)) return new Response(null, { status: 304, headers: base });
  const file = Bun.file(asset.path);
  const range = parseRange(headers.range, asset.size);
  if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${asset.size}` } });
  if (range === null) return new Response(file.slice(0, asset.size), { status: 200, headers: { ...base, "content-type": asset.mediaType, "content-length": String(asset.size) } });
  return new Response(file.slice(range.start, range.end + 1), { status: 206, headers: { ...base, "content-type": asset.mediaType, "content-range": `bytes ${range.start}-${range.end}/${asset.size}`, "content-length": String(range.end - range.start + 1) } });
}
