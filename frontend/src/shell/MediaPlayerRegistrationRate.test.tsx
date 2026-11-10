// PODCAST-RATE-01: a speed picked while a podcast is docked is saved for its show once, and a speed equal to the saved one is not sent again.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { render, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MediaPlayerRegistration } from "@/shell/MediaPlayerRegistration";
import { AudioSessionProvider } from "@/shell/audioSessionContext";

afterEach(() => cleanup());

describe("docked podcast speed", () => {
  test("saves a new speed for the show and skips the one already saved", async () => {
    const patch = mock(async () => ({ ok: true as const, show_id: "s1", rate: 1.5 }));
    const origPatch = api.patchShowRate;
    const origData = api.appData;
    (api as { patchShowRate: unknown }).patchShowRate = patch;
    (api as { appData: unknown }).appData = async () => ({ id: "e1", title: "Ep", channel: null, poster: null, duration_s: 60, chapters: [], show_id: "s1", show_rate: 1.25 });
    const el = document.createElement("audio");
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><AudioSessionProvider personId="p1"><MediaPlayerRegistration appId="podcasts" mediaId="e1" element={el} /></AudioSessionProvider></QueryClientProvider>);
    await waitFor(() => expect(api.appData).toBeDefined());
    await new Promise((r) => setTimeout(r, 50));
    el.playbackRate = 1.25; el.dispatchEvent(new Event("ratechange"));
    expect(patch).not.toHaveBeenCalled();
    el.playbackRate = 1.5; el.dispatchEvent(new Event("ratechange"));
    el.dispatchEvent(new Event("ratechange"));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith("s1", 1.5);
    (api as { patchShowRate: unknown }).patchShowRate = origPatch;
    (api as { appData: unknown }).appData = origData;
  });
});
