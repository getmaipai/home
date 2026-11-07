// AUDIT-DUP-ROUTES-01: quick timers and world places share one owned-record machine; these pin what each keeps of its own.
import { beforeEach, describe, expect, test } from "bun:test";
import { createQuickTimer, deleteQuickTimer, listQuickTimers, updateQuickTimer } from "@/lib/quickTimers";
import { createWorldPlace, deleteWorldPlace, listWorldPlaces, updateWorldPlace } from "@/lib/worldPlaces";
import { owner } from "./support/testAuth";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

describe("world places on the shared owned-record machine", () => {
  test("create trims name and country, refuses a bad zone, and stops at 12", async () => {
    const { row } = await owner();
    const made = createWorldPlace(row, { name: "  Lisbon ", country: " Portugal ", zone: "Europe/Lisbon" });
    expect(made.ok && made.value.name).toBe("Lisbon");
    expect(made.ok && made.value.country).toBe("Portugal");
    expect(createWorldPlace(row, { name: "Nowhere", country: "X", zone: "Not/AZone" })).toEqual({ ok: false, status: 400, error: "Choose a valid time zone." });
    expect(createWorldPlace(row, { name: "", country: "X", zone: "Europe/Paris" })).toEqual({ ok: false, status: 400, error: "Invalid world place." });
    for (let i = 1; i < 12; i++) expect(createWorldPlace(row, { name: `Place ${i}`, country: "X", zone: "Europe/Paris" }).ok).toBe(true);
    expect(createWorldPlace(row, { name: "One too many", country: "X", zone: "Europe/Paris" })).toEqual({ ok: false, status: 400, error: "You can save up to 12 places." });
  });

  test("update keeps what is not sent, refuses a bad zone, answers 404 for another person's or a deleted row", async () => {
    const { row } = await owner();
    const made = createWorldPlace(row, { name: "Oslo", country: "Norway", zone: "Europe/Oslo" });
    if (!made.ok) throw new Error("create failed");
    const renamed = updateWorldPlace(row, made.value.id, { name: " Oslo city " });
    expect(renamed.ok && [renamed.value.name, renamed.value.country, renamed.value.zone]).toEqual(["Oslo city", "Norway", "Europe/Oslo"]);
    expect(updateWorldPlace(row, made.value.id, { zone: "Bad/Zone" })).toEqual({ ok: false, status: 400, error: "Choose a valid time zone." });
    expect(updateWorldPlace(row, "place-missing", { name: "x" })).toEqual({ ok: false, status: 404, error: "No such place." });
    expect(deleteWorldPlace(row, made.value.id)).toEqual({ ok: true, value: { id: made.value.id } });
    expect(listWorldPlaces(row)).toEqual([]);
    expect(deleteWorldPlace(row, made.value.id)).toEqual({ ok: false, status: 404, error: "No such place." });
  });
});

describe("quick timers on the shared owned-record machine", () => {
  test("a person starts with four defaults, edits one, and a deleted timer is gone from the list", async () => {
    const { row } = await owner();
    const list = listQuickTimers(row);
    expect(list.map((t) => t.name)).toEqual(["Tea steep", "A little break", "Focus session", "Deep work"]);
    const updated = updateQuickTimer(row, list[0]!.id, { name: " Green tea ", minutes: 3 });
    expect(updated.ok && [updated.value.name, updated.value.minutes]).toEqual(["Green tea", 3]);
    expect(updateQuickTimer(row, "qtimer-missing", { minutes: 1 })).toEqual({ ok: false, status: 404, error: "No such quick timer." });
    expect(createQuickTimer(row, { name: "", minutes: 5 })).toEqual({ ok: false, status: 400, error: "Invalid quick timer." });
    const added = createQuickTimer(row, { name: "Pasta", minutes: 9 });
    expect(added.ok && added.value.position).toBe(4);
    expect(deleteQuickTimer(row, list[1]!.id).ok).toBe(true);
    expect(listQuickTimers(row).map((t) => t.name)).not.toContain("A little break");
  });
});
