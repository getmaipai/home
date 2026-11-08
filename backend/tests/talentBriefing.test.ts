import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { owner } from "./support/testAuth";
import { briefingToday, createShow, listShows, ownBriefingShow } from "@/lib/talent/shows";
import { runNewsAction } from "@/lib/news/actions";

describe("TALENT-04 briefing", () => {
  beforeEach(() => resetDb());

  test("offers a morning briefing when no eligible show has an episode today", async () => {
    const { row } = await owner();
    expect(briefingToday(row, new Date("2026-11-07T12:00:00.000Z"))).toEqual({ item: null, offer: true });
  });

  test("a second tap on Make me a morning briefing reuses the person's briefing show instead of creating another", async () => {
    const { row } = await owner();
    expect(ownBriefingShow(row)).toBeNull();
    const made = await createShow(row, { title: "Morning briefing", format_id: "news_briefing", cast: [], audience: "adult", sources: [{ kind: "news", topics: [], file_ids: [], media_item_id: null }], schedule: null });
    expect(ownBriefingShow(row)?.id).toBe(made.id);
    for (let tap = 0; tap < 3; tap++) {
      const result = await runNewsAction(row, "make_briefing", {});
      expect(result).toMatchObject({ ok: true, value: { production_id: made.id, label: "Your briefing is still being made" } });
    }
    expect(listShows(row).filter((show) => show.show?.format_id === "news_briefing")).toHaveLength(1);
  });
});
