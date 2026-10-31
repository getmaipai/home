import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { PerformanceStep } from "@/apps/setup/PerformanceStep";
import { PRESET_VALUES } from "@/apps/settings/performanceModel";

const realFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

describe("PerformanceStep", () => {
  test("choosing a preset writes its values and the preset key", async () => {
    const puts: Record<string, unknown> = {};
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const path = (typeof input === "string" ? input : input.toString()).split("?")[0]!;
      if (path.endsWith("/api/settings") && init?.method === "PUT") { const body = JSON.parse(String(init.body)); puts[body.key] = body.value; return Promise.resolve(Response.json({ key: body.key, value: body.value })); }
      if (path.endsWith("/api/settings")) return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json({}));
    }) as typeof fetch;
    const view = renderWithQueryClient(<PerformanceStep />);
    fireEvent.click(await view.findByLabelText("Chat first"));
    await waitFor(() => expect(puts["resources.preset"]).toBe("chat_first"));
    for (const [key, value] of Object.entries(PRESET_VALUES.chat_first)) expect(puts[key]).toEqual(value);
  });
});
