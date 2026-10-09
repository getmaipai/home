import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type LockData = {
  packages?: Record<string, unknown[]>;
  workspaces?: Record<string, { name?: string }>;
};

function packageIdentity(value: unknown): string | null {
  if (typeof value !== "string" || value.startsWith("file:")) return null;
  const separator = value.lastIndexOf("@");
  if (separator <= 0 || separator === value.length - 1) return null;
  return value;
}

function packageName(identity: string): string {
  return identity.slice(0, identity.lastIndexOf("@"));
}

function readPackages(directory: string, visit: (file: string) => void): void {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(directory, entry.name);
    if (entry.name === "node_modules") {
      let children;
      try { children = readdirSync(path, { withFileTypes: true }); } catch { continue; }
      for (const child of children) {
        if (child.name === ".bin" || child.name === ".cache" || child.name === ".bun") continue;
        const childPath = join(path, child.name);
        if (child.isDirectory()) {
          if (child.name.startsWith("@")) {
            try {
              for (const scoped of readdirSync(childPath, { withFileTypes: true })) {
                if (scoped.isDirectory() || scoped.isSymbolicLink()) visit(join(childPath, scoped.name, "package.json"));
              }
            } catch {}
          } else visit(join(childPath, "package.json"));
        } else if (child.isSymbolicLink()) visit(join(childPath, "package.json"));
      }
    }
    readPackages(path, visit);
  }
}

export function installedLockMismatches(root: string, lockText: string): string[] {
  let lock: LockData;
  try {
    lock = Bun.JSONC.parse(lockText) as LockData;
  } catch {
    return ["bun.lock could not be parsed"];
  }
  const localPackages = new Set<string>();
  const locked = new Set<string>();
  for (const workspace of Object.values(lock.workspaces ?? {})) {
    if (workspace.name) localPackages.add(workspace.name);
  }
  for (const [key, record] of Object.entries(lock.packages ?? {})) {
    const resolved = record[0];
    if (typeof resolved === "string" && (resolved.includes("file:") || resolved.includes("workspace:"))) {
      const identity = resolved.split("@").slice(0, -1).join("@");
      const name = identity || key.split("/").slice(-1)[0] || key;
      localPackages.add(name);
      continue;
    }
    const identity = packageIdentity(record[0]);
    if (identity) locked.add(identity);
  }
  if (locked.size === 0) return ["bun.lock has no resolved packages"];

  const installed: string[] = [];
  const inspect = (file: string) => {
    try {
      const pkg = JSON.parse(readFileSync(file, "utf8")) as { name?: unknown; version?: unknown };
      if (typeof pkg.name === "string" && typeof pkg.version === "string") installed.push(`${pkg.name}@${pkg.version}`);
    } catch {}
  };
  readPackages(join(root, "node_modules", ".bun"), inspect);
  for (const workspace of ["", "backend", "frontend"]) {
    readPackages(join(root, workspace), inspect);
  }

  const mismatches = [...new Set(installed.filter((identity) => !localPackages.has(packageName(identity)) && !locked.has(identity)))];
  for (const workspace of ["", "backend", "frontend"]) {
    const workspaceRoot = join(root, workspace);
    let manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
    try { manifest = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8")); } catch { continue; }
    const optional = new Set(Object.keys(manifest.optionalDependencies ?? {}));
    for (const [name, spec] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies })) {
      if (spec.startsWith("file:") || spec.startsWith("workspace:") || optional.has(name)) continue;
      const packagePath = join(workspaceRoot, "node_modules", name, "package.json");
      let installedPackage: { version?: string };
      try { installedPackage = JSON.parse(readFileSync(packagePath, "utf8")); } catch {
        mismatches.push(`missing installed ${name} required by ${workspace || "root"}`);
        continue;
      }
      const identity = `${name}@${installedPackage.version ?? "unknown"}`;
      if (!locked.has(identity)) mismatches.push(identity);
    }
  }
  const uniqueMismatches = [...new Set(mismatches)].sort();
  return uniqueMismatches.map((identity) => {
    if (identity.startsWith("missing installed ")) return identity;
    const separator = identity.lastIndexOf("@");
    const name = identity.slice(0, separator);
    const versions = [...locked].filter((entry) => entry.startsWith(`${name}@`)).map((entry) => entry.slice(name.length + 1));
    return `installed ${identity} does not match bun.lock${versions.length ? ` (locked: ${versions.join(", ")})` : " (package is not locked)"}`;
  });
}

if (import.meta.main) {
  const root = process.cwd();
  const mismatches = installedLockMismatches(root, readFileSync(join(root, "bun.lock"), "utf8"));
  if (mismatches.length) {
    console.error(`installed dependencies do not match bun.lock:\n  ${mismatches.join("\n  ")}\nRun bash scripts/setup-worktree.sh.`);
    process.exit(1);
  }
  console.log("installed package versions match bun.lock");
}
