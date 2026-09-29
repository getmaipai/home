import { dataDir, dataDirIsExplicit, repoRoot } from "@/lib/paths";
import {
  acquireInstanceLock,
  assertDataDirPlacement,
  assertNoLegacyDataDirLock,
  DataDirPlacementError,
  HubAlreadyRunningError,
  hubLockPath,
  OPT_OUT_ENV,
  type InstanceLock,
} from "@/lib/instanceLock";

// SINGLE-INSTANCE-01 (#194) and -02 (#196). A side-effect module: index.ts
// imports it FIRST, so ES module evaluation order runs it before "@/app"
// and every other import that opens the database. A refused boot exits
// here, non-zero, before anything touches hub.db.
try {
  assertDataDirPlacement(dataDir, { explicit: dataDirIsExplicit, repoRoot });
} catch (err) {
  if (!(err instanceof DataDirPlacementError)) throw err;
  console.error(`[fatal] ${err.message}`);
  process.exit(1);
}

const noLock: InstanceLock = {
  path: "",
  info: { pid: process.pid, startedAt: Date.now(), port: 0, dataDir, cwd: process.cwd() },
  setPort() {},
  release() {},
};

export const instanceLock: InstanceLock = (() => {
  // The one opt-out: tests and the gate's throwaway hubs (own data
  // directory, own port). Production boot never sets it.
  if (process.env[OPT_OUT_ENV] === "1") {
    // Loud on purpose: if this leaks into a real hub's environment, the
    // one-hub rule is off and the log must say so.
    console.error(`[warn] ${OPT_OUT_ENV}=1: the one-hub-per-machine lock is disabled (test-only).`);
    return noLock;
  }
  try {
    assertNoLegacyDataDirLock(dataDir);
    const configuredPort = Number(process.env.PORT ?? 8787);
    return acquireInstanceLock(hubLockPath(), { port: configuredPort > 0 ? configuredPort : 8787, dataDir });
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
