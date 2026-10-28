// NEWS-DEDUPE-01: near-duplicate headlines collapse to the best card; different events never merge.
import { describe, expect, test } from "bun:test";
import { collapseNearDuplicates, titleTokens, type DuplicateCandidate } from "@/lib/news/nearDuplicates";

let n = 0;
const item = (title: string, over: Partial<DuplicateCandidate> = {}): DuplicateCandidate =>
  ({ item_id: `i${++n}`, title, topics: ["entertainment"], published_at: "2026-10-27T10:00:00Z", outlets: 1, has_image: false, ...over });

describe("collapseNearDuplicates", () => {
  test("the Lynskey pair collapses to the one with a picture", () => {
    const deadline = item("Melanie Lynskey Stars In 'Mushroom Murders' Limited Series", { has_image: false });
    const variety = item("Melanie Lynskey to Play Erin Patterson in 'Mushroom Murders' Limited Series", { has_image: true });
    const kept = collapseNearDuplicates([deadline, variety]);
    expect([...kept.keys()]).toEqual([variety.item_id]);
    expect(kept.get(variety.item_id)).toEqual([deadline.item_id]);
  });
  test("same event with no picture keeps the one covered by more outlets", () => {
    const a = item("Fed holds interest rates steady at October meeting", { topics: ["business"], outlets: 1 });
    const b = item("Federal Reserve holds interest rates steady at October meeting", { topics: ["business"], outlets: 3 });
    expect([...collapseNearDuplicates([a, b]).keys()]).toEqual([b.item_id]);
  });
  test("same company, different events do not merge", () => {
    const a = item("Apple unveils new iPhone 17 lineup at September event", { topics: ["tech"] });
    const b = item("Apple faces EU fine over App Store payment rules", { topics: ["tech"] });
    expect(collapseNearDuplicates([a, b]).size).toBe(2);
  });
  test("same words a day and a half apart do not merge", () => {
    const a = item("Lakers beat Celtics in overtime thriller");
    const b = item("Lakers beat Celtics in overtime thriller", { published_at: "2026-10-25T20:00:00Z" });
    expect(collapseNearDuplicates([a, b]).size).toBe(2);
  });
  test("no shared topic does not merge", () => {
    const a = item("Mushroom Murders trial begins in Victoria", { topics: ["world"] });
    const b = item("Mushroom Murders trial begins in Victoria", { topics: ["entertainment"] });
    expect(collapseNearDuplicates([a, b]).size).toBe(2);
  });
  test("tokens drop stop words and possessives", () => {
    expect([...titleTokens("The Fed's rates")].sort()).toEqual(["fed", "rate"]);
  });
});
