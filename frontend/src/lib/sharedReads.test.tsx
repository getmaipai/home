import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { api } from "@/lib/api";
import { createQueryClient } from "@/lib/queryClient";
import { useEase } from "@/shell/useEase";
import { useLookValue } from "@/shell/useLookSetting";
import { useAppearance } from "@/shell/useAppearance";
import { usePinnedApps } from "@/shell/usePinnedApps";
import { useReasoningOpen, resetReasoningOpenForTests } from "@/apps/chat/useReasoningOpen";

afterEach(() => { cleanup(); mock.restore(); resetReasoningOpenForTests(); });

function Consumers({ id }: { id: string }) {
  useEase(id);
  useLookValue(id);
  useAppearance(id);
  usePinnedApps(id);
  useReasoningOpen({ id });
  return <span>mounted</span>;
}

describe("AUDIT-UI-01 request storm: one key and one request per endpoint", () => {
  test("five consumers of the person settings fetch them once", async () => {
    const values = spyOn(api, "settingsValues").mockResolvedValue([] as never);
    const view = render(<QueryClientProvider client={createQueryClient()}><MemoryRouter><Consumers id="sage" /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(view.getByText("mounted")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(values.mock.calls.filter(([scope]) => scope === "person:sage")).toHaveLength(1);
  });

  test("a second mount inside the freshness window reuses the reads, a write refreshes at once", async () => {
    const values = spyOn(api, "settingsValues").mockResolvedValue([] as never);
    const client = createQueryClient();
    const mountOnce = () => render(<QueryClientProvider client={client}><MemoryRouter><Consumers id="sage" /></MemoryRouter></QueryClientProvider>);
    const first = mountOnce();
    await waitFor(() => expect(values.mock.calls.length).toBeGreaterThan(0));
    first.unmount();
    mountOnce();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(values.mock.calls.filter(([scope]) => scope === "person:sage")).toHaveLength(1);
    await client.invalidateQueries({ queryKey: ["settings-values", "person:sage"] });
    await waitFor(() => expect(values.mock.calls.filter(([scope]) => scope === "person:sage")).toHaveLength(2));
  });

  test("health, install, jobs, plugins, tour progress and companions share a freshness window by key", () => {
    const client = createQueryClient();
    for (const key of [["settings-values", "person:x"], ["health"], ["install-status"], ["jobs"], ["plugins"], ["tours-progress"], ["companions"]]) {
      const stale = (client.getQueryDefaults(key) as { staleTime?: number }).staleTime;
      expect(typeof stale === "number" && stale > 0).toBe(true);
    }
    expect((client.getQueryDefaults(["settings-values", "person:x"]) as { staleTime?: number }).staleTime).toBe(5_000);
    expect((client.getQueryDefaults(["health"]) as { staleTime?: number }).staleTime).toBe(2_000);
  });
});
