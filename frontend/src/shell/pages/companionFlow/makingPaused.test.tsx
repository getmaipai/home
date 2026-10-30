// ENGINE-STATUS-MEDIA-01 (RULES.md S6, owner's ruling 2026-10-29): while picture or video making cannot take work, the companion
// screens grey out the controls that would ask for it and say why in one line, so nobody presses a button that fails.
import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type CompanionLook, type CompanionStateRow, type CompanionStates } from "@/lib/api";
import { CompanionShellViewer } from "@/lib/companionShells";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import { CompanionFlowPage } from "@/shell/pages/companionFlow/CompanionFlowPage";

const methods = ["health", "settingsValues", "companions", "editCompanion", "createCompanionDraft", "companionLook", "companionStates", "getCompanionLookStyles", "companionLookJob"] as const;
const originals = Object.fromEntries(methods.map((key) => [key, api[key]]));
afterEach(() => { cleanup(); Object.assign(api, originals); });

const line = (thing: string) => ({ adult: `This computer is low on memory, so ${thing} making is paused. It starts again by itself when memory frees up.`, teen: "teen", child: "child", repairs_link: null });
const paused = (thing: string) => ({ kind: "failed", pid: null, alive: false, availability: "unavailable", cause: "memory", notice: line(thing) });
const READY = { kind: "none", pid: null, alive: true, availability: "ready" };
const styles = [{ id: "cartoon", label: "Cartoon" }];
const version = { id: "v-1", label: "Picture", source: "generated" as const, width: 1024, height: 1024, created_at: "2026-10-29T12:00:00Z", from: null, url: "/portrait.png" };
const look = (versions: typeof version[]): CompanionLook => ({ versions, rest: versions[0]?.id ?? null, key: "#00FF00", sheet: null, ready_for_video: true, start_ready: true, can_generate: true, styles, keep: { id: "keep", label: "Keep as is" }, audience_cap: "all" });
const row = (id: string, required: boolean): CompanionStateRow => ({ id, label: id[0]!.toUpperCase() + id.slice(1), kind: "loop", required, when_it_plays: "", default_motion: "", motion: "", approved: null, takes: [], busy: false, keyframe: null, clip_out_of_date: false, status: "missing" });
const states: CompanionStates = { sheet_ready: true, start_ready: true, key: "#00FF00", states: [row("idle", true), row("sad", false)], run: null, counts: { approved: 0, total: 2, required_missing: [] } };

function open(path: string, engines: { image: unknown; video: unknown }, versions: typeof version[] = []) {
  api.health = async () => ({ brain: "stack", voice: "stack", ok: true, uptimeSeconds: 1, sidecars: [], engines: { chat: READY, embed: READY, background: READY, voice: READY, ...engines } }) as never;
  api.settingsValues = async () => [] as never;
  api.companions = async () => ({ allowed: true, can_create: true, can_discover: false, default_id: "x", companions: [], discover: [], robots: null });
  api.editCompanion = async () => ({ id: "hc-one", name: "Marlow" }) as never;
  api.createCompanionDraft = async () => ({ id: "hc-one" });
  api.getCompanionLookStyles = async () => ({ styles, keep: { id: "keep" as const, label: "Keep as is" } });
  api.companionLook = async () => look(versions);
  api.companionStates = async () => states;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><WakeWordPersonContext.Provider value={{ role: "adult", age_band: "adult" } as never}><CompanionShellViewer.Provider value={{ id: "person-sage" } as never}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/companions/create" element={<CompanionFlowPage />} /><Route path="/companions/:id/create" element={<CompanionFlowPage />} />
  </Routes></MemoryRouter></CompanionShellViewer.Provider></WakeWordPersonContext.Provider></QueryClientProvider>);
}
const button = (view: ReturnType<typeof open>, name: string) => view.getByRole("button", { name }) as HTMLButtonElement;

test("screen 1: Generate Character and the photo upload are greyed out with the one line while pictures are paused", async () => {
  const view = open("/companions/create", { image: paused("picture"), video: READY });
  const name = await view.findByLabelText("Character name"); fireEvent.change(name, { target: { value: "Marlow" } }); fireEvent.blur(name);
  fireEvent.change(await view.findByLabelText("Describe the character"), { target: { value: "A friendly fox" } });
  const reason = (await view.findAllByText(line("picture").adult))[0]!;
  expect(reason.getAttribute("role")).toBe("status");
  const generate = button(view, "Generate Character");
  expect(generate.disabled).toBe(true);
  expect(generate.getAttribute("aria-describedby")).toBe(reason.id);
  expect(button(view, "Approve & Continue").disabled).toBe(true);
  fireEvent.click(view.getByRole("radio", { name: "Upload Photo" }));
  await waitFor(() => expect((view.getByLabelText("Photo") as HTMLInputElement).disabled).toBe(true));
});

test("screen 1: the same controls work again once pictures are ready", async () => {
  const view = open("/companions/create", { image: READY, video: READY });
  const name = await view.findByLabelText("Character name"); fireEvent.change(name, { target: { value: "Marlow" } }); fireEvent.blur(name);
  fireEvent.change(await view.findByLabelText("Describe the character"), { target: { value: "A friendly fox" } });
  await waitFor(() => expect(button(view, "Generate Character").disabled).toBe(false));
  expect(view.queryByText(line("picture").adult)).toBeNull();
});

test("animation screen: Generate Required, Generate Optional and Make another wait for the video engine", async () => {
  const view = open("/companions/hc-one/create?step=2", { image: READY, video: paused("video") }, [version]);
  await view.findByText(line("video").adult);
  expect(button(view, "Generate Required").disabled).toBe(true);
  fireEvent.click(button(view, "Idle"));
  expect(button(view, "Make another").disabled).toBe(true);
  expect(button(view, "Edit keyframe").disabled).toBe(false);
});

test("animation screen: Edit keyframe waits for the picture engine", async () => {
  const view = open("/companions/hc-one/create?step=2", { image: paused("picture"), video: READY }, [version]);
  await view.findAllByText(line("picture").adult);
  fireEvent.click(await view.findByRole("button", { name: "Idle" }));
  expect(button(view, "Edit keyframe").disabled).toBe(true);
  expect(button(view, "Make another").disabled).toBe(false);
});
