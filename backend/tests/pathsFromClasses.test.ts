import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";

// DATA-LOCATION-00c: lib/paths.ts derives every path it exports from the
// class list (lib/dataClasses.ts) and each one keeps today's value. The
// expected values below are written from literals, never from the list.
// Each case runs in a child process because paths.ts reads its env at
// import time.

const pathsFile = join(import.meta.dir, "../src/lib/paths.ts");
const classesFile = join(import.meta.dir, "../src/lib/dataClasses.ts");
const EXPECTED_IDS = [
  "records",
  "keys",
  "people-files",
  "cloned-voices",
  "projects",
  "packages",
  "models",
  "engines",
  "sidecars",
  "reference",
  "wakeword-models",
  "stt-models",
  "vision-models",
  "logs",
  "cache",
  "favicons",
  "runtime",
  "labels",
  "backups",
  "received-backups",
];

// What paths.ts exported before this item, computed here from literals
// and never from the class list, so the two can be compared.
function todaysPaths(
  data: string,
  backupEnv: string | undefined,
): Record<string, unknown> {
  const backup = backupEnv ?? resolve(data, "..", "backups");
  return {
    dataDir: data,
    backupDir: backup,
    receivedBackupsDir: resolve(backup, "..", "received-backups"),
    modelsDir: resolve(data, "models"),
    enginesDir: resolve(data, "engines"),
    kiwixToolsDir: resolve(data, "sidecars", "kiwix-tools"),
    defaultReferenceLibraryDir: resolve(data, "reference"),
    logsDir: resolve(data, "logs"),
    wakewordDir: resolve(data, "voice", "wakewords"),
    visionDir: resolve(data, "vision", "models"),
    sttDir: resolve(data, "voice", "stt"),
    projectsDir: resolve(data, "projects"),
    cacheDir: resolve(data, "cache"),
    clonedVoicesDir: resolve(data, "voice", "cloned"),
    attachmentsDir: resolve(data, "people"),
    tier1: resolve(data, "packages", "some-pkg", "state"),
    version: resolve(data, "packages", "some-pkg", "versions", "1.2.3"),
    staging: resolve(data, "packages", "some-pkg", ".staging"),
  };
}

async function runInChild(
  script: string,
  env: Record<string, string | undefined>,
): Promise<unknown> {
  const child = Bun.spawn([process.execPath, "-e", script], {
    env: {
      ...process.env,
      MAIPAI_DATA_DIR: undefined,
      MAIPAI_BACKUP_DIR: undefined,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(child.stdout).text();
  await child.exited;
  return JSON.parse(out.trim());
}

const exportsScript = `
  const p = await import(${JSON.stringify(pathsFile)});
  console.log(JSON.stringify({
    dataDir: p.dataDir, backupDir: p.backupDir, receivedBackupsDir: p.receivedBackupsDir,
    modelsDir: p.modelsDir, enginesDir: p.enginesDir, kiwixToolsDir: p.kiwixToolsDir,
    defaultReferenceLibraryDir: p.defaultReferenceLibraryDir, logsDir: p.logsDir,
    wakewordDir: p.wakewordDir, visionDir: p.visionDir, sttDir: p.sttDir,
    projectsDir: p.projectsDir, cacheDir: p.cacheDir, clonedVoicesDir: p.clonedVoicesDir,
    attachmentsDir: p.attachmentsDir,
    tier1: p.tier1PackageDataDir("some-pkg"),
    version: p.installedPackageVersionDir("some-pkg", "1.2.3"),
    staging: p.installStagingDir("some-pkg"),
  }));`;

describe("paths.ts still exports every path with today's value", () => {
  const data = "/tmp/maipai-paths-regression/data";

  test("with MAIPAI_DATA_DIR set (and no backup override)", async () => {
    expect(await runInChild(exportsScript, { MAIPAI_DATA_DIR: data })).toEqual(
      todaysPaths(data, undefined),
    );
  });

  test("with MAIPAI_DATA_DIR and MAIPAI_BACKUP_DIR both set", async () => {
    const backup = "/tmp/maipai-paths-regression/elsewhere/bk";
    expect(
      await runInChild(exportsScript, {
        MAIPAI_DATA_DIR: data,
        MAIPAI_BACKUP_DIR: backup,
      }),
    ).toEqual(todaysPaths(data, backup));
  });

  test("with neither set, the default is <repo>/data", async () => {
    const repoData = resolve(import.meta.dir, "../../data");
    expect(await runInChild(exportsScript, {})).toEqual(
      todaysPaths(repoData, undefined),
    );
  });
});

describe("classDir resolves each class's default folder to today's real path", () => {
  const data = "/tmp/maipai-paths-regression/data";
  // Written from the code's own literals (paths.ts constants and the
  // modules that join(dataDir, ...) by hand), never from the class list.
  const today: Record<string, string> = {
    records: data,
    keys: join(data, "keys"),
    "people-files": join(data, "people"),
    "cloned-voices": join(data, "voice", "cloned"),
    projects: join(data, "projects"),
    packages: join(data, "packages"),
    models: join(data, "models"),
    engines: join(data, "engines"),
    sidecars: join(data, "sidecars"),
    reference: join(data, "reference"),
    "wakeword-models": join(data, "voice", "wakewords"),
    "stt-models": join(data, "voice", "stt"),
    "vision-models": join(data, "vision", "models"),
    logs: join(data, "logs"),
    cache: join(data, "cache"),
    favicons: join(data, "favicons"),
    runtime: join(data, "local-app"),
    labels: join(data, "labels"),
    backups: resolve(data, "..", "backups"),
    "received-backups": resolve(data, "..", "received-backups"),
  };

  const classDirScript = `
    const p = await import(${JSON.stringify(pathsFile)});
    const c = await import(${JSON.stringify(classesFile)});
    console.log(JSON.stringify(Object.fromEntries(c.DATA_CLASSES.map((k) => [k.id, p.classDir(k.id)]))));`;

  test("every class has an expected folder, and no expected folder is unclaimed", () => {
    expect(Object.keys(today).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  test("classDir with no override equals today's folder for every class", async () => {
    expect(await runInChild(classDirScript, { MAIPAI_DATA_DIR: data })).toEqual(
      today,
    );
  });

  test("the backup classes follow MAIPAI_BACKUP_DIR as today: backups is it, received-backups its sibling", async () => {
    const backup = "/tmp/maipai-paths-regression/elsewhere/bk";
    const got = (await runInChild(classDirScript, {
      MAIPAI_DATA_DIR: data,
      MAIPAI_BACKUP_DIR: backup,
    })) as Record<string, string>;
    expect(got.backups).toBe(backup);
    expect(got["received-backups"]).toBe(
      resolve(backup, "..", "received-backups"),
    );
    expect(got.records).toBe(data);
  });
});
