import { dataDir, dataDirIsExplicit, repoRoot } from "@/lib/paths";
import { acquireInstanceLock, assertDataDirPlacement, DataDirPlacementError, HubAlreadyRunningError } from "@/lib/instanceLock";

// SINGLE-INSTANCE-01 (#194). A side-effect module: index.ts imports it
// FIRST, so ES module evaluation order runs it before "@/app" and every
// other import that opens the database. A refused boot exits here,
// non-zero, before anything touches hub.db.
try {
  assertDataDirPlacement(dataDir, { explicit: dataDirIsExplicit, repoRoot });
} catch (err) {
  if (!(err instanceof DataDirPlacementError)) throw err;
  console.error(`[fatal] ${err.message}`);
  process.exit(1);
}

export const instanceLock = (() => {
  try {
    const configuredPort = Number(process.env.PORT ?? 8787);
    return acquireInstanceLock(dataDir, configuredPort > 0 ? configuredPort : 8787);
  } catch (err) {
    if (!(err instanceof HubAlreadyRunningError)) throw err;
    console.error(`[fatal] ${err.message}`);
    process.exit(1);
  }
})();

// Clean exit, SIGINT and SIGTERM all release. index.ts's own signal
// handlers end in process.exit(0), which fires this "exit" listener; a
// hard kill (SIGKILL, power loss) leaves a stale lock that the next boot
// reclaims by checking the pid.
process.on("exit", () => instanceLock.release());
