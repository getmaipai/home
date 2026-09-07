import { afterEach, expect, test } from "bun:test";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { api } from "@/lib/api";
import { brainBlockReason, useEngineHealth } from "./useEngineHealth";

const original = api.senses;
afterEach(() => {
  cleanup();
  api.senses = original;
});

test("reports unreachable when the health check throws", async () => {
  api.senses = async () => {
    throw new Error("offline");
  };
  const { result } = renderHook(() => useEngineHealth());
  await waitFor(() => expect(result.current?.brain).toBe("unreachable"));
});

test("reports the raw kind from a successful health check", async () => {
  api.senses = async () => ({ brain: "starting", voice: "none" });
  const { result } = renderHook(() => useEngineHealth());
  await waitFor(() => expect(result.current?.brain).toBe("starting"));
});

test("blocks sending while the model is starting or the engine is stopped, not otherwise", () => {
  expect(brainBlockReason("starting")).toBeDefined();
  expect(brainBlockReason("stopped")).toBeDefined();
  for (const kind of ["llama-server", "stub", "none", "unreachable", undefined]) {
    expect(brainBlockReason(kind)).toBeUndefined();
  }
});
