import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type InstallStep = "started" | "staged" | "swapped" | "committed";

export interface InstallJournal {
  packageId: string;
  version: string;
  previousVersion: string | null;
  stagingDir: string;
  versionDir: string;
  step: InstallStep;
  startedAt: string;
}

type NewInstallJournal = Omit<InstallJournal, "step" | "startedAt">;

function safePackageId(packageId: string): void {
  if (packageId.includes("/") || packageId.includes("\\") || packageId.includes("..")) {
    throw new Error("Invalid package id");
  }
}

export function journalPath(root: string, packageId: string): string {
  safePackageId(packageId);
  return join(root, `${packageId}.json`);
}

let tempSequence = 0;
function atomicWrite(path: string, value: unknown): void {
  const tempPath = `${path}.${process.pid}.${++tempSequence}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  renameSync(tempPath, path);
}

export function beginInstall(root: string, journal: NewInstallJournal, now: () => string = () => new Date().toISOString()): void {
  const path = journalPath(root, journal.packageId);
  atomicWrite(path, { ...journal, step: "started", startedAt: now() } satisfies InstallJournal);
}

export function markInstallStep(root: string, packageId: string, step: InstallStep): void {
  const path = journalPath(root, packageId);
  if (!existsSync(path)) throw new Error(`Install journal not found: ${packageId}`);
  const journal = parseJournal(readFileSync(path, "utf8"));
  if (!journal || journal.packageId !== packageId) throw new Error(`Invalid install journal: ${packageId}`);
  atomicWrite(path, { ...journal, step });
}

export function finishInstall(root: string, packageId: string): void {
  rmSync(journalPath(root, packageId), { force: true });
}

function parseJournal(raw: string): InstallJournal | null {
  try {
    const value = JSON.parse(raw) as Partial<InstallJournal>;
    if (
      typeof value.packageId !== "string" ||
      typeof value.version !== "string" ||
      !(typeof value.previousVersion === "string" || value.previousVersion === null) ||
      typeof value.stagingDir !== "string" ||
      typeof value.versionDir !== "string" ||
      !["started", "staged", "swapped", "committed"].includes(value.step ?? "") ||
      typeof value.startedAt !== "string"
    ) return null;
    safePackageId(value.packageId);
    return value as InstallJournal;
  } catch {
    return null;
  }
}

export function readOpenJournals(root: string): { journals: InstallJournal[]; corrupt: string[] } {
  const journals: InstallJournal[] = [];
  const corrupt: string[] = [];
  let files: string[];
  try { files = readdirSync(root).filter((name) => name.endsWith(".json")); }
  catch { return { journals, corrupt }; }
  for (const name of files) {
    const path = join(root, name);
    let parsed: InstallJournal | null = null;
    try { parsed = parseJournal(readFileSync(path, "utf8")); } catch { /* report below */ }
    if (!parsed || journalPath(root, parsed.packageId) !== path) corrupt.push(path);
    else journals.push(parsed);
  }
  return { journals, corrupt };
}

export type RecoveryAction = { do: "remove-staging" | "remove-version-dir" | "keep-active" | "flag-repair-needed" | "drop-journal"; path?: string; why: string };

export function decideRecovery(
  journal: InstallJournal,
  state: { activeVersion: string | null; versionDirHasManifest: boolean; stagingExists: boolean },
): RecoveryAction[] {
  if (journal.step === "committed") return [{ do: "drop-journal", why: "install is committed" }];
  const actions: RecoveryAction[] = [];
  if (state.stagingExists) actions.push({ do: "remove-staging", path: journal.stagingDir, why: "remove interrupted staging directory" });
  if (state.activeVersion !== journal.version) {
    actions.push({ do: "remove-version-dir", path: journal.versionDir, why: "remove orphan version directory" });
    actions.push({ do: "keep-active", why: "leave the current active version untouched" });
  } else if (!state.versionDirHasManifest) {
    actions.push({ do: "flag-repair-needed", why: "active version directory has no manifest" });
  } else {
    actions.push({ do: "keep-active", why: "active version directory is intact" });
  }
  actions.push({ do: "drop-journal", why: "recovery decision recorded" });
  return actions;
}

export function recoverInterruptedInstalls(
  root: string,
  deps: { activeVersionOf: (packageId: string) => string | null; dirHasManifest: (dir: string) => boolean; exists: (p: string) => boolean; remove: (p: string) => void },
): { handled: Array<{ packageId: string; actions: string[] }>; repairNeeded: string[]; corrupt: string[] } {
  const { journals, corrupt } = readOpenJournals(root);
  const handled: Array<{ packageId: string; actions: string[] }> = [];
  const repairNeeded: string[] = [];
  for (const journal of journals) {
    const actions = decideRecovery(journal, {
      activeVersion: deps.activeVersionOf(journal.packageId),
      versionDirHasManifest: deps.dirHasManifest(journal.versionDir),
      stagingExists: deps.exists(journal.stagingDir),
    });
    for (const action of actions) {
      if (action.do === "remove-staging" || action.do === "remove-version-dir") {
        if (action.path) deps.remove(action.path);
      } else if (action.do === "flag-repair-needed") repairNeeded.push(journal.packageId);
    }
    rmSync(journalPath(root, journal.packageId), { force: true });
    handled.push({ packageId: journal.packageId, actions: actions.map((action) => action.do) });
  }
  return { handled, repairNeeded, corrupt };
}
