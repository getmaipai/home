import { describe, expect, test } from "bun:test";
import {
  SEARXNG_CONNECT_LIMIT_MS,
  SEARXNG_ATTEMPT_LIMIT_MS,
  ADULT_WRITTEN_WEBSEARCH_DEADLINE_MS,
  webSearchToolDeadlineMs,
} from "@/lib/webSearchBudget";

describe("webSearchBudget", () => {
  test("connect limit is below the attempt limit, which is below the adult written deadline", () => {
    expect(SEARXNG_CONNECT_LIMIT_MS).toBeLessThan(SEARXNG_ATTEMPT_LIMIT_MS);
    expect(SEARXNG_ATTEMPT_LIMIT_MS).toBeLessThan(ADULT_WRITTEN_WEBSEARCH_DEADLINE_MS);
  });

  test("adult written gets the long deadline", () => {
    expect(webSearchToolDeadlineMs("adult", "written", 8000)).toBe(ADULT_WRITTEN_WEBSEARCH_DEADLINE_MS);
  });

  test("adult spoken keeps the existing deadline", () => {
    expect(webSearchToolDeadlineMs("adult", "spoken", 8000)).toBe(8000);
  });

  test("teen written keeps the existing deadline", () => {
    expect(webSearchToolDeadlineMs("teen", "written", 8000)).toBe(8000);
  });

  test("undefined band and surface keep the existing deadline", () => {
    expect(webSearchToolDeadlineMs(undefined, undefined, 8000)).toBe(8000);
  });
});
