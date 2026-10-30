import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { PerformanceSettings } from "@/apps/settings/PerformanceSettings";
import { PRESET_VALUES, currentPreset } from "@/apps/settings/performanceModel";

const realFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

function serve(stored: Record<string, unknown>) {
  const puts: { key: string; value: unknown }[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const path = (typeof input === "string" ? input : input.toString()).split("?")[0]!;
    if (path.endsWith("/api/performance/apps")) return Promise.resolve(Response.json({ installed: false, apps: [] }));
    if (path.endsWith("/api/settings") && init?.method === "PUT") { const body = JSON.parse(String(init.body)); puts.push({ key: body.key, value: body.value }); stored[body.key] = body.value; return Promise.resolve(Response.json({ key: body.key, value: body.value })); }
    if (path.endsWith("/api/settings")) return Promise.resolve(Response.json(Object.entries(stored).map(([key, value]) => ({ key, value, scope: "household" }))));
    return Promise.resolve(Response.json({}));
  }) as typeof fetch;
  return puts;
}

describe("currentPreset", () => {
  test("a preset's own values read as that preset and any difference reads as custom", () => {
    expect(currentPreset((key) => PRESET_VALUES.balanced[key])).toBe("balanced");
    expect(currentPreset((key) => key === "resources.quiet_seconds" ? 45 : PRESET_VALUES.balanced[key])).toBe("custom");
  });
});

describe("PerformanceSettings", () => {
  test("choosing a preset writes its values and then the preset", async () => {
    const puts = serve({ ...PRESET_VALUES.chat_first });
    const view = renderWithQueryClient(<PerformanceSettings {...({} as Parameters<typeof PerformanceSettings>[0])} />);
    fireEvent.click(await view.findByLabelText("Big jobs first"));
    await waitFor(() => expect(puts.at(-1)).toEqual({ key: "resources.preset", value: "big_jobs_first" }));
    expect(puts.find((put) => put.key === "resources.quiet_seconds")?.value).toBe(20);
  });
  test("the first view shows no numbers and Custom appears when a value differs", async () => {
    serve({ ...PRESET_VALUES.chat_first, "resources.quiet_seconds": 45 });
    const view = renderWithQueryClient(<PerformanceSettings {...({} as Parameters<typeof PerformanceSettings>[0])} />);
    await view.findByText("Custom");
    expect(view.container.textContent).not.toMatch(/\d/);
  });
  test("Always close: the starter list is saved as one change and states its effect", async () => {
    const puts = serve({});
    const view = renderWithQueryClient(<PerformanceSettings {...({} as Parameters<typeof PerformanceSettings>[0])} />);
    const always = await view.findByTestId("close-apps-always");
    fireEvent.click(always.querySelector("button")!);
    await view.findByTestId("close-apps-always-effect");
    expect(JSON.parse(String(puts.find((put) => put.key === "resources.close_apps.always")?.value))).toContain("com.apple.Safari");
  });
  test("Customize opens the profile table and a change marks the page Custom", async () => {
    const puts = serve({ ...PRESET_VALUES.chat_first });
    const view = renderWithQueryClient(<PerformanceSettings {...({} as Parameters<typeof PerformanceSettings>[0])} />);
    fireEvent.click(await view.findByText("Customize"));
    fireEvent.click(await view.findByLabelText("Move Video up"));
    await waitFor(() => expect(puts.map((put) => put.key)).toContain("resources.preset"));
    expect(puts.find((put) => put.key === "resources.preset")?.value).toBe("custom");
    expect(await view.findByTestId("profile-table")).toBeTruthy();
  });
});
