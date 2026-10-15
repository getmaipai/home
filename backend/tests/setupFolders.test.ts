import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { replaceSetupStep } from "@/lib/setupState";

let root: string;
beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "setup-folders-")));
  mkdirSync(join(root, "alpha"));
  mkdirSync(join(root, "beta"));
  mkdirSync(join(root, ".hidden"));
  writeFileSync(join(root, "secret-notes.txt"), "x");
  mkdirSync(join(root, "real-target"));
  symlinkSync(join(root, "real-target"), join(root, "link-to-target"));
  symlinkSync("/etc", join(root, "link-to-etc"));
});
afterAll(() => {
  try { chmodSync(join(root, "locked"), 0o755); } catch { /* may not exist */ }
  rmSync(root, { recursive: true, force: true });
});
beforeEach(() => resetDb());

type Listing = { path: string; parent: string | null; freeBytes: number | null; writable: boolean; folders: { name: string; path: string; writable: boolean }[] };
const list = (client: TestClient, path?: string) => client.get(`/api/setup/folders${path === undefined ? "" : `?path=${encodeURIComponent(path)}`}`);
const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error;

describe("setup folder picker", () => {
  test("lists subfolders with name, path and writable, and the listed folder's facts", async () => {
    const response = await list(new TestClient(), root);
    expect(response.status).toBe(200);
    const body = await response.json() as Listing;
    expect(body.path).toBe(root);
    expect(body.parent).not.toBeNull();
    expect(typeof body.freeBytes).toBe("number");
    expect(body.writable).toBe(true);
    expect(body.folders.find((f) => f.name === "alpha")).toEqual({ name: "alpha", path: join(root, "alpha"), writable: true });
  });

  test("file names are never listed", async () => {
    const body = await (await list(new TestClient(), root)).json() as Listing;
    expect(JSON.stringify(body)).not.toContain("secret-notes");
  });

  test("dot-folders are hidden", async () => {
    const body = await (await list(new TestClient(), root)).json() as Listing;
    expect(body.folders.map((f) => f.name)).not.toContain(".hidden");
  });

  test("a symlink is resolved to its real folder before it is answered", async () => {
    const body = await (await list(new TestClient(), root)).json() as Listing;
    expect(body.folders.find((f) => f.name === "link-to-target")?.path).toBe(join(root, "real-target"));
    const via = await (await list(new TestClient(), join(root, "link-to-target"))).json() as Listing;
    expect(via.path).toBe(join(root, "real-target"));
  });

  test("a symlink into a system folder is refused and not offered", async () => {
    const body = await (await list(new TestClient(), root)).json() as Listing;
    expect(body.folders.map((f) => f.name)).not.toContain("link-to-etc");
    expect((await list(new TestClient(), join(root, "link-to-etc"))).status).toBe(403);
  });

  test("traversal with .. is refused with a plain two-part error", async () => {
    const response = await list(new TestClient(), `${root}/alpha/../..`);
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error).toContain("..");
    expect(error).toContain("Up");
  });

  test("a relative path is refused", async () => {
    expect((await list(new TestClient(), "alpha")).status).toBe(400);
  });

  test("system roots and the app's own code folder are refused", async () => {
    for (const path of ["/System", "/proc", "/sys", "/dev", "/etc", join(import.meta.dir, "..", "src")]) {
      if (!existsSync(path)) continue;
      expect((await list(new TestClient(), path)).status).toBe(403);
    }
  });

  test("a missing folder says so and tells the person what to do", async () => {
    const response = await list(new TestClient(), join(root, "gone"));
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toContain("Go up a level");
  });

  test("the default listing is the home folder", async () => {
    const response = await list(new TestClient());
    expect(response.status).toBe(200);
    expect(((await response.json()) as Listing).path).toBe(realpathSync(homedir()));
  });

  test("a read-only folder is reported as not writable", async () => {
    if (process.getuid?.() === 0) return;
    const locked = join(root, "locked");
    mkdirSync(locked);
    chmodSync(locked, 0o555);
    const body = await (await list(new TestClient(), root)).json() as Listing;
    expect(body.folders.find((f) => f.name === "locked")?.writable).toBe(false);
    expect(((await (await list(new TestClient(), locked)).json()) as Listing).writable).toBe(false);
    const create = await new TestClient().post("/api/setup/folders", { parent: locked, name: "child" });
    expect(create.status).toBe(403);
    expect(await errorOf(create)).toBe("That folder is read-only. Pick another folder, or fix its permissions and try again.");
  });

  test("non-loopback requests are refused before an owner exists", async () => {
    expect((await list(new TestClient("192.0.2.42"), root)).status).toBe(403);
    expect((await new TestClient("192.0.2.42").post("/api/setup/folders", { parent: root, name: "x" })).status).toBe(403);
    expect((await new TestClient("192.0.2.42").post("/api/setup/storage/check", { records: root })).status).toBe(403);
    expect((await new TestClient("192.0.2.42").post("/api/setup/folders/native", { folder: "records" })).status).toBe(403);
  });

  test("after an owner exists, a signed-out caller is refused and the owner is allowed", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Owner", secret: "correcthorse" });
    owner.setRemoteAddress("192.0.2.40");
    expect((await list(owner, root)).status).toBe(200);
    expect((await list(new TestClient("192.0.2.41"), root)).status).toBe(401);
  });

  test("everything is refused once setup is complete", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Owner", secret: "correcthorse" });
    replaceSetupStep("done", { status: "done" });
    const response = await list(owner, root);
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toContain("Settings");
    expect((await owner.post("/api/setup/folders", { parent: root, name: "late" })).status).toBe(409);
    expect((await owner.post("/api/setup/storage/check", { records: root })).status).toBe(409);
    expect((await owner.post("/api/setup/folders/native", { folder: "models" })).status).toBe(409);
  });
});

describe("new folder", () => {
  test("creates one folder under a listed folder", async () => {
    const response = await new TestClient().post("/api/setup/folders", { parent: root, name: "made-here" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "made-here", path: join(root, "made-here"), writable: true });
    expect(existsSync(join(root, "made-here"))).toBe(true);
  });

  test("names with separators, .., a leading dot, nothing or over 100 characters are refused", async () => {
    for (const name of ["a/b", "a\\b", "..", "../x", ".hid", "", "   ", "x".repeat(101)]) {
      const response = await new TestClient().post("/api/setup/folders", { parent: root, name });
      expect(response.status).toBe(400);
      expect(await errorOf(response)).toContain("folder");
    }
    expect(existsSync(join(root, "..", "x"))).toBe(false);
  });

  test("a parent that traverses or is a system folder is refused", async () => {
    expect((await new TestClient().post("/api/setup/folders", { parent: `${root}/alpha/..`, name: "n" })).status).toBe(400);
    if (existsSync("/etc")) expect((await new TestClient().post("/api/setup/folders", { parent: "/etc", name: "n" })).status).toBe(403);
  });

  test("an existing name is refused with what to do", async () => {
    const response = await new TestClient().post("/api/setup/folders", { parent: root, name: "alpha" });
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toContain("different name");
  });
});

describe("storage check", () => {
  test("returns checkPlacement rows for the proposed layout", async () => {
    const response = await new TestClient().post("/api/setup/storage/check", { records: join(root, "alpha"), models: join(root, "beta") });
    expect(response.status).toBe(200);
    const { rows } = await response.json() as { rows: { class: string; kind: string; id: string; text: string; fix: string }[] };
    expect(Array.isArray(rows)).toBe(true);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(["class", "fix", "id", "kind", "text"]);
  });

  test("overlapping folders come back as a nesting refusal row", async () => {
    const response = await new TestClient().post("/api/setup/storage/check", { records: join(root, "alpha"), models: join(root, "alpha", "inner") });
    const { rows } = await response.json() as { rows: { kind: string; id: string }[] };
    expect(rows.some((row) => row.kind === "refusal" && row.id.startsWith("nesting"))).toBe(true);
  });

  test("a split setup never asks the models folder for space, and the body takes `split`", async () => {
    const response = await new TestClient().post("/api/setup/storage/check", { records: join(root, "alpha"), split: true });
    expect(response.status).toBe(200);
    const { rows } = await response.json() as { rows: Array<{ class: string; id: string }> };
    expect(rows.some((row) => row.class === "models")).toBe(false);
    expect(rows.some((row) => row.id.startsWith("space-wizard:records"))).toBe(false);
  });

  test("a relative or .. path is refused before any check runs", async () => {
    expect((await new TestClient().post("/api/setup/storage/check", { records: "alpha" })).status).toBe(400);
    const modelsOnly = await new TestClient().post("/api/setup/storage/check", { models: join(root, "alpha") });
    expect(modelsOnly.status).toBe(200);
    expect((await new TestClient().post("/api/setup/storage/check", { records: `${root}/../x` })).status).toBe(400);
  });
});
