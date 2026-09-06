#!/usr/bin/env bun
// Step 8: "the restore drill: a script that restores the latest backup
// into a temporary data directory and boots it headless with a sign-in;
// the release skill runs it" (2.5). This is that script - a real proof,
// on every release, that a backup this build produced can actually come
// back: decrypt, open under this build's schema-version check, boot the
// real server against it, and confirm the real sign-in surface
// (GET /api/auth/profiles, the household's own picker, public by design)
// answers with real people in it.
//
// Deliberately does not attempt a full PIN/password sign-in ceremony:
// that needs a real secret this script has no business knowing (or
// storing to know), and a release running unattended cannot type one in
// anyway. Confirming the picker itself renders the restored household is
// the honest stopping point - it proves every layer below the actual
// secret check (decrypt, schema, boot, roster) really works.
//
// Lives in backend/ (not the top-level scripts/) because it needs this
// package's own modules (backupCrypto, paths) directly rather than
// shelling out to them - scripts/restore-drill.sh is the thin top-level
// wrapper the release skill (a separate, org-level repo) actually calls,
// matching scripts/check.sh's own "cd here, then bun run" convention.
import { existsSync, readdirSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { decryptFile } from "../src/lib/backupCrypto";
import { backupDir as realBackupDir } from "../src/lib/paths";

const DRILL_PORT = Number(process.env.RESTORE_DRILL_PORT ?? 18787);
const BOOT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;

function latestBackupFilename(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".db.enc"))
    .map((f) => ({ f, mtime: Bun.file(join(dir, f)).lastModified }));
  if (files.length === 0) return null;
  files.sort((a, b) => b.mtime - a.mtime);
  return files[0]!.f;
}

async function waitForServer(port: number): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/api/auth/profiles`);
      if (res.ok) return;
    } catch {
      // Not up yet - keep polling.
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`hub did not answer GET /api/auth/profiles within ${BOOT_TIMEOUT_MS}ms`);
}

async function main(): Promise<void> {
  const backupSourceDir = process.env.MAIPAI_BACKUP_DIR ?? realBackupDir;
  const filename = latestBackupFilename(backupSourceDir);
  if (!filename) {
    console.error(`[restore-drill] no backups found in ${backupSourceDir} - nothing to drill`);
    process.exit(1);
  }
  console.log(`[restore-drill] using ${filename}`);

  const drillRoot = mkdtempSync(join(tmpdir(), "maipai-restore-drill-"));
  const drillDataDir = join(drillRoot, "data");
  const drillBackupDir = join(drillRoot, "backups"); // never read by this drill, but paths.ts requires it exist

  let child: ReturnType<typeof spawn> | undefined;
  try {
    // Decrypted straight to a throwaway hub.db, bypassing the live
    // hub's staging/pending-restore dance entirely: that mechanism
    // exists to protect an ALREADY-RUNNING process's open handle
    // (restoreStaging.ts's own header), which does not apply here -
    // nothing has this directory open yet. Runs in THIS process, not
    // the spawned child below, so it reads the real household's backup
    // key from the real keystore (this process's own, unmodified
    // MAIPAI_DATA_DIR) - the same key the backup was actually encrypted
    // with, not some throwaway drill-only key.
    mkdirSync(drillDataDir, { recursive: true });
    mkdirSync(drillBackupDir, { recursive: true });
    decryptFile(join(backupSourceDir, filename), join(drillDataDir, "hub.db"));
    console.log(`[restore-drill] decrypted into ${drillDataDir}/hub.db`);

    child = spawn("bun", ["run", "src/index.ts"], {
      cwd: join(import.meta.dir, ".."),
      env: {
        ...process.env,
        MAIPAI_DATA_DIR: drillDataDir,
        MAIPAI_BACKUP_DIR: drillBackupDir,
        PORT: String(DRILL_PORT),
        NODE_ENV: "production",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let bootLog = "";
    child.stdout?.on("data", (d) => (bootLog += d.toString()));
    child.stderr?.on("data", (d) => (bootLog += d.toString()));

    await waitForServer(DRILL_PORT);

    const res = await fetch(`http://localhost:${DRILL_PORT}/api/auth/profiles`);
    if (!res.ok) throw new Error(`GET /api/auth/profiles returned ${res.status}`);
    const profiles = (await res.json()) as unknown[];
    if (profiles.length === 0) {
      throw new Error("the restored hub booted but its own sign-in picker shows no one - the restore is not real");
    }

    console.log(`[restore-drill] PASS - the restored hub booted and its sign-in picker shows ${profiles.length} profile(s)`);
  } catch (err) {
    console.error(`[restore-drill] FAIL: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    if (child && !child.killed) child.kill();
    rmSync(drillRoot, { recursive: true, force: true });
  }
}

await main();
