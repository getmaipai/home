import { beforeEach, describe, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { SOURCE_MODE_KEY, SOURCE_MODE_OVERRIDE_KEYS } from "@/lib/retrieval/sourceMode";
import { db } from "@/db";
import { packageInstalls } from "@/db/schema";
import { setSmbTarget } from "@/lib/backupTargets";
import { setHouseholdSettingValue } from "@/lib/settings";
import { issueDeviceToken, redeemDeviceToken } from "@/lib/deviceTokens";
import { SFACE_DIM, SFACE_MODEL_ID } from "@/lib/faceModelPins";
import { owner, teen } from "./support/testAuth";

beforeEach(() => resetDb());

async function checklist(client: TestClient): Promise<Array<{ id: string; title: string; reason: string; done: boolean; open: { label: string; href: string } }>> {
  const response = await client.get("/api/setup-checklist");
  expect(response.status).toBe(200);
  return await response.json() as Array<{ id: string; title: string; reason: string; done: boolean; open: { label: string; href: string } }>;
}

describe("GET /api/setup-checklist", () => {
  test("returns the existing seven and the four additional setup facts", async () => {
    const { client } = await owner();
    const result = await checklist(client);
    expect(result.map((item) => item.id)).toEqual([
      "face-sign-in", "family", "backup-target", "phone-or-tablet", "web-search", "apps", "away-access",
      "backup-key", "voice", "photos",
    ]);
    expect(result.every((item) => typeof item.done === "boolean" && item.reason.length > 0 && item.open.href.length > 0)).toBe(true);
    expect(result.find((item) => item.id === "backup-key")?.open.href).toBe("/settings/home/storage");
    expect(result.find((item) => item.id === "phone-or-tablet")?.open.href).toBe("/devices");
    expect(result.find((item) => item.id === "away-access")?.open.href).toBe("/setup/away");
    expect(result.map((item) => item.title)).not.toContain("Add the offline library");
  });

  test("a non-admin gets a plain 403 without checklist item names", async () => {
    const { client } = await owner();
    const teenClient = await teen(client);
    const response = await teenClient.get("/api/setup-checklist");
    const body = await response.json() as { error: string };
    expect(response.status).toBe(403);
    expect(body.error).toBe("This checklist is for the owner and admins. Sign in with an owner or admin account.");
    for (const title of ["Set up face sign-in", "Add your family", "Save your backup key"]) expect(body.error).not.toContain(title);
  });

  test("each checklist item follows its matching household fact", async () => {
    const { client, row: ownerRow } = await owner();
    const initial = await checklist(client);
    const before = new Map(initial.map((item) => [item.id, item.done]));
    expect(before.get("face-sign-in")).toBe(false);
    expect(before.get("family")).toBe(false);
    expect(before.get("backup-target")).toBe(false);
    expect(before.get("phone-or-tablet")).toBe(false);
    expect(before.get("apps")).toBe(false);
    expect(before.get("away-access")).toBe(false);
    expect(before.get("backup-key")).toBe(false);
    expect(before.get("voice")).toBe(false);
    expect(before.get("photos")).toBe(false);

    expect((await client.post("/api/setup/backup_key", { status: "done", phase: "meet" })).status).toBe(200);
    expect((await checklist(client)).find((item) => item.id === "backup-key")?.done).toBe(true);

    const face = await client.post("/api/biometric-prints", {
      person_id: ownerRow.id,
      model_id: SFACE_MODEL_ID,
      embedding: Array.from({ length: SFACE_DIM }, (_, index) => index / SFACE_DIM),
    });
    expect(face.status).toBe(201);
    expect((await checklist(client)).find((item) => item.id === "face-sign-in")?.done).toBe(true);

    const voice = await client.put("/api/settings", { scope: `person:${ownerRow.id}`, key: "tts.voice_id", value: "cosette" });
    expect(voice.status).toBe(200);
    expect((await checklist(client)).find((item) => item.id === "voice")?.done).toBe(true);

    const photos = await client.put("/api/settings", { scope: "household", key: "vision.on_request.enabled", value: true });
    expect(photos.status).toBe(200);
    expect((await checklist(client)).find((item) => item.id === "photos")?.done).toBe(true);

    const addedPerson = await client.post("/api/people", { displayName: "Bramble", role: "teen" });
    expect(addedPerson.status).toBe(201);
    expect((await checklist(client)).find((item) => item.id === "family")?.done).toBe(true);

    expect(setSmbTarget("/not-mounted-in-test", false).ok).toBe(true);
    expect((await checklist(client)).find((item) => item.id === "backup-target")?.done).toBe(true);

    const issued = issueDeviceToken(ownerRow.id, "phone", "Test phone");
    expect(redeemDeviceToken(issued.token, "https://home.test")).not.toBeNull();
    expect((await checklist(client)).find((item) => item.id === "phone-or-tablet")?.done).toBe(true);

    const offline = await client.put("/api/settings", { scope: "household", key: SOURCE_MODE_KEY, value: "offline" });
    expect(offline.status).toBe(200);
    expect((await checklist(client)).find((item) => item.id === "web-search")?.done).toBe(false);
    const webOffline = await client.put("/api/settings", { scope: "household", key: SOURCE_MODE_OVERRIDE_KEYS.web, value: "offline" });
    expect(webOffline.status).toBe(200);
    expect((await checklist(client)).find((item) => item.id === "web-search")?.done).toBe(true);

    db.insert(packageInstalls).values({
      packageId: "outside-default-set", version: "1.0.0", previousVersion: null, channel: "stable",
      sourceCommit: "test-commit", permissions: "[]", installedAt: new Date().toISOString(),
    }).run();
    expect((await checklist(client)).find((item) => item.id === "apps")?.done).toBe(true);

    // The route refuses this key until Tailscale is signed in on the machine running the test, so the
    // household fact the checklist reads is written directly: the test follows the fact, not the machine.
    const away = setHouseholdSettingValue("network.tailnet_access", true);
    expect(away.ok).toBe(true);
    expect((await checklist(client)).find((item) => item.id === "away-access")?.done).toBe(true);

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
      value: JSON.stringify(["family"]),
    });
    expect(dismissed.status).toBe(200);
    expect((await checklist(adminClient)).some((item) => item.id === "family")).toBe(false);
    expect((await checklist(ownerClient)).some((item) => item.id === "family")).toBe(true);
    const saved = await adminClient.get(`/api/settings?scope=person:${id}`);
    expect(saved.status).toBe(200);
    const values = await saved.json() as Array<{ key: string; value: unknown }>;
    expect(values.find((setting) => setting.key === "ui.pinned_apps")?.value).toBe(pinnedAppsBefore);
  });
});
