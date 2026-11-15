#!/usr/bin/env bun
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ScanResult, ScanCounts, ChangedItem, CliClearReport } from "@/lib/adultLockCleanup";

export type { ScanResult, ScanCounts, ChangedItem, CliClearReport as ClearReport };
export async function scanAutoLocks(): Promise<ScanResult> { return (await import("@/lib/adultLockCleanup")).scanAutoLocks(); }
export async function applyClearAutoLocks(scan: ScanResult, options: { outDir: string; dbFile?: string }) { return (await import("@/lib/adultLockCleanup")).applyClearAutoLocks(scan, options); }
export async function revertClearAutoLocks(path: string) { return (await import("@/lib/adultLockCleanup")).revertClearAutoLocks(path); }

interface Args { db: string | null; apply: boolean; ids: boolean; outDir: string; revert: string | null }
function parseArgs(argv: string[]): Args {
  const args: Args = { db: null, apply: false, ids: false, outDir: "clear-auto-locks-reports", revert: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--db") args.db = argv[++i] ?? null;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--ids") args.ids = true;
    else if (arg === "--out") args.outDir = argv[++i] ?? "";
    else if (arg === "--revert") args.revert = argv[++i] ?? null;
    else if (arg === "--help" || arg === "-h") { usage(); process.exit(0); }
    else { console.error("invalid argument"); usage(); process.exit(2); }
  }
  return args;
}
function usage(): void { console.error("usage: clearAutoLocks.ts --db <path> [--apply] [--ids] [--out <dir>] or --revert <report>"); }
function isMainModule(): boolean { try { return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } }

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.db) {
    const dbPath = resolve(args.db);
    if (basename(dbPath) !== "hub.db" || !existsSync(dbPath)) { console.error("invalid database file"); process.exit(2); }
    if (!process.env.MAIPAI_DATA_DIR) process.env.MAIPAI_DATA_DIR = dirname(dbPath);
  } else if (!args.revert && !process.env.MAIPAI_DATA_DIR) { usage(); process.exit(2); }
  if (args.revert) {
    const result = await revertClearAutoLocks(resolve(args.revert));
    console.log(JSON.stringify({ restored: result.restored, backup: result.backup ? 1 : 0 }));
    return;
  }
  const scan = await scanAutoLocks();
  console.log(JSON.stringify({ candidates: scan.candidates.length, left_alone: scan.counts, ...(args.ids ? { ids: scan.candidates.map((item) => item.id) } : {}) }));
  if (!args.apply) return;
  const result = await applyClearAutoLocks(scan, { outDir: resolve(args.outDir) });
  console.log(JSON.stringify({ changed: result.changed, backup: result.backup ? 1 : 0 }));
}

if (isMainModule()) main().catch(() => { console.error("cleanup failed"); process.exit(1); });
