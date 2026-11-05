import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { BringSong } from "@/shell/pages/BringSong";

const oldFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = oldFetch; });
function open(adult: boolean, posted: Array<{ url: string; body?: unknown }>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); const body = init?.body instanceof FormData ? undefined : init?.body ? JSON.parse(String(init.body)) : undefined;
    posted.push({ url, body });
    if (url.includes("/api/voice/cloned")) return Response.json({ voices: [{ id: "voice-nova1", label: "Nova", creatorId: "p1", creatorName: "Sage", bytes: 10, createdAt: "2026-01-01" }] });
    if (url.includes("/api/library/upload")) return Response.json({ id: "file-audio1", name: "song.m4a" });
    if (url.includes("/api/music/from-file/edit")) return Response.json({ id: "music-job1" });
    return Response.json({}, { status: 404 });
  }) as typeof fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><BringSong adult={adult} /></MemoryRouter></QueryClientProvider>);
}
async function upload(view: ReturnType<typeof open>) {
  const input = view.container.querySelector('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [new File(["song"], "song.m4a", { type: "audio/mp4" })] } });
  await view.findByText("song.m4a");
}

test("voice swap action is adult-only and posts the selected household voice", async () => {
  const calls: Array<{ url: string; body?: unknown }> = [];
  const adult = open(true, calls); await upload(adult);
  const chooser = await adult.findByRole("combobox", { name: "Household voice" });
  fireEvent.click(chooser);
  fireEvent.click(await adult.findByRole("option", { name: "Nova" }));
  fireEvent.click(adult.getByRole("button", { name: "Sing it in another voice" }));
  await waitFor(() => expect(calls.some((call) => call.url.includes("/api/music/from-file/edit"))).toBe(true));
  expect(calls.find((call) => call.url.includes("/api/music/from-file/edit"))?.body).toEqual({ file_id: "file-audio1", change: "voice_swap", voice: "voice-nova1" });
  cleanup();
  const childCalls: Array<{ url: string; body?: unknown }> = [];
  const child = open(false, childCalls); await upload(child);
  expect(child.queryByText("Sing it in another voice")).toBeNull();
  expect(child.queryByRole("combobox", { name: "Household voice" })).toBeNull();
});
