// STACK-LORAS-01 slice 4: the Styles tab is the shared Styles page over Home's pass-through (`/api/loras/stack/*`). The server redacts; these prove the wiring:
// each client method is one pass-through call, the page draws the list it is sent (one locked tile, no adult-only name), and a refusal shows the Stack's sentence.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StackClientError } from "@maipai/ui/src/stack/StackClient";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";
import { StylesTab } from "@/apps/settings/styles/StylesTab";
import { createHomeLorasClient } from "@/lib/stackLorasClient";
import { makePerson } from "@/shell/pages/settings/settingsTestKit";

afterEach(cleanup);
const realFetch = globalThis.fetch;
let wire: Array<{ method: string; path: string; body: unknown }> = [];
let list: unknown = { loras: [], trash_days: 30 };
let refuse: { status: number; error: string; code: string } | null = null;

const style = { id: "lora-aaaaaaaaaaaaaaaa", media: "video", name: "Clay animation", base_model: "ltx-2.5", classification: "all-ages", sha256: "a".repeat(64), bytes: 310_000_000, strength_default: 1, trigger_words: ["clay"], licence: "apache-2.0", source_url: null, added_by: null, added_at: "2026-11-01T00:00:00.000Z", disk_id: null, disk_label: "This computer", status: "ready", status_note: null, removed_at: null, trash_until: null, preview: null };

beforeEach(() => {
  wire = []; refuse = null; list = { loras: [style, { locked: true }], trash_days: 30 };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
    const method = init?.method ?? "GET"; const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    if (url.pathname.startsWith("/api/ai/stack/")) return Response.json(url.pathname.endsWith("/disks") ? { disks: [] } : {});
    wire.push({ method, path: `${url.pathname}${url.search}`, body });
    if (refuse) return Response.json({ error: refuse.error, code: refuse.code }, { status: refuse.status });
    if (method === "GET" && url.pathname === "/api/loras/stack") return Response.json(url.search.includes("removed=true") ? { loras: [], trash_days: 30 } : list);
    if (url.pathname.includes("/jobs/")) return Response.json({ id: "job-1", state: "running", percent: 10, status: "Downloading", reason: null });
    return Response.json({ job: "job-1", ok: true, purged: false, sources: [], hits: [] });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("the Home client for styles", () => {
  test("each method is one pass-through call with the Stack's own body", async () => {
    const loras = createHomeLorasClient().loras!;
    await loras.list();
    await loras.list({ removed: true });
    await loras.patch("lora-aaaaaaaaaaaaaaaa", { name: "Clay", classification: "all-ages", ticket: "t" });
    await loras.remove("lora-aaaaaaaaaaaaaaaa");
    await loras.remove("lora-aaaaaaaaaaaaaaaa", true);
    await loras.restore("lora-aaaaaaaaaaaaaaaa");
    await loras.move("lora-aaaaaaaaaaaaaaaa", "usb-1");
    await loras.install({ media: "video", source: "civitai", url: "https://civitai.com/api/download/models/1", name: "Clay" });
    await loras.sources();
    await loras.setKey("civitai", "k");
    await loras.search("huggingface", "clay style");
    await loras.job!("job-1");
    expect(wire.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/loras/stack", "GET /api/loras/stack?removed=true", "PATCH /api/loras/stack/lora-aaaaaaaaaaaaaaaa", "DELETE /api/loras/stack/lora-aaaaaaaaaaaaaaaa", "DELETE /api/loras/stack/lora-aaaaaaaaaaaaaaaa?purge=true",
      "POST /api/loras/stack/lora-aaaaaaaaaaaaaaaa/restore", "POST /api/loras/stack/lora-aaaaaaaaaaaaaaaa/move", "POST /api/loras/stack/install", "GET /api/loras/stack/sources", "PUT /api/loras/stack/sources/civitai/key",
      "GET /api/loras/stack/sources/huggingface/search?q=clay%20style", "GET /api/loras/stack/jobs/job-1",
    ]);
    expect(wire[2]!.body).toEqual({ name: "Clay", classification: "all-ages", ticket: "t" });
    expect(wire[6]!.body).toEqual({ disk_id: "usb-1" });
    expect(createHomeLorasClient().loras!.previewUrl!("lora-aaaaaaaaaaaaaaaa")).toBe("/api/loras/stack/lora-aaaaaaaaaaaaaaaa/preview");
  });

  test("a refusal is the Stack's sentence and code, not Home's", async () => {
    refuse = { status: 403, error: "Open the adult lock in Home again, then try again.", code: "ticket_refused" };
    const error = await createHomeLorasClient().loras!.patch("lora-aaaaaaaaaaaaaaaa", { classification: "all-ages", ticket: "x" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StackClientError);
    expect(error).toMatchObject({ message: "Open the adult lock in Home again, then try again.", code: "ticket_refused" });
  });
});

describe("the tab", () => {
  test("draws the list it is sent: the style, and one quiet locked tile that carries no name", async () => {
    const view = renderWithQueryClient(<MemoryRouter><StylesTab person={makePerson("owner")} /></MemoryRouter>);
    expect(await view.findByText("Clay animation")).toBeTruthy();
    expect(view.getByTestId("styles-tab")).toBeTruthy();
    expect(within(view.container).queryByText(/Zebraquill/)).toBeNull();
    await waitFor(() => expect(wire.some((call) => call.method === "GET" && call.path === "/api/loras/stack")).toBe(true));
  });
});
