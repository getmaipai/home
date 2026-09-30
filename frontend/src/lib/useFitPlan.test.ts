import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { api, type FitPlanResponse } from "@/lib/api";
import { __resetFitPlanCacheForTests, useFitPlan } from "@/lib/useFitPlan";

afterEach(() => { cleanup(); __resetFitPlanCacheForTests(); });

const answer: FitPlanResponse = { plan: {} as NonNullable<FitPlanResponse["plan"]>, wording: { verdict: "yes", headline: "Runs well on this computer", detail: "There is room for it." } };

describe("useFitPlan", () => {
  test("shares one request for users of the same key and requests a second key", async () => {
    const original = api.fitPlan;
    const fitPlan = mock(() => Promise.resolve(answer));
    api.fitPlan = fitPlan as typeof api.fitPlan;
    try {
      const first = renderHook(() => useFitPlan("https://huggingface.co/atlas/model.gguf", 4096));
      const second = renderHook(() => useFitPlan("https://huggingface.co/atlas/model.gguf", 4096));
      await waitFor(() => expect(first.result.current.state).toBe("ready"));
      await waitFor(() => expect(second.result.current.state).toBe("ready"));
      expect(fitPlan).toHaveBeenCalledTimes(1);
      const third = renderHook(() => useFitPlan("https://huggingface.co/atlas/other.gguf", 4096));
      await waitFor(() => expect(third.result.current.state).toBe("ready"));
      expect(fitPlan).toHaveBeenCalledTimes(2);
    } finally { api.fitPlan = original; }
  });

  test("a null URL is idle without a request", () => {
    const original = api.fitPlan;
    const fitPlan = mock(() => Promise.resolve(answer));
    api.fitPlan = fitPlan as typeof api.fitPlan;
    try {
      const { result } = renderHook(() => useFitPlan(null, undefined));
      expect(result.current).toEqual({ state: "idle", response: null });
      expect(fitPlan).not.toHaveBeenCalled();
    } finally { api.fitPlan = original; }
  });

  test("a rejected request produces failed", async () => {
    const original = api.fitPlan;
    api.fitPlan = mock(() => Promise.reject(new Error("offline"))) as typeof api.fitPlan;
    try {
      const { result } = renderHook(() => useFitPlan("https://huggingface.co/atlas/model.gguf", undefined));
      await waitFor(() => expect(result.current.state).toBe("failed"));
      expect(result.current.response).toBeNull();
    } finally { api.fitPlan = original; }
  });

  test("a rejected request is evicted so a new user can retry", async () => {
    const original = api.fitPlan;
    const fitPlan = mock()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(answer);
    api.fitPlan = fitPlan as typeof api.fitPlan;
    try {
      const first = renderHook(() => useFitPlan("https://huggingface.co/atlas/model.gguf", undefined));
      await waitFor(() => expect(first.result.current.state).toBe("failed"));
      first.unmount();
      const second = renderHook(() => useFitPlan("https://huggingface.co/atlas/model.gguf", undefined));
      await waitFor(() => expect(second.result.current.state).toBe("ready"));
      expect(fitPlan).toHaveBeenCalledTimes(2);
    } finally { api.fitPlan = original; }
  });

  test("a null plan is evicted so a new user asks again", async () => {
    const original = api.fitPlan;
    const unavailable: FitPlanResponse = { plan: null, wording: { verdict: "unknown", headline: "Unavailable", detail: "Try again." } };
    const fitPlan = mock()
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(answer);
    api.fitPlan = fitPlan as typeof api.fitPlan;
    try {
      const first = renderHook(() => useFitPlan("https://huggingface.co/atlas/model.gguf", undefined));
      await waitFor(() => expect(first.result.current.state).toBe("ready"));
      first.unmount();
      const second = renderHook(() => useFitPlan("https://huggingface.co/atlas/model.gguf", undefined));
      await waitFor(() => expect(second.result.current.response).toEqual(answer));
      expect(fitPlan).toHaveBeenCalledTimes(2);
    } finally { api.fitPlan = original; }
  });

  test("a real plan remains cached for a new user", async () => {
    const original = api.fitPlan;
    const fitPlan = mock(() => Promise.resolve(answer));
    api.fitPlan = fitPlan as typeof api.fitPlan;
    try {
      const first = renderHook(() => useFitPlan("https://huggingface.co/atlas/model.gguf", undefined));
      await waitFor(() => expect(first.result.current.state).toBe("ready"));
      first.unmount();
      const second = renderHook(() => useFitPlan("https://huggingface.co/atlas/model.gguf", undefined));
      await waitFor(() => expect(second.result.current.state).toBe("ready"));
      expect(fitPlan).toHaveBeenCalledTimes(1);
    } finally { api.fitPlan = original; }
  });
});
