// ONE-COMPOSER-2026-11-13 (COMPOSER-03): the Home ask box draws the modes the hub lists, keeps the chosen mode through to its Create page,
// shows the engine's S6 line (from the live health query) disabled, and has no hard-coded mode list.
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { api } from "@/lib/api";
import { AskBox } from "@/shell/pages/dashboard/AskBox";
import { COMPOSER_MODES_KEY, composerHref, type ComposerModesResponse } from "@/shell/composer/composerModes";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";

const spies: Array<{ mockRestore: () => void }> = [];
afterEach(() => { cleanup(); while (spies.length) spies.pop()!.mockRestore(); });

const mode = (over: Partial<ComposerModesResponse["modes"][number]> & { id: string; label: string }): ComposerModesResponse["modes"][number] => ({
  icon: "image", route: null, engine: null, placeholder: "Ask anything", references: [], chips: [], presets: null, tools: [], primary: { label: "Send" }, quality: null, availability: null, disabledReason: null, ...over,
});
const ASK = mode({ id: "ask", label: "Ask", icon: "message-circle" });
const PICTURE = mode({
  id: "picture", label: "Picture", route: "/apps/image/create", engine: "image", placeholder: "Describe the picture you want.", primary: { label: "Make picture" },
  chips: [
    { id: "shape", label: "Shape", group: "Settings", default: "square", options: [{ value: "square", label: "Square" }, { value: "landscape", label: "Landscape" }] },
    { id: "count", label: "Pictures", group: "Settings", default: 1, options: [{ value: 1, label: "1 picture" }, { value: 2, label: "2 pictures" }] },
  ],
});
const VIDEO = mode({ id: "video", label: "Video", icon: "film", route: "/apps/video/create", engine: "video", placeholder: "Describe the video you want.", primary: { label: "Generate" } });
const adult: ComposerModesResponse = { band: "adult", modes: [ASK, PICTURE, VIDEO] };
const child: ComposerModesResponse = { band: "child", modes: [ASK, PICTURE] };

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p>; }
function setup(response: ComposerModesResponse, health?: unknown) {
  // The hub's answer comes through the same api call the page makes, so another test's stubbed fetch cannot replace it.
  spies.push(spyOn(api, "composerModes").mockResolvedValue(response));
  const view = renderWithQueryClient(<MemoryRouter><AskBox /><Where /></MemoryRouter>);
  view.queryClient.setQueryData(COMPOSER_MODES_KEY, response);
  if (health) { spies.push(spyOn(api, "health").mockResolvedValue(health as never)); view.queryClient.setQueryData(["health"], health); }
  return view;
}

describe("the Home ask box reads its modes from the hub", () => {
  test("composerHref keeps the mode's page, the words and every chip value", () => {
    expect(composerHref(null, "  hello world ")).toBe("/chat?ask=hello%20world");
    expect(composerHref("/apps/image/create", "a red fox", { shape: "landscape", count: 2 })).toBe("/apps/image/create?prompt=a+red+fox&shape=landscape&count=2");
  });

  test("an answer that is not a mode list reads as Ask alone, never a crash", async () => {
    const view = setup({} as ComposerModesResponse);
    fireEvent.click(view.container.querySelector('[data-slot="prompt-bar"] button[aria-haspopup]')!);
    await waitFor(() => expect(view.getAllByRole("option").map((o) => o.textContent)).toEqual(["Ask"]));
  });

  test("a child's list has no Video mode in the menu", async () => {
    const view = setup(child);
    fireEvent.click(view.container.querySelector('[data-slot="prompt-bar"] button[aria-haspopup]')!);
    await waitFor(() => expect(view.getAllByRole("option").map((o) => o.textContent)).toEqual(["Ask", "Picture"]));
  });

  test("the chosen mode and its chips reach Create with the words", async () => {
    const view = setup(adult);
    fireEvent.click(view.container.querySelector('[data-slot="prompt-bar"] button[aria-haspopup]')!);
    fireEvent.click(await view.findByText("Picture"));
    const field = view.getByLabelText("Ask") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "a red fox" } });
    fireEvent.click(view.getByLabelText("Make picture"));
    await waitFor(() => expect(view.getByTestId("where").textContent).toBe("/apps/image/create?prompt=a+red+fox&shape=square&count=1"));
  });

  test("a picture preset pick is a setting: the words stay, and the pick rides to Create (CREATOR-13)", async () => {
    const withPresets: ComposerModesResponse = { band: "adult", modes: [ASK, mode({
      ...PICTURE,
      presets: { label: "Presets", chips: [{ id: "light", label: "Light", target: "setting", default: "none", options: [{ value: "none", label: "None", text: "" }, { value: "mtpl-lightgolden", label: "Golden hour", text: "" }] }] },
    })] };
    const view = setup(withPresets);
    fireEvent.click(view.container.querySelector('[data-slot="prompt-bar"] button[aria-haspopup]')!);
    fireEvent.click(await view.findByText("Picture"));
    fireEvent.change(view.getByLabelText("Ask"), { target: { value: "a red fox" } });
    fireEvent.click(await view.findByText("Presets"));
    fireEvent.click(await view.findByText("Light"));
    fireEvent.click(await view.findByText("Golden hour"));
    expect((view.getByLabelText("Ask") as HTMLTextAreaElement).value).toBe("a red fox");
    fireEvent.click(view.getByLabelText("Make picture"));
    await waitFor(() => expect(view.getByTestId("where").textContent).toContain("light=mtpl-lightgolden"));
  });

  test("a mode whose engine is not ready shows the health row's line and Send stays off", async () => {
    const view = setup(adult, {
      brain: "x", voice: "stack", ok: true, uptimeSeconds: 1, sidecars: [],
      engines: {
        chat: { kind: "none", pid: null, alive: true, availability: "ready", reason: null }, embed: { kind: "none", pid: null, alive: true }, background: { kind: "none", pid: null, alive: true }, voice: { kind: "none", pid: null, alive: true },
        image: { kind: "failed", pid: null, alive: false, availability: "unavailable", reason: "not_installed", cause: "not_installed", notice: { adult: "Picture making isn't set up on this computer yet. An owner can add it in Settings, Pictures and videos.", teen: "t", child: "c", repairs_link: null } },
      },
    });
    fireEvent.click(view.container.querySelector('[data-slot="prompt-bar"] button[aria-haspopup]')!);
    fireEvent.click(await view.findByText("Picture"));
    fireEvent.change(view.getByLabelText("Ask"), { target: { value: "a red fox" } });
    await waitFor(() => expect(view.getByText("Picture making isn't set up on this computer yet. An owner can add it in Settings, Pictures and videos.")).toBeTruthy());
    fireEvent.click(view.getByLabelText("Make picture"));
    expect(view.getByTestId("where").textContent).toBe("/");
  });
});
