// Bring a song to split into stems. The other edits of a brought song (style, vocals, another household voice) are chips of the Music composer.
import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { BringSong } from "@/shell/pages/BringSong";

const oldFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = oldFetch; });

test("a brought file is uploaded and split into stems; no other action is offered", async () => {
  const calls: Array<{ url: string; body?: unknown }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body instanceof FormData || !init?.body ? undefined : JSON.parse(String(init.body)) });
    if (url.includes("/api/library/upload")) return Response.json({ id: "file-audio1", name: "song.m4a" });
    if (url.includes("/api/music/from-file/edit")) return Response.json({ id: "music-job1" });
    return Response.json({}, { status: 404 });
  }) as typeof fetch;
  const view = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><BringSong /></MemoryRouter></QueryClientProvider>);
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(["song"], "song.m4a", { type: "audio/mp4" })] } });
  await view.findByText("song.m4a");
  expect(view.queryByRole("button", { name: "Change the style" })).toBeNull();
  expect(view.queryByRole("combobox")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Split into stems" }));
  await waitFor(() => expect(calls.some((call) => call.url.includes("/api/music/from-file/edit"))).toBe(true));
  expect(calls.find((call) => call.url.includes("/api/music/from-file/edit"))?.body).toEqual({ file_id: "file-audio1", change: "stems" });
});

test("a file that is not a song gets the plain supported-file line", async () => {
  const view = render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><BringSong /></MemoryRouter></QueryClientProvider>);
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(["bad"], "notes.txt", { type: "text/plain" })] } });
  expect(await view.findByText("Add one audio file under 40 MB: mp3, m4a, wav, aac, ogg or flac.")).toBeTruthy();
});
