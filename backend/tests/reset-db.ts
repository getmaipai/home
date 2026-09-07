import { tmpdir } from "node:os";
import { db } from "@/db";
import { dataDir } from "@/lib/paths";
import { __resetSettingsCacheForTests } from "@/lib/settings";
import { __resetCommandsCacheForTests } from "@/lib/commands";
import { __resetTurnActivityForTests } from "@/lib/turnActivity";
import { __clearPendingSummaryRefreshesForTests } from "@/lib/turnEngine";
import { __resetPackageCachesForTests } from "@/lib/plugins";
import { __resetSkillCacheForTests } from "@/lib/skills";
import {
  people,
  personCredentials,
  sessions,
  personApiTokens,
  memoryRecords,
  memoryEmbeddings,
  pendingEmbeddings,
  idSequences,
  settingsValues,
  scheduledJobs,
  conversationTurns,
  conversations,
  clonedVoices,
  commands,
  notificationDeliveries,
  issues,
  packageStatus,
  packageInstalls,
  storeIndexState,
  lists,
  hubIdentity,
  hubEndpoints,
  deviceTokens,
  devices,
  passkeyCredentials,
  totpSecrets,
  relationships,
  entities,
  grants,
  approvals,
  routingEmbeddings,
  backupHealth,
  backupTargets,
  receivedBackups,
  nasMounts,
  appUpdateState,
} from "@/db/schema";

// All test files in one `bun test` run share the same imported `@/db`
// module (Bun's module cache is process-wide, not per-file), so every
// test file clears the tables itself rather than trying to isolate
// per-file databases. Order matters: memoryRecords and sessions/
// personCredentials all reference people, so they're deleted first.
//
// idSequences (lib/memoryId.ts's mem/ent/ep counters) is cleared too: a
// code review (2026-09-04) found it wasn't, so the counters kept
// incrementing across every describe block in a `bun test` run despite
// this function's own comment claiming full per-file isolation. No test
// currently asserts a specific id value (only the id *pattern*), so this
// was silent; clearing it now means a future test that does assert a
// specific id (e.g. the first record created is "mem1-...") won't have a
// hidden dependency on what ran before it in the same process.
// Found the hard way (2026-09-06): calling this outside `bun test` (a
// one-off `bun run` verification script, not the test runner) skips
// bunfig.toml's own preload.ts entirely, so MAIPAI_DATA_DIR is never
// pointed at a throwaway directory - `dataDir` (lib/paths.ts) silently
// falls back to the real household's own data/hub.db, and this function
// wiped it in full: every person, session, and setting gone,
// indistinguishable from a factory reset, with a real household's local
// dev instance sent back to first-run setup. This is the one guard
// standing between "a test file's beforeEach" and "delete a real
// household forever" - refuses to run unless the resolved dataDir is
// unmistakably the disposable one tests/preload.ts creates.
function assertDisposableTestDataDir(): void {
  if (!dataDir.startsWith(tmpdir()) || !dataDir.includes("maipai-home-test-")) {
    throw new Error(
      `resetDb() refused to run: dataDir (${dataDir}) doesn't look like a disposable test directory. ` +
        `This almost always means it was invoked outside 'bun test' (e.g. a one-off 'bun run' script), ` +
        `so MAIPAI_DATA_DIR was never set - proceeding would delete a real household's data.`,
    );
  }
}

export function resetDb(): void {
  assertDisposableTestDataDir();
  db.delete(approvals).run();
  db.delete(grants).run();
  db.delete(relationships).run();
  db.delete(entities).run();
  db.delete(receivedBackups).run();
  db.delete(backupHealth).run();
  db.delete(backupTargets).run();
  db.delete(nasMounts).run();
  db.delete(appUpdateState).run();
  db.delete(deviceTokens).run();
  db.delete(devices).run();
  db.delete(passkeyCredentials).run();
  db.delete(totpSecrets).run();
  db.delete(hubEndpoints).run();
  db.delete(hubIdentity).run();
  db.delete(routingEmbeddings).run();
  db.delete(issues).run();
  db.delete(packageInstalls).run();
  db.delete(storeIndexState).run();
  db.delete(lists).run();
  db.delete(packageStatus).run();
  db.delete(notificationDeliveries).run();
  db.delete(commands).run();
  __resetCommandsCacheForTests();
  db.delete(scheduledJobs).run();
  db.delete(clonedVoices).run();
  db.delete(conversationTurns).run();
  db.delete(conversations).run();
  db.delete(memoryEmbeddings).run();
  db.delete(pendingEmbeddings).run();
  db.delete(memoryRecords).run();
  db.delete(settingsValues).run();
  // lib/settings.ts's own resolveStoredValue() cache (added in a latency
  // pass, 2026-09-06): the same "cleared here too" fix idSequences got
  // below, and for the identical reason - a value cached by one test file
  // would otherwise survive this table wipe and leak into the next one,
  // since every test file in one `bun test` run shares the same imported
  // settings.ts module instance.
  __resetSettingsCacheForTests();
  // lib/turnActivity.ts's own "a turn ran recently" flag (also added in
  // that pass): the memory judge's runJudgeBatch() skips its whole batch
  // while this says a turn is active, and it's real wall-clock state, not
  // DB-backed - a turnEngine.test.ts/tier2.test.ts run moments before a
  // memoryJudge.test.ts one in the same process would otherwise cause a
  // real, order-dependent test failure, not just stale data.
  __resetTurnActivityForTests();
  // turnEngine.ts's own debounced post-turn summary refresh (issue #45):
  // a code review found every test file calling runTurn() left one of
  // these timers outstanding at DEFAULT_IDLE_WINDOW_MS (20s) - most
  // finish well before that, so it fires later against whatever the NEXT
  // test's own resetDb() call has already replaced the database with.
  // Harmless today (maybeRefreshConversationSummary()'s own not-found
  // guard), but still real background work racing unrelated tests for no
  // reason - cleared here so every file already calling resetDb() in its
  // own beforeEach gets this for free, matching __resetTurnActivityForTests()
  // just above for the identical reason.
  __clearPendingSummaryRefreshesForTests();
  // lib/plugins.ts's/lib/skills.ts's own mtime-keyed manifest/recipe/skill
  // caches (same pass): no test writes a bundled package's files today,
  // but they're cleared here too on the same "don't rely on that staying
  // true" reasoning as the two resets above (a code review, 2026-09-06,
  // flagged the asymmetry - these two caches were the only ones of the
  // five this pass added that reset-db.ts didn't already clear).
  __resetPackageCachesForTests();
  __resetSkillCacheForTests();
  db.delete(idSequences).run();
  db.delete(sessions).run();
  db.delete(personApiTokens).run();
  db.delete(personCredentials).run();
  db.delete(people).run();
}
