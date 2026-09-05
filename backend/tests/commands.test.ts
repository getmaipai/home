import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { setHouseholdSettingValue } from "@/lib/settings";
import { createCommand, listCommands, deleteCommand, matchCommand, runCommand } from "@/lib/commands";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { PersonRow } from "@/types";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetRateLimiterForTests();
});

async function owner(): Promise<{ client: TestClient; row: PersonRow }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const row = db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow;
  return { client, row };
}

async function withRole(
  ownerClient: TestClient,
  displayName: string,
  role: string,
): Promise<{ client: TestClient; row: PersonRow }> {
  const created = await ownerClient.post("/api/people", { displayName, role });
  const { id } = (await created.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/select", { personId: id });
  const row = db.select().from(people).where(eq(people.id, id)).get()! as PersonRow;
  return { client, row };
}

describe("createCommand", () => {
  test("an adult (or higher) can create a plain reply command", async () => {
    const { row } = await owner();
    const result = createCommand(row, "movie night", "child", { kind: "reply", text: "Starting movie night mode." });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.trigger).toBe("movie night");
    expect(result.value.action).toEqual({ kind: "reply", text: "Starting movie night mode." });
  });

  test("below-adult roles cannot create a command", async () => {
    const { client: ownerClient } = await owner();
    const { row: teen } = await withRole(ownerClient, "Bramble", "teen");
    const result = createCommand(teen, "movie night", "child", { kind: "reply", text: "Hi" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
  });

  test("rejects an empty trigger", async () => {
    const { row } = await owner();
    const result = createCommand(row, "   ", "child", { kind: "reply", text: "Hi" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  // A code review (2026-09-05) found matchCommand() reuses turnEngine's
  // own matchPattern() as-is, which treats a bare "*" as a real
  // wildcard-capture, not a literal character - nothing here stopped a
  // trigger containing one from becoming fuzzier than the documented
  // "exact match only, never a guess" invariant.
  test("rejects a trigger containing \"*\"", async () => {
    const { row } = await owner();
    const result = createCommand(row, "unlock * door", "adult", { kind: "reply", text: "Hi" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  test("rejects an unrecognized min_role", async () => {
    const { row } = await owner();
    const result = createCommand(row, "movie night", "toddler", { kind: "reply", text: "Hi" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  test("rejects an action that fails validation", async () => {
    const { row } = await owner();
    const result = createCommand(row, "movie night", "child", { kind: "reply", text: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  test("rejects a duplicate trigger, case-insensitive and trimmed", async () => {
    const { row } = await owner();
    const first = createCommand(row, "movie night", "child", { kind: "reply", text: "Hi" });
    expect(first.ok).toBe(true);
    const dup = createCommand(row, "  Movie Night  ", "child", { kind: "reply", text: "Hi again" });
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.status).toBe(400);
  });

  test("a home_call_service command touching a security domain requires an owner/admin creator", async () => {
    const { client: ownerClient } = await owner();
    const { row: adult } = await withRole(ownerClient, "Bramble", "adult");
    const result = createCommand(adult, "unlock the door", "adult", {
      kind: "home_call_service",
      domain: "lock",
      service: "unlock",
      target: { entity_id: "lock.front_door" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
    expect(result.error).toContain("security domain");
  });

  test("a home_call_service command touching a security domain requires min_role adult or stricter", async () => {
    const { row: ownerRow } = await owner();
    const result = createCommand(ownerRow, "unlock the door", "teen", {
      kind: "home_call_service",
      domain: "lock",
      service: "unlock",
      target: { entity_id: "lock.front_door" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
    expect(result.error).toContain("adult");
  });

  test("an owner creating a security-domain command with min_role adult succeeds", async () => {
    const { row: ownerRow } = await owner();
    const result = createCommand(ownerRow, "unlock the door", "adult", {
      kind: "home_call_service",
      domain: "lock",
      service: "unlock",
      target: { entity_id: "lock.front_door" },
    });
    expect(result.ok).toBe(true);
  });

  test("a non-security domain (light) command has no owner/admin or role-floor requirement", async () => {
    const { client: ownerClient } = await owner();
    const { row: adult } = await withRole(ownerClient, "Bramble", "adult");
    const result = createCommand(adult, "movie lights", "child", {
      kind: "home_call_service",
      domain: "light",
      service: "turn_off",
      target: { entity_id: "light.living_room" },
    });
    expect(result.ok).toBe(true);
  });
});

describe("listCommands / deleteCommand", () => {
  test("listCommands is household-wide, visible regardless of creator", async () => {
    const { client: ownerClient, row: ownerRow } = await owner();
    const { row: adult } = await withRole(ownerClient, "Bramble", "adult");
    createCommand(ownerRow, "movie night", "child", { kind: "reply", text: "Hi" });
    createCommand(adult, "game time", "child", { kind: "reply", text: "Hi" });
    expect(listCommands().length).toBe(2);
  });

  test("the creator can delete their own command", async () => {
    const { row } = await owner();
    const created = createCommand(row, "movie night", "child", { kind: "reply", text: "Hi" });
    if (!created.ok) throw new Error("setup failed");
    const result = deleteCommand(row, created.value.id);
    expect(result.ok).toBe(true);
    expect(listCommands().length).toBe(0);
  });

  test("an owner/admin can delete someone else's command", async () => {
    const { client: ownerClient, row: ownerRow } = await owner();
    const { row: adult } = await withRole(ownerClient, "Bramble", "adult");
    const created = createCommand(adult, "game time", "child", { kind: "reply", text: "Hi" });
    if (!created.ok) throw new Error("setup failed");
    const result = deleteCommand(ownerRow, created.value.id);
    expect(result.ok).toBe(true);
  });

  test("an unrelated non-admin household member cannot delete someone else's command", async () => {
    const { client: ownerClient, row: ownerRow } = await owner();
    const { row: adultA } = await withRole(ownerClient, "Bramble", "adult");
    const { row: adultB } = await withRole(ownerClient, "Cosmo", "adult");
    const created = createCommand(adultA, "game time", "child", { kind: "reply", text: "Hi" });
    if (!created.ok) throw new Error("setup failed");
    const result = deleteCommand(adultB, created.value.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
    void ownerRow;
  });

  test("deleting a nonexistent command is a 404", async () => {
    const { row } = await owner();
    const result = deleteCommand(row, "cmd-does-not-exist");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
  });
});

describe("matchCommand / runCommand", () => {
  test("matches the exact trigger, case-insensitively, and runs a reply action", async () => {
    const { row } = await owner();
    createCommand(row, "movie night", "child", { kind: "reply", text: "Starting movie night mode.", speech: "Movie night, coming right up." });
    const matched = matchCommand("Movie Night", row);
    expect(matched?.trigger).toBe("movie night");
    if (!matched) return;
    const ran = await runCommand(matched);
    expect(ran.ok).toBe(true);
    if (!ran.ok) return;
    expect(ran.value.text).toBe("Starting movie night mode.");
    expect(ran.value.speech).toBe("Movie night, coming right up.");
  });

  test("does not fuzzy-match a phrase that only partially overlaps the trigger", async () => {
    const { row } = await owner();
    createCommand(row, "movie night", "child", { kind: "reply", text: "Hi" });
    expect(matchCommand("let's start movie night please", row)).toBeNull();
    expect(matchCommand("movie", row)).toBeNull();
  });

  test("a speaker below the command's min_role never matches it", async () => {
    const { client: ownerClient, row: ownerRow } = await owner();
    const { row: child } = await withRole(ownerClient, "Bramble", "child");
    createCommand(ownerRow, "unlock the door", "adult", {
      kind: "home_call_service",
      domain: "lock",
      service: "unlock",
      target: { entity_id: "lock.front_door" },
    });
    expect(matchCommand("unlock the door", child)).toBeNull();
    expect(matchCommand("unlock the door", ownerRow)).not.toBeNull();
  });

  test("runCommand maps a HostError (Home Assistant not configured) to a real error result, not a throw", async () => {
    const { row } = await owner();
    setHouseholdSettingValue("home.base_url", "");
    setHouseholdSettingValue("home.access_token", "");
    const created = createCommand(row, "movie lights", "child", {
      kind: "home_call_service",
      domain: "light",
      service: "turn_off",
      target: { entity_id: "light.living_room" },
    });
    if (!created.ok) throw new Error("setup failed");
    const ran = await runCommand(created.value);
    expect(ran.ok).toBe(false);
    if (ran.ok) return;
    expect(ran.status).toBe(400);
  });

  // A code review (2026-09-05) found runCommand() sent the domain to the
  // real Home Assistant call exactly as the household typed it at
  // creation time: real HA domains are canonically lowercase, so a
  // command created with domain "Lock" would 404 on every real trigger
  // even though creation-time security gating (which lowercases
  // internally) let it through and looked fine.
  test("a mixed-case domain is lowercased before the real Home Assistant call", async () => {
    let seenPath = "";
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        seenPath = new URL(req.url).pathname;
        return Response.json({ context: { id: "abc" } });
      },
    });
    try {
      const { row } = await owner();
      setHouseholdSettingValue("home.base_url", `http://127.0.0.1:${server.port}`);
      setHouseholdSettingValue("home.access_token", "test-token");
      const created = createCommand(row, "unlock the door", "adult", {
        kind: "home_call_service",
        domain: "Lock",
        service: "unlock",
        target: { entity_id: "lock.front_door" },
      });
      if (!created.ok) throw new Error("setup failed");
      const ran = await runCommand(created.value);
      expect(ran.ok).toBe(true);
      expect(seenPath).toBe("/api/services/lock/unlock");
    } finally {
      server.stop(true);
    }
  });

  test("runCommand fires the real Home Assistant call for a configured home_call_service command", async () => {
    let seenPath = "";
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        seenPath = new URL(req.url).pathname;
        return Response.json({ context: { id: "abc" } });
      },
    });
    try {
      const { row } = await owner();
      setHouseholdSettingValue("home.base_url", `http://127.0.0.1:${server.port}`);
      setHouseholdSettingValue("home.access_token", "test-token");
      const created = createCommand(row, "movie lights", "child", {
        kind: "home_call_service",
        domain: "light",
        service: "turn_off",
        target: { entity_id: "light.living_room" },
      });
      if (!created.ok) throw new Error("setup failed");
      const ran = await runCommand(created.value);
      expect(ran.ok).toBe(true);
      if (!ran.ok) return;
      expect(ran.value.text).toBe("Done.");
      expect(seenPath).toBe("/api/services/light/turn_off");
    } finally {
      server.stop(true);
    }
  });
});

describe("HTTP: /api/commands", () => {
  test("requires auth", async () => {
    expect((await new TestClient().get("/api/commands")).status).toBe(401);
  });

  test("an owner can create, list, and delete a command over HTTP", async () => {
    const { client } = await owner();
    const created = await client.post("/api/commands", {
      trigger: "movie night",
      minRole: "child",
      action: { kind: "reply", text: "Starting movie night mode." },
    });
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };

    const listed = await client.get("/api/commands");
    const rows = (await listed.json()) as Array<{ id: string }>;
    expect(rows.some((r) => r.id === id)).toBe(true);

    const deleted = await client.request(`/api/commands/${id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(((await client.get("/api/commands")).status)).toBe(200);
    const afterDelete = (await (await client.get("/api/commands")).json()) as Array<{ id: string }>;
    expect(afterDelete.some((r) => r.id === id)).toBe(false);
  });

  test("a below-adult person gets a 403 creating a command over HTTP", async () => {
    const { client: ownerClient } = await owner();
    const { client: teenClient } = await withRole(ownerClient, "Bramble", "teen");
    const res = await teenClient.post("/api/commands", {
      trigger: "movie night",
      minRole: "child",
      action: { kind: "reply", text: "Hi" },
    });
    expect(res.status).toBe(403);
  });
});
