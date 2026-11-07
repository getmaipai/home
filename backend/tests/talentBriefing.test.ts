import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { owner } from "./support/testAuth";
import { briefingToday } from "@/lib/talent/shows";

describe("TALENT-04 briefing", () => {
  beforeEach(() => resetDb());

  test("offers a morning briefing when no eligible show has an episode today", async () => {
    const { row } = await owner();
    expect(briefingToday(row, new Date("2026-11-07T12:00:00.000Z"))).toEqual({ item: null, offer: true });
  });
});
