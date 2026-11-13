import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { createElement } from "react";
import { makeSongBody, songAddress } from "./MakeSongPage";
import { MusicStudioPage, createBody, editPath, isStudioPage } from "./MusicStudioPages";
import { stemsAddress, studioAddress } from "./MusicWorkspacePage";
import manifest from "../../../../backend/packages/audio/manifest.json";

describe("music studio pages", () => {
  test("only the music app's studio pages are ours", () => {
    expect(isStudioPage("audio", "make-album")).toBe(true);
    expect(isStudioPage("audio", "make-song")).toBe(true);
    expect(isStudioPage("audio", "browse")).toBe(false);
    expect(isStudioPage("books", "create")).toBe(false);
  });
  test("each Make page is a mode of the one composer: the address names the mode and keeps the rest of the query", () => {
    const where = (pageId: string, search: string): string => {
      const Here = () => { const location = useLocation(); return createElement("p", { "data-testid": "here" }, `${location.pathname}${location.search}`); };
      const view = render(createElement(MemoryRouter, { initialEntries: [`/apps/audio/${pageId}${search}`] }, createElement(Routes, null,
        createElement(Route, { path: "/apps/audio/create", element: createElement(Here) }),
        createElement(Route, { path: "/apps/audio/:page", element: createElement(MusicStudioPage, { pageId, search, adult: true }) }))));
      const text = view.getByTestId("here").textContent ?? "";
      view.unmount();
      return text;
    };
    expect(where("make-band", "")).toBe("/apps/audio/create?make=band");
    expect(where("make-album", "?style=s1")).toBe("/apps/audio/create?style=s1&make=album");
    expect(where("make-style", "")).toBe("/apps/audio/create?make=song_style");
    expect(where("sound-effects", "")).toBe("/apps/audio/create?make=sound");
    expect(where("make-song", "?band=b1")).toBe("/apps/audio/create?band=b1");
    expect(isStudioPage("audio", "sound-effects")).toBe(true);
  });
  test("edit address names the kind and the id", () => {
    expect(editPath("album", "malbum-abc")).toBe("/apps/audio/edit?kind=album&id=malbum-abc");
  });
  test("a made album starts empty with its sound as the style", () => {
    const body = createBody("album", { title: " Porch Light ", sound: "dreamy synth pop" });
    expect(body.title).toBe("Porch Light");
    expect(body.track_media_ids).toEqual([]);
    expect((body.style as { description: string }).description).toBe("dreamy synth pop");
  });
  test("a band with no sound still gets a style line", () => {
    const body = createBody("band", { name: "Clover Lane" });
    expect((body.style as { description: string }).description.length).toBeGreaterThan(0);
  });
  test("Make sends only what was filled in", () => {
    const empty = { idea: " a rainy folk song ", lyrics: "", instrumental: false, title: "", length: "" as const, bpm: "", key: "", styleId: null, bandId: null };
    expect(makeSongBody(empty)).toEqual({ idea: "a rainy folk song" });
    const full = makeSongBody({ ...empty, lyrics: "[Verse] hi", title: " Rain ", length: "quick", bpm: "92.4", key: "C major", styleId: "s1", bandId: "b1" });
    expect(full).toEqual({ idea: "a rainy folk song", lyrics: "[Verse] hi", title: "Rain", length: "quick", bpm: 92, key: "C major", song_style: "s1", band: "b1" });
  });
  test("instrumental drops the lyrics", () => {
    const body = makeSongBody({ idea: "calm piano", lyrics: "la la", instrumental: true, title: "", length: "", bpm: "", key: "", styleId: null, bandId: null });
    expect(body).toEqual({ idea: "calm piano", instrumental: true });
  });
  test("a made song has its own address", () => {
    expect(songAddress("a b")).toBe("/apps/audio/create?song=a%20b");
  });
  test("stems opens the studio and asks for the split", () => {
    expect(stemsAddress("a b")).toContain("split=1");
    expect(studioAddress("a b")).not.toContain("split=1");
  });
  test("the sidebar lists each destination once and no make-* page", () => {
    const pages = manifest.contributes.pages as { id: string; nav?: boolean }[];
    const shown = pages.filter((page) => page.nav !== false).map((page) => page.id);
    expect(new Set(shown).size).toBe(shown.length);
    expect(shown.filter((id) => id.startsWith("make-"))).toEqual([]);
    for (const id of ["create", "studio", "stems", "remix", "creations"]) expect(shown).toContain(id);
  });
});
