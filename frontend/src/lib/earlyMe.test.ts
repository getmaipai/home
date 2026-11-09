import { expect, test } from "bun:test";
import { takeEarlyMe } from "@/lib/earlyMe";

const win = (slot?: { at: number; answer: Promise<unknown> }) => ({ __maipaiEarlyMe: slot }) as unknown as Window;

test("a fresh early answer is used once", async () => {
  const w = win({ at: Date.now(), answer: Promise.resolve({ id: "p1" }) });
  expect(await takeEarlyMe(w)).toEqual({ id: "p1" });
  expect(await takeEarlyMe(w)).toBeNull();
});
test("an old, failed or missing answer falls back", async () => {
  expect(await takeEarlyMe(win({ at: Date.now() - 60_000, answer: Promise.resolve({ id: "p1" }) }))).toBeNull();
  expect(await takeEarlyMe(win({ at: Date.now(), answer: Promise.resolve(null) }))).toBeNull();
  expect(await takeEarlyMe(win())).toBeNull();
});
