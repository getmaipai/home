import { beforeEach, describe, expect, test } from "bun:test";
import { db, sqlite } from "@/db";
import { maintenanceWindows, statusNotes } from "@/db/schema";
import { resetDb } from "./reset-db";
import { createMaintenance, listMaintenance, activeMaintenanceComponents, postNote, clearNote, getActiveNote, cancelMaintenance } from "@/lib/statusBoard";

const actor = { id: "person-owner0001", displayName: "Sage" };
const t0 = new Date("2026-10-01T12:00:00.000Z");
beforeEach(() => { resetDb(); db.delete(statusNotes).run(); db.delete(maintenanceWindows).run(); });

describe("status board records", () => {
  test("posting replaces the active note; clear and expiry use the supplied clock", () => {
    const first = postNote(actor, { body: "Water will be off", expiresAt: "2026-10-01T13:00:00.000Z" }, t0);
    const second = postNote(actor, { body: "Use bottled water", expiresAt: "2026-10-01T13:00:00.000Z" }, t0);
    expect(getActiveNote(t0)?.id).toBe(second.id);
    const old = sqlite.query("select cleared_by from status_notes where id = ?").get(first.id) as { cleared_by: string };
    expect(old.cleared_by).toBe(actor.id);
    expect(getActiveNote(new Date("2026-10-01T13:00:00.000Z"))).toBeNull();
    clearNote(actor, t0);
    expect(getActiveNote(t0)).toBeNull();
  });

  test("rejects invalid maintenance intervals and component lists", () => {
    for (const input of [
      { title: "Bad range", components: ["hub"], startsAt: "2026-10-02T12:00:00Z", endsAt: "2026-10-02T12:00:00Z" },
      { title: "Past", components: ["hub"], startsAt: "2026-09-29T12:00:00Z", endsAt: "2026-09-30T12:00:00Z" },
      { title: "Empty", components: [], startsAt: "2026-10-02T12:00:00Z", endsAt: "2026-10-02T13:00:00Z" },
      { title: "Unknown", components: ["unknown"], startsAt: "2026-10-02T12:00:00Z", endsAt: "2026-10-02T13:00:00Z" },
      { title: "Duplicate", components: ["hub", "hub"], startsAt: "2026-10-02T12:00:00Z", endsAt: "2026-10-02T13:00:00Z" },
    ] as never[]) expect(() => createMaintenance(actor, input, t0)).toThrow();
  });

  test("derives boundary states, sorts rows and expires completed rows after seven days", () => {
    const window = createMaintenance(actor, { title: "Service", components: ["chat", "hub"], startsAt: "2026-10-02T12:00:00.000Z", endsAt: "2026-10-02T13:00:00.000Z" }, t0);
    expect(listMaintenance(new Date("2026-10-02T11:59:59.999Z"))[0]?.status).toBe("scheduled");
    expect(listMaintenance(new Date("2026-10-02T12:00:00.000Z"))[0]?.status).toBe("in_progress");
    expect(activeMaintenanceComponents(new Date("2026-10-02T12:00:00.000Z"))).toEqual(new Set(["chat", "hub"]));
    expect(listMaintenance(new Date("2026-10-02T13:00:00.000Z"))[0]?.status).toBe("completed");
    cancelMaintenance(actor, window.id, t0);
    expect(listMaintenance(t0)[0]?.status).toBe("cancelled");
    expect(() => cancelMaintenance(actor, window.id, t0)).toThrow();
    expect(listMaintenance(new Date("2026-10-10T13:00:00.000Z"))).toHaveLength(0);
  });

  test("migration creates both tables on the test database", () => {
    const tables = sqlite.query("select name from sqlite_master where type='table'").all() as { name: string }[];
    expect(tables.map((row) => row.name)).toContain("status_notes");
    expect(tables.map((row) => row.name)).toContain("maintenance_windows");
  });
});
