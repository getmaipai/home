import { describe, expect, test } from "bun:test";
import { SERVER_IDLE_TIMEOUT_SECONDS } from "@/lib/serverConfig";

describe("SERVER_IDLE_TIMEOUT_SECONDS", () => {
  test("keeps the server timeout above Bun's short default", () => {
    expect(SERVER_IDLE_TIMEOUT_SECONDS * 1000).toBeGreaterThan(10_000);
  });
});
