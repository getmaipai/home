import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiskFacts } from "@maipai/core/src/diskFacts";
import { checkPlacement } from "@/lib/placement";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function folder(name: string): string {
  const root = mkdtempSync(join(tmpdir(), "maipai-placement-")); roots.push(root);
  const target = join(root, name); mkdirSync(target, { recursive: true }); return target;
}

function facts(overrides: Partial<DiskFacts> = {}): DiskFacts {
  return {
    identity: { id: "disk-a", label: "Disk A", mountPoint: "/", relativePath: "tmp", network: false },
    filesystem: "apfs", kind: "internal", medium: "solid-state", physicalDisk: "disk1", noexec: false,
    ownershipIgnored: false, freeBytes: 100 * 1_000_000_000, totalBytes: 500 * 1_000_000_000,
    ...overrides,
  };
}

const factsReader = (value: DiskFacts) => async () => value;
async function rowFor(id: string, path: string, disk: DiskFacts, opts: Parameters<typeof checkPlacement>[1] = {}) {
  return (await checkPlacement({ [id]: path }, { facts: factsReader(disk), ...opts })).find((row) => row.class === id);
}

test("rejects an unsafe SQLite filesystem with the exact DATA-LOCATION sentence", async () => {
  const result = await rowFor("records", folder("records"), facts({ filesystem: "exfat" }));
  expect(result?.text).toBe("The drive for records uses exfat, which cannot safely store Home records. Choose a drive formatted as APFS, HFS+, ext4, XFS, btrfs or NTFS.");
});

test("rejects a permission-ignoring filesystem for keys", async () => {
  const result = await rowFor("keys", folder("keys"), facts({ filesystem: "exfat" }));
  expect(result?.text).toBe("The drive for keys does not keep files private. Choose a drive formatted as APFS, HFS+, ext4, XFS, btrfs or NTFS.");
});

test("rejects a private-permissions probe failure with exact copy", async () => {
  const rows = await checkPlacement({ keys: folder("keys") }, { facts: factsReader(facts()), probes: { permissions: async () => false } });
  expect(rows.find((row) => row.id === "permissions-filesystem:keys")?.text).toBe("The drive for keys does not keep files private. Choose a drive formatted as APFS, HFS+, ext4, XFS, btrfs or NTFS.");
});

test("rejects a file system whose large-file probe fails", async () => {
  const target = folder("models");
  const rows = await checkPlacement({ models: target }, { facts: factsReader(facts()), probes: { largeFile: async () => false } });
  expect(rows.find((row) => row.id === "large-file:models")?.text).toBe("This file system cannot hold a file as large as ai models needs. Choose a file system that supports large files.");
});

test("rejects a noexec mount for engines", async () => {
  const result = await rowFor("engines", folder("engines"), facts({ noexec: true }));
  expect(result?.text).toBe("The drive for engines does not allow programs to run. Choose a drive without the noexec mount option.");
});

test("rejects a service account write probe failure with exact copy", async () => {
  const rows = await checkPlacement({ records: folder("records") }, { facts: factsReader(facts()), probes: { write: async () => false } });
  expect(rows.find((row) => row.id === "write:records")?.text).toBe("The service account cannot write to records. Choose a folder it can write to.");
});

test("rejects a folder that already holds unmarked data, while a household marker is adoption", async () => {
  const target = folder("records"); writeFileSync(join(target, "foreign.txt"), "data");
  const result = await rowFor("records", target, facts());
  expect(result?.text).toBe("The household records folder already holds files that do not belong to this household. Choose an empty folder or the folder for this household.");
});

test("accepts the current household marker and refuses a different household marker", async () => {
  const own = folder("own");
  const marker = { schema: 1, product: "home", class: "records", householdFolderId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", generation: 1, createdAt: new Date().toISOString(), note: "Home records" };
  writeFileSync(join(own, "maipai-folder.json"), JSON.stringify(marker));
  expect((await checkPlacement({ records: own }, { facts: factsReader(facts()), householdFolderId: marker.householdFolderId })).some((row) => row.id === "folder:records")).toBe(false);
  const foreign = folder("foreign");
  writeFileSync(join(foreign, "maipai-folder.json"), JSON.stringify({ ...marker, householdFolderId: "01ARZ3NDEKTSV4RRFFQ69G5FAW" }));
  expect((await checkPlacement({ records: foreign }, { facts: factsReader(facts()), householdFolderId: marker.householdFolderId })).find((row) => row.id === "folder:records")?.text).toBe("The household records folder already holds files that do not belong to this household. Choose an empty folder or the folder for this household.");
});

test("rejects an unmounted volume path", async () => {
  const result = await rowFor("models", "/Volumes/Offline/models", facts({ identity: { id: "boot", label: "Boot", mountPoint: "/", relativePath: "Volumes/Offline/models", network: false } }));
  expect(result?.text).toBe("The drive for models is not mounted. Connect the drive, then try again.");
});

test("rejects insufficient class minimum space", async () => {
  const result = await rowFor("records", folder("records"), facts({ freeBytes: 1 }));
  expect(result?.text).toBe("There is not enough free space for household records.");
});

test("checks nesting against the resulting layout", async () => {
  const base = folder("layout");
  const rows = await checkPlacement({ records: base, keys: join(base, "keys") }, { facts: factsReader(facts()) });
  expect(rows.find((row) => row.id === "nesting:records")?.text).toBe("The records and keys folders overlap. Choose separate folders, with only the default folders inside records.");
});

test("an unknown RAID physical disk says can't tell and keeps the backup warning", async () => {
  const raid = facts({ identity: { id: "raid-volume", label: "Mirror", mountPoint: "/", relativePath: "", network: false }, physicalDisk: "unknown" });
  const root = folder("house");
  const rows = await checkPlacement({ records: root, backups: join(root, "backup") }, { facts: factsReader(raid) });
  expect(rows.some((row) => row.text === "MaiPai can't tell which disks this uses.")).toBe(true);
  expect(rows.some((row) => row.text === "Your backups are on the same disk as your household. If that disk fails, you lose both.")).toBe(true);
});

test("unknown filesystem facts remain unknown instead of being guessed", async () => {
  const rows = await checkPlacement({ logs: folder("logs") }, { facts: factsReader(facts({ filesystem: "unknown", kind: "unknown", physicalDisk: "unknown", medium: "unknown" })) });
  expect(rows.some((row) => row.kind === "unknown" && row.id === "filesystem:logs")).toBe(true);
});

test("emits the exact keys-on-removable-drive warning", async () => {
  const result = await rowFor("keys", folder("keys"), facts({ kind: "external" }));
  expect(result?.text).toBe("Your keys are on a drive that can be unplugged or carried off. MaiPai will not start without them, and anyone holding the drive and your records together can read your household.");
});

test("emits the exact recent-growth warning", async () => {
  const result = await checkPlacement({ logs: folder("logs") }, { facts: factsReader(facts({ freeBytes: 1_000_000_000 })), growthBytesLast30Days: { logs: 1_000_000_000 } });
  expect(result.find((row) => row.id === "growth:logs")?.text).toBe("At this rate, this drive could fill within 30 days.");
});

test("emits the exact network, permissions, slow-disk, low-space and split-keys warnings", async () => {
  const net = facts({ kind: "network", medium: "spinning", ownershipIgnored: true, freeBytes: 2_000_000_000, totalBytes: 100_000_000_000 });
  const rows = await checkPlacement({ "people-files": folder("people"), models: folder("models"), records: folder("records"), keys: folder("keys"), backups: folder("backups") }, {
    facts: async (path) => path.includes("people") ? net : path.includes("models") ? net : path.includes("keys") ? facts({ identity: { id: "another", label: "Other", mountPoint: "/", relativePath: "", network: false }, physicalDisk: "disk2", kind: "external" }) : facts(),
  });
  const texts = new Set(rows.map((row) => row.text));
  expect(texts.has("These files will live on your network storage. MaiPai can only reach them while it is on and shared, and your NAS's own sign-in decides who else can read them.")).toBe(true);
  expect(texts.has("Any account on this computer can read these files.")).toBe(true);
  expect(texts.has("Models will load more slowly from here.")).toBe(true);
  expect(texts.has("This drive has less than 10 percent or 5 GB free, whichever is larger.")).toBe(true);
  expect(texts.has("MaiPai needs both of these disks connected to start.")).toBe(true);
});
