import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { probeExec, probeHardlink, probeLargeFile, probePermissions, probeSymlink, probeWrite } from "@maipai/core/src/probes";
import { diskFacts as readDiskFacts, type DiskFacts } from "@maipai/core/src/diskFacts";
import { readFolderMarker } from "@maipai/core/src/dataLocation";
import { DATA_CLASSES } from "./dataClasses";
import { classDir } from "./paths";
import { aiRequiredBytes, recordedLevel, shippedPlanForLevel } from "./diskPlan";

export type PlacementRow = { class: string; kind: "refusal" | "warning" | "unknown"; id: string; text: string; fix: string };
export interface PlacementOptions {
  current?: Record<string, string>;
  householdFolderId?: string;
  reference?: readonly { sizeBytes?: number; approx_bytes?: number }[];
  models?: readonly string[];
  /** The free space the models folder needs, when the caller knows it from the Stack's own plan. */
  modelsRequiredBytes?: number;
  growthBytesLast30Days?: Record<string, number>;
  runAs?: string;
  facts?: (path: string) => Promise<DiskFacts>;
  probes?: Partial<Record<"write" | "permissions" | "exec" | "largeFile" | "symlink" | "hardlink", (path: string) => Promise<boolean | "unknown">>>;
}

const GB = 1_000_000_000;
const MB = 1_000_000;
const IRREPLACEABLE = ["records", "keys", "people-files", "cloned-voices", "projects", "packages"];

function row(cls: string, check: string, kind: PlacementRow["kind"], text: string, fix: string): PlacementRow {
  return { class: cls, kind, id: `${check}:${cls}`, text, fix };
}

/** The free space the AI's models and engines ask of their disk: the disk plan for the recorded plan level on this computer (their installed
 * size, 20 percent more, and the space an install needs while it runs). The same number the installer, the setup checks and the plan step use. */
export function defaultModelBytes(opts: PlacementOptions = {}): number {
  return opts.modelsRequiredBytes ?? aiRequiredBytes(shippedPlanForLevel(recordedLevel()));
}

export function minimum(id: string, opts: PlacementOptions = {}): number {
  if (id === "records") return 2 * GB;
  if (id === "models") return defaultModelBytes(opts);
  if (id === "reference") return opts.reference?.length ? opts.reference.reduce((n, item) => n + (item.sizeBytes ?? item.approx_bytes ?? 0), 0) : GB;
  if (id === "backups") return Math.max(2 * GB, 5 * databaseBytes());
  return 200 * MB;
}

function databaseBytes(): number {
  try { return statSync(join(classDir("records"), "hub.db")).size; }
  catch { return 0; }
}

function nesting(layout: Record<string, string>): Array<[string, string]> {
  const ids = Object.keys(layout);
  const invalid: Array<[string, string]> = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i]!, b = ids[j]!, pa = resolve(layout[a]!), pb = resolve(layout[b]!);
    const defaultRecordsContainer = (a === "records" && pa === resolve(classDir("records")) && b !== "backups" && b !== "received-backups" && relative(pa, pb) !== ".." && !relative(pa, pb).startsWith(`..${sep}`))
      || (b === "records" && pb === resolve(classDir("records")) && a !== "backups" && a !== "received-backups" && relative(pb, pa) !== ".." && !relative(pb, pa).startsWith(`..${sep}`));
    const nested = pa === pb || pa.startsWith(pb + sep) || pb.startsWith(pa + sep);
    if (nested && !defaultRecordsContainer) invalid.push([a, b]);
  }
  return invalid;
}

function directoryEntries(path: string): string[] {
  try { return readdirSync(path); } catch { return []; }
}

function nearestExistingDirectory(path: string): string {
  let current = path;
  for (;;) {
    try { if (statSync(current).isDirectory()) return current; }
    catch { /* walk toward the mounted volume */ }
    const parent = resolve(current, "..");
    if (parent === current) return current;
    current = parent;
  }
}

function markerStatus(path: string, id: string, householdFolderId?: string): "adopt" | "same" | "foreign" | "retired" | "none" {
  try {
    const marker = readFolderMarker(path);
    if (!marker) return "none";
    if (marker.retired) return "retired";
    return marker.product === "home" && marker.class === id && (!householdFolderId || marker.householdFolderId === householdFolderId) ? "same" : "foreign";
  } catch { return "foreign"; }
}

function distinctDevice(a: DiskFacts, b: DiskFacts): boolean {
  if (a.identity.id && b.identity.id && a.identity.id !== "unknown" && b.identity.id !== "unknown" && a.identity.id !== b.identity.id) return true;
  if (a.physicalDisk !== "unknown" && b.physicalDisk !== "unknown" && a.physicalDisk !== b.physicalDisk) return true;
  return (a.kind === "network") !== (b.kind === "network");
}

export async function checkPlacement(layout: Record<string, string>, opts: PlacementOptions = {}): Promise<PlacementRow[]> {
  const factsFn = opts.facts ?? readDiskFacts;
  const rows: PlacementRow[] = [];
  const factByClass = new Map<string, DiskFacts>();
  let householdFolderId = opts.householdFolderId;
  if (!householdFolderId && opts.current?.records) {
    try { householdFolderId = readFolderMarker(opts.current.records)?.householdFolderId; } catch { /* a bad source marker is handled by the class row */ }
  }
  if (!householdFolderId && layout.records) {
    try { householdFolderId = readFolderMarker(layout.records)?.householdFolderId; } catch { /* malformed markers are refused below */ }
  }

  for (const [a, b] of nesting(layout)) {
    rows.push(row(a, "nesting", "refusal", `The ${a} and ${b} folders overlap. Choose separate folders, with only the default folders inside records.`, "Choose folders that do not overlap."));
  }

  for (const [id, path] of Object.entries(layout)) {
    const cls = DATA_CLASSES.find((candidate) => candidate.id === id);
    if (!cls) continue;
    const abs = isAbsolute(path) ? path : resolve(path);
    let facts: DiskFacts | null = null;
    try { facts = await factsFn(abs); factByClass.set(id, facts); }
    catch { rows.push(row(id, "disk-facts", "unknown", "MaiPai can't tell which disk or file system this folder uses.", "Check that the drive is connected, then try again.")); }
    const existing = existsSync(abs);
    const marker = existing ? markerStatus(abs, id, householdFolderId) : "none";
    const entries = existing ? directoryEntries(abs).filter((name) => name !== "maipai-folder.json") : [];
    if (marker === "foreign" || marker === "retired" || (entries.length > 0 && marker !== "same")) {
      rows.push(row(id, "folder", "refusal", `The ${cls.title.toLowerCase()} folder already holds files that do not belong to this household. Choose an empty folder or the folder for this household.`, "Choose an empty folder or this household's marked folder."));
    }
    if (!facts) continue;
    const mountOnlyPath = process.platform === "win32"
      ? /^[A-Za-z]:[\\/]/.test(abs) && /[\\/](?:Volumes|mnt|media|run[\\/]media)[\\/]/i.test(abs)
      : /^(?:\/Volumes\/|\/mnt\/|\/media\/|\/run\/media\/)/.test(abs);
    if (mountOnlyPath && facts.identity.mountPoint === (process.platform === "win32" ? "C:\\" : "/")) {
      rows.push(row(id, "mount", "refusal", `The drive for ${id} is not mounted. Connect the drive, then try again.`, "Connect the drive or choose another folder."));
    }
    if (facts.filesystem === "unknown") rows.push(row(id, "filesystem", "unknown", `MaiPai can't tell whether this file system is safe for ${cls.title.toLowerCase()}.`, "Choose a local file system with known capabilities."));
    const needs = cls.needs;
    const probePath = existing && statSync(abs).isDirectory() ? abs : nearestExistingDirectory(abs);
    const write = await (opts.probes?.write?.(probePath) ?? probeWrite(probePath, { runAs: opts.runAs }).then((r) => r.ok));
    const perms = needs.includes("private") ? (await (opts.probes?.permissions?.(probePath) ?? probePermissions(probePath, { runAs: opts.runAs }).then((r) => r.ok))) : null;
    const exec = needs.includes("exec") ? (await (opts.probes?.exec?.(probePath) ?? probeExec(probePath, { runAs: opts.runAs }).then((r) => r.ok))) : null;
    const large = needs.includes("large-files") ? (await (opts.probes?.largeFile?.(probePath) ?? probeLargeFile(probePath, { runAs: opts.runAs }).then((r) => r.ok))) : null;
    const symlink = needs.includes("symlinks") ? (await (opts.probes?.symlink?.(probePath) ?? probeSymlink(probePath, { runAs: opts.runAs }).then((r) => r.ok))) : null;
    const hardlink = needs.includes("hardlinks") ? (await (opts.probes?.hardlink?.(probePath) ?? probeHardlink(probePath, { runAs: opts.runAs }).then((r) => r.ok))) : null;
    const noFsync = needs.includes("sqlite") && facts.filesystem !== "unknown" && ["exfat", "fat", "fat32", "smbfs", "nfs", "afpfs"].includes(facts.filesystem);
    const ignoresPermissions = needs.includes("private") && facts.filesystem !== "unknown" && ["exfat", "fat", "fat32"].includes(facts.filesystem);
    if (noFsync || ignoresPermissions || (perms === false && needs.includes("private"))) rows.push(row(id, noFsync ? "sqlite-filesystem" : "permissions-filesystem", "refusal", noFsync
      ? `The drive for ${id} uses ${facts.filesystem}, which cannot safely store Home records. Choose a drive formatted as APFS, HFS+, ext4, XFS, btrfs or NTFS.`
      : `The drive for ${id} does not keep files private. Choose a drive formatted as APFS, HFS+, ext4, XFS, btrfs or NTFS.`, "Choose a file system that supports reliable saves and private files."));
    if (perms === "unknown" && needs.includes("private")) rows.push(row(id, "permissions", "unknown", `MaiPai can't tell whether this file system keeps ${cls.title.toLowerCase()} private.`, "Run the check as the service account or choose a file system with owner-only permissions."));
    if ((exec === false) || (needs.includes("exec") && facts.noexec === true)) rows.push(row(id, "exec", "refusal", `The drive for ${id} does not allow programs to run. Choose a drive without the noexec mount option.`, "Choose a drive without the noexec mount option."));
    if (large === false) rows.push(row(id, "large-file", "refusal", `This file system cannot hold a file as large as ${cls.title.toLowerCase()} needs. Choose a file system that supports large files.`, "Choose a file system that supports files over 4 GB."));
    else if (large === "unknown") rows.push(row(id, "large-file", "unknown", `MaiPai can't tell whether this file system can hold the largest ${cls.title.toLowerCase()} file.`, "Free at least 4.5 GB on the drive and try again."));
    if (symlink === false || hardlink === false) rows.push(row(id, "links", "refusal", `This file system does not support the links that ${cls.title.toLowerCase()} needs. Choose a file system that supports links.`, "Choose a file system that supports symbolic and hard links."));
    if (write === "unknown") rows.push(row(id, "write", "unknown", `MaiPai can't tell whether its service account can write to the ${cls.title.toLowerCase()} folder.`, "Run the check as the service account."));
    else if (write === false) rows.push(row(id, "write", "refusal", `The service account cannot write to ${id}. Choose a folder it can write to.`, "Give the service account write access to the folder."));
    if (facts.freeBytes === "unknown") rows.push(row(id, "space", "unknown", `MaiPai can't tell how much free space is available for ${cls.title.toLowerCase()}.`, "Check the drive's free space and try again."));
    else if (facts.freeBytes < minimum(id, opts)) rows.push(row(id, "space", "refusal", `There is not enough free space for ${cls.title.toLowerCase()}.`, "Choose a drive with more free space."));
    if (facts.kind === "unknown" || facts.medium === "unknown" || facts.physicalDisk === "unknown") rows.push(row(id, "disk-facts-detail", "unknown", "MaiPai can't tell which disks this uses.", "Check the drive details in the operating system."));
    if (id === "keys" && facts.kind === "external") rows.push(row(id, "keys-removable", "warning", "Your keys are on a drive that can be unplugged or carried off. MaiPai will not start without them, and anyone holding the drive and your records together can read your household.", "Keep the keys drive connected and secure."));
    if (facts.kind === "network" && IRREPLACEABLE.includes(id) && !["records", "keys", "packages", "stack-state"].includes(id)) rows.push(row(id, "network-irreplaceable", "warning", "These files will live on your network storage. MaiPai can only reach them while it is on and shared, and your NAS's own sign-in decides who else can read them.", "Keep the NAS available and review its access settings."));
    if ((id === "people-files" || id === "cloned-voices") && (facts.ownershipIgnored === true || ["exfat", "fat", "fat32"].includes(facts.filesystem))) rows.push(row(id, "permissions-warning", "warning", "Any account on this computer can read these files.", "Turn off Ignore ownership in Finder, Get Info, Sharing & Permissions."));
    if (cls.durability === "rebuildable" && (facts.kind === "network" || facts.medium === "spinning")) rows.push(row(id, "slow-disk", "warning", "Models will load more slowly from here.", "Choose a faster local solid-state drive for faster loading."));
    if (facts.freeBytes !== "unknown" && facts.totalBytes !== "unknown" && facts.freeBytes < Math.max(5 * GB, facts.totalBytes * 0.1)) rows.push(row(id, "low-space", "warning", "This drive has less than 10 percent or 5 GB free, whichever is larger.", "Free space on this drive."));
    if (facts.freeBytes !== "unknown" && (opts.growthBytesLast30Days?.[id] ?? 0) > 0 && facts.freeBytes <= opts.growthBytesLast30Days![id]!) rows.push(row(id, "growth", "warning", "At this rate, this drive could fill within 30 days.", "Choose a larger drive or free space."));
    if (facts.ownershipIgnored === "unknown" && process.platform === "darwin" && facts.kind === "external" && cls.sensitive !== "none") rows.push(row(id, "ownership", "unknown", `MaiPai can't tell whether ownership is ignored on this external drive.`, "Check Finder, Get Info, Sharing & Permissions."));
  }

  const backup = factByClass.get("backups");
  if (backup) {
    const sameClass = IRREPLACEABLE.find((id) => factByClass.has(id) && !distinctDevice(backup, factByClass.get(id)!));
    if (sameClass) rows.push(row("backups", "backup-same-disk", "warning", "Your backups are on the same disk as your household. If that disk fails, you lose both.", "Choose a different physical disk for backups."));
  }
  if (factByClass.has("records") && factByClass.has("keys") && distinctDevice(factByClass.get("records")!, factByClass.get("keys")!)) rows.push(row("keys", "keys-records-different", "warning", "MaiPai needs both of these disks connected to start.", "Keep both disks connected."));
  return rows;
}
