import { beforeEach, describe, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { SOURCE_MODE_KEY, SOURCE_MODE_OVERRIDE_KEYS } from "@/lib/retrieval/sourceMode";
import { owner, teen } from "./support/testAuth";

beforeEach(() => resetDb());

async function checklist(client: TestClient): Promise<Array<{ id: string; title: string; reason: string; done: boolean; open: { label: string; href: string } }>> {
  const response = await client.get("/api/setup-checklist");
  expect(response.status).toBe(200);
  return await response.json() as Array<{ id: string; title: string; reason: string; done: boolean; open: { label: string; href: string } }>;
}

describe("GET /api/setup-checklist", () => {
  test("returns the six requested setup facts", async () => {
    const { client } = await owner();
    const result = await checklist(client);
    expect(result.map((item) => item.id)).toEqual([
      "backup-key", "voice", "photos", "people", "web-search", "remote-engine",
    ]);
    expect(result.every((item) => typeof item.done === "boolean" && item.reason.length > 0 && item.open.href.length > 0)).toBe(true);
    expect(result.find((item) => item.id === "backup-key")?.open.href).toBe("/settings/home/storage");
    expect(result.find((item) => item.id === "remote-engine")?.open.href).toBe("/settings/home/ai");
  });

  test("a non-admin gets a plain 403 without checklist item names", async () => {
    const { client } = await owner();
    const teenClient = await teen(client);
    const response = await teenClient.get("/api/setup-checklist");
    const body = await response.json() as { error: string };
    expect(response.status).toBe(403);
    expect(body.error).toBe("This checklist is for the owner and admins. Sign in with an owner or admin account.");
    for (const title of ["Save your backup key", "Choose a speaking voice", "Add people to your Home"]) expect(body.error).not.toContain(title);
  });

  test("each checklist item follows its matching household fact", async () => {
    const { client, row: ownerRow } = await owner();
    const initial = await checklist(client);
    const before = new Map(initial.map((item) => [item.id, item.done]));
    expect(before.get("backup-key")).toBe(false);
    expect(before.get("voice")).toBe(false);
    expect(before.get("photos")).toBe(false);
    expect(before.get("people")).toBe(false);
    expect(before.get("remote-engine")).toBe(true);

    expect((await client.post("/api/setup/backup_key", { status: "done", phase: "meet" })).status).toBe(200);
    expect((await checklist(client)).find((item) => item.id === "backup-key")?.done).toBe(true);

    const voice = await client.put("/api/settings", { scope: `person:${ownerRow.id}`, key: "tts.voice_id", value: "cosette" });
    expect(voice.status).toBe(200);
    expect((await checklist(client)).find((item) => item.id === "voice")?.done).toBe(true);

    const photos = await client.put("/api/settings", { scope: "household", key: "vision.on_request.enabled", value: true });
    expect(photos.status).toBe(200);
    expect((await checklist(client)).find((item) => item.id === "photos")?.done).toBe(true);

    const addedPerson = await client.post("/api/people", { displayName: "Bramble", role: "teen" });
    expect(addedPerson.status).toBe(201);
    expect((await checklist(client)).find((item) => item.id === "people")?.done).toBe(true);

    const offline = await client.put("/api/settings", { scope: "household", key: SOURCE_MODE_KEY, value: "offline" });
    expect(offline.status).toBe(200);
    expect((await checklist(client)).find((item) => item.id === "web-search")?.done).toBe(false);
    const webOffline = await client.put("/api/settings", { scope: "household", key: SOURCE_MODE_OVERRIDE_KEYS.web, value: "offline" });
    expect(webOffline.status).toBe(200);
    expect((await checklist(client)).find((item) => item.id === "web-search")?.done).toBe(true);

    const remote = await client.put("/api/settings", { scope: "household", key: "engines.stack.where", value: "another_computer" });
    expect(remote.status).toBe(200);
    expect((await checklist(client)).find((item) => item.id === "remote-engine")?.done).toBe(false);
  });

  test("Not now uses its own per-person setting and leaves pinned apps byte-identical", async () => {
    const { client: ownerClient } = await owner();
    const created = await ownerClient.post("/api/people", { displayName: "Marlow", role: "admin", secret: "correcthorse2" });
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };
    const adminClient = new TestClient();
    await adminClient.post("/api/auth/verify-secret", { personId: id, secret: "correcthorse2" });

    const pinnedAppsBefore = '[ "existing-app", "home" ]';
    const pinnedApps = await adminClient.put("/api/settings", {
      scope: `person:${id}`,
      key: "ui.pinned_apps",
      value: pinnedAppsBefore,
    });
    expect(pinnedApps.status).toBe(200);
    const dismissed = await adminClient.put("/api/settings", {
      scope: `person:${id}`,
      key: "setup.checklist_dismissed",
      value: JSON.stringify(["people"]),
    });
    expect(dismissed.status).toBe(200);
    expect((await checklist(adminClient)).some((item) => item.id === "people")).toBe(false);
    expect((await checklist(ownerClient)).some((item) => item.id === "people")).toBe(true);
    const saved = await adminClient.get(`/api/settings?scope=person:${id}`);
    expect(saved.status).toBe(200);
    const values = await saved.json() as Array<{ key: string; value: unknown }>;
    expect(values.find((setting) => setting.key === "ui.pinned_apps")?.value).toBe(pinnedAppsBefore);
  });
});
