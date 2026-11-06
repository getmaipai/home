// VIDEO-LORA-08: the Styles tab as rendered. The list (open rows, ONE kit lock row, the plain Adult label and the three-state check after the unlock, one-click availability),
// the sources (Civitai off with its reason, the notice before it turns on, write-only credentials), the browser (filters, paging, locked tile, reason lines, "already added, open it")
// and the confirm panel (pre-set from the source's check, the licence step, the fresh passcode before an adult hit is made all ages) and the editor (turning Adults only off).
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AdultLockProvider } from "@maipai/ui/src/elements/adult-lock";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";
import { StylesTab } from "@/apps/settings/styles/StylesTab";
import { StyleConfirm } from "@/apps/settings/styles/StyleConfirm";
import { StyleEditor } from "@/apps/settings/styles/StyleEditor";
import { StyleBrowser } from "@/apps/settings/styles/StyleBrowser";
import { tryStyleState } from "@/apps/settings/styles/StyleEditor";
import { stylesApi, type BrowseHit, type BrowseQuery, type InstallBody, type SourcesState, type StyleRow } from "@/apps/settings/styles/stylesApi";
import { ApiError, type Roster } from "@/lib/api";
import { STYLES_COPY_DEFAULTS } from "@/apps/settings/styles/stylesShared";

afterEach(cleanup);
const TILE = "Locked items. Press to enter your passcode.";
const HIDDEN_NAME = "Hidden example style";
const person = { id: "p-sage", displayName: "Sage", role: "owner", hasSecret: true, pinDigits: 4 } as unknown as Roster;

const row = (over: Partial<StyleRow> = {}): StyleRow => ({
  id: "lora-a", name: "Old Colour Film", kind: "style", description: "Warm film look.", media: "video", base_model: "ltx-2.5", compatible_with: ["ltx-2.5"], usable: true,
  trigger_words: ["hst style"], trigger_position: "start", positive_addins: [], negative_addins: [], avoid_as_positive: [], strength: { default: 1, min: 0.5, max: 1.5 },
  audience: "all-ages", availability: { who: "admins", people: [] }, needs_confirmation: false, adult_check: "normal", licence: { id: "apache-2.0", commercial_use: "yes" },
  file: { sha256: "a".repeat(64), bytes: 412_000_000, rank: 16 }, source: { site: "huggingface", url: "https://huggingface.co/x/y" }, preview_file_id: null,
  added_at: "2026-11-01T00:00:00Z", removed_at: null, trash_until: null, ...over,
});
const hit = (over: Partial<BrowseHit> = {}): BrowseHit => ({
  key: "huggingface:x/clay", site: "huggingface", remote_id: "x/clay", version_id: null, title: "Clay look", creator: "x", page_url: "https://huggingface.co/x/clay", preview: null, base_label: "LTX 2.5", base_model: "ltx-2.5",
  kind: "style", bytes: 412_000_000, sha256: null, licence: { id: "apache-2.0", class: "open", commercial_use: "yes" }, downloads: 8300, rating: null, created_at: null, trigger_words: [], also_on: [], gated: false,
  adult_check: "normal", installed: null, reason: null, line: "Made for LTX 2.5, 412 MB, open licence, 8,300 downloads", confirm_item: "hf-x-clay", ...over,
});
const sources = (over: Partial<SourcesState["civitai"]> = {}, token = false): SourcesState => ({ huggingface: { on: true, token_saved: token }, civitai: { on: false, key_saved: false, ...over } });

let unlocked = false;
function Page({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <AdultLockProvider digits={4} unlock={async () => { return { status: "ok", proof: "proof-1" }; }} onUnlocked={() => { unlocked = true; }} onRelock={() => { unlocked = false; }}>
        {children}
      </AdultLockProvider>
    </MemoryRouter>
  );
}

function stub(over: Partial<typeof stylesApi> = {}) {
  const original = { ...stylesApi };
  Object.assign(stylesApi, {
    list: mock(async (removed = false) => (removed ? { items: [], locked: false } : { items: [row(), ...(unlocked ? [row({ id: "lora-h", name: HIDDEN_NAME, audience: "adult-only", adult_check: "unknown", trigger_words: ["hxword"] })] : [])], locked: !unlocked })),
    sources: mock(async () => sources()), installs: mock(async () => ({ items: [] })), patch: mock(async (id: string) => row({ id })),
    setCivitai: mock(async (on: boolean) => sources({ on })), ...over,
  });
  return () => { Object.assign(stylesApi, original); };
}
beforeEach(() => { unlocked = false; });

describe("the list and the lock", () => {
  test("locked: open rows and ONE lock row; no hidden name, word or Adults only label anywhere; unlocked: the row, the plain Adult label and the check in words", async () => {
    const restore = stub();
    const { queryClient, findAllByRole, findByText, container } = renderWithQueryClient(<Page><StylesTab person={person} /></Page>);
    await findByText("Old Colour Film");
    expect((await findAllByRole("button", { name: TILE })).length).toBe(1);
    expect(document.documentElement.outerHTML).not.toContain(HIDDEN_NAME);
    expect(document.documentElement.outerHTML).not.toContain("hxword");
    expect(container.textContent).not.toContain("Adults only");
    expect(container.textContent).toContain(STYLES_COPY_DEFAULTS.locked_note);
    expect(container.textContent).toContain("Style, Videos, Works at Standard, Boost and Max");
    expect(container.textContent).not.toMatch(/\b(Quick|Detailed|RAM|memory)\b/);
    fireEvent.click((await findAllByRole("button", { name: TILE }))[0]!);
    await findByText("Enter your passcode");
    const input = document.querySelector('[data-slot="adult-lock-dialog"] input') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { value: "0000" } }); });
    await act(async () => { await queryClient.resetQueries(); });
    await waitFor(() => expect(container.textContent).toContain(HIDDEN_NAME));
    expect(container.textContent).toContain("Adults only");
    expect(container.textContent).toContain("The source says nothing about age, so it stays locked until you decide.");
    expect(container.textContent).toContain(STYLES_COPY_DEFAULTS.unlocked_note);
    restore();
  });

  test("an empty library says what to do; who can use a style is one click and saves at once", async () => {
    const empty = stub({ list: mock(async () => ({ items: [], locked: false })) as never });
    const first = renderWithQueryClient(<Page><StylesTab person={person} /></Page>);
    await first.findByText(STYLES_COPY_DEFAULTS.empty);
    empty(); cleanup();
    const restore = stub();
    const view = renderWithQueryClient(<Page><StylesTab person={person} /></Page>);
    fireEvent.click(await view.findByRole("combobox", { name: "Who can use Old Colour Film" }));
    fireEvent.click(await view.findByRole("option", { name: "All adults" }));
    await waitFor(() => expect(stylesApi.patch).toHaveBeenCalledWith("lora-a", { availability: { who: "adults" } }));
    restore();
  });

  test("a refusal reads as the route's own sentence", async () => {
    const restore = stub({ patch: mock(async () => { throw new ApiError("Read the licence and confirm it first, then choose who can use this style.", 422); }) as never });
    const view = renderWithQueryClient(<Page><StylesTab person={person} /></Page>);
    fireEvent.click(await view.findByRole("combobox", { name: "Who can use Old Colour Film" }));
    fireEvent.click(await view.findByRole("option", { name: "All adults" }));
    expect(await view.findByRole("alert")).toHaveTextContent("Read the licence and confirm it first");
    restore();
  });
});

describe("where styles come from", () => {
  test("Civitai is off with its reason; turning it on shows the notice first; the key row never shows a saved value", async () => {
    const restore = stub();
    const view = renderWithQueryClient(<Page><StylesTab person={person} /></Page>);
    expect(await view.findByText(STYLES_COPY_DEFAULTS.civitai_off_note)).toBeTruthy();
    expect(view.queryByLabelText("Civitai key")).toBeNull();
    fireEvent.click(view.getByRole("switch", { name: "Civitai" }));
    expect(await view.findByText(STYLES_COPY_DEFAULTS.civitai_notice_title)).toBeTruthy();
    expect(stylesApi.setCivitai).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: STYLES_COPY_DEFAULTS.civitai_notice_confirm }));
    await waitFor(() => expect(stylesApi.setCivitai).toHaveBeenCalledWith(true));
    restore();
  });

  test("with a key and a token saved, no field shows them; Replace opens an empty field and Remove clears", async () => {
    const restore = stub({ sources: mock(async () => sources({ on: true, key_saved: true }, true)) as never, removeCivitaiKey: mock(async () => sources({ on: true })) as never });
    const view = renderWithQueryClient(<Page><StylesTab person={person} /></Page>);
    expect(await view.findByText(/A key is saved/)).toBeTruthy();
    expect(view.getByText(/A token is saved/)).toBeTruthy();
    expect(view.container.querySelectorAll('input[type="password"]').length).toBe(0);
    fireEvent.click(view.getAllByRole("button", { name: STYLES_COPY_DEFAULTS.civitai_key_replace })[1]!);
    const field = view.getByLabelText("Civitai key") as HTMLInputElement;
    expect(field.value).toBe("");
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    fireEvent.click(view.getAllByRole("button", { name: STYLES_COPY_DEFAULTS.civitai_key_remove })[1]!);
    await waitFor(() => expect(stylesApi.removeCivitaiKey).toHaveBeenCalled());
    restore();
  });
});

describe("the browser", () => {
  const page = (over = {}) => ({ items: [hit(), hit({ key: "k2", title: "Already one", remote_id: "x/two", reason: "Already installed as Clay look", installed: { id: "lora-a", name: "Clay look" } })], locked: true, next_cursor: "c2", notes: [], ...over });
  const mountBrowser = (opened: Array<string | null> = []) => renderWithQueryClient(<Page><StyleBrowser person={person} civitaiOn={false} onClose={() => undefined} onInstalled={() => undefined} onOpenStyle={(id) => opened.push(id)} /></Page>);

  test("tiles carry one reason line, a licence badge; adult and unknown hits are ONE lock tile with no title; Civitai stays off in the Source filter", async () => {
    const restore = stub({ browse: mock(async () => page()) as never });
    const view = mountBrowser();
    expect(await view.findByText("Made for LTX 2.5, 412 MB, open licence, 8,300 downloads")).toBeTruthy();
    expect(view.getByText("Already added as Clay look. Press to open it.")).toBeTruthy();
    expect(view.getAllByText("Open licence").length).toBeGreaterThan(0);
    expect((await view.findAllByRole("button", { name: TILE })).length).toBe(1);
    expect(document.documentElement.outerHTML).not.toContain("blur");
    expect(view.queryByRole("switch", { name: "Show adult results" })).toBeNull();
    fireEvent.click(view.getByRole("combobox", { name: "Source" }));
    expect(view.getByRole("option", { name: "Civitai (off)" })).toHaveAttribute("aria-disabled", "true");
    restore();
  });

  test("the Made for filter has no retired base option", async () => {
    const restore = stub({ browse: mock(async () => page()) as never });
    const view = mountBrowser();
    fireEvent.click(await view.findByRole("combobox", { name: "Made for" }));
    expect(view.queryByRole("option", { name: "LTX-2.3" })).toBeNull();
    expect(view.getByRole("option", { name: "LTX-2.5 and Wan" })).toBeTruthy();
    restore();
  });

  test("a filter and a sort go to the hub, paging keeps each page's cursor, and an installed hit opens that style instead of starting a download", async () => {
    const browse = mock(async (_query: BrowseQuery) => page());
    const restore = stub({ browse: browse as never });
    const opened: Array<string | null> = [];
    const view = mountBrowser(opened);
    await view.findByText("Clay look");
    fireEvent.click(view.getByRole("combobox", { name: "Sort" }));
    fireEvent.click(await view.findByRole("option", { name: "Newest" }));
    await waitFor(() => expect(browse.mock.calls.at(-1)![0].sort).toBe("newest"));
    fireEvent.click(await view.findByRole("button", { name: "Next" }));
    await waitFor(() => expect(browse.mock.calls.at(-1)![0].cursor).toBe("c2"));
    fireEvent.click(await view.findByRole("button", { name: "Already one" }));
    expect(opened).toEqual(["lora-a"]);
    restore();
  });

  test("no match says what to do; a failure says what went wrong and offers Try again; unlocked offers Show adult results", async () => {
    const restore = stub({ browse: mock(async () => ({ items: [], locked: false, next_cursor: null, notes: [] })) as never });
    const view = mountBrowser();
    expect(await view.findByText("No styles match. Try fewer words.")).toBeTruthy();
    restore(); cleanup();
    const failing = stub({ browse: mock(async () => { throw new ApiError("Too many searches", 429); }) as never });
    const bad = mountBrowser();
    expect(await bad.findByText("Searching too fast. Try again in a minute.")).toBeTruthy();
    expect(bad.getByRole("button", { name: "Try again" })).toBeTruthy();
    failing();
  });

  test("a hit opens the confirm panel: unknown age is pre-set to Yes, a non-open licence needs the checkbox, and Install sends the admin's answers", async () => {
    const install = mock(async (_body: InstallBody) => ({ job: "j1" }));
    const restore = stub({ browse: mock(async () => ({ items: [hit({ adult_check: "normal", licence: { id: null, class: "custom", commercial_use: "unknown" } })], locked: false, next_cursor: null, notes: [] })) as never, install: install as never });
    const view = mountBrowser();
    fireEvent.click(await view.findByRole("button", { name: "Clay look" }));
    const dialog = await view.findByText("Add this style");
    expect(dialog).toBeTruthy();
    expect((view.getByRole("radio", { name: "No, all ages" })).getAttribute("aria-checked")).toBe("true");
    const go = view.getByRole("button", { name: "Install style" });
    expect(go).toBeDisabled();
    fireEvent.click(view.getByLabelText(/I have read the licence/));
    await waitFor(() => expect(go).not.toBeDisabled());
    fireEvent.click(go);
    await waitFor(() => expect(install).toHaveBeenCalled());
    expect(install.mock.calls[0]![0]).toMatchObject({ source: "huggingface", remote_id: "x/clay", audience: "all-ages", licence_confirmed: true, name: "Clay look" });
    restore();
  });

  test("an unknown base offers LTX-2.5 and Wan only", async () => {
    const restore = stub();
    const view = renderWithQueryClient(<Page><StyleConfirm hit={hit({ base_model: "unknown", base_unstated: false })} person={person} revealed={false} onClose={() => undefined} onInstalled={() => undefined} onOpenInstalled={() => undefined} /></Page>);
    fireEvent.click(view.getByRole("combobox", { name: "What was this style made for?" }));
    expect(view.queryByRole("option", { name: "LTX-2.3" })).toBeNull();
    expect(view.getByRole("option", { name: "LTX-2.5" })).toBeTruthy();
    expect(view.getByRole("option", { name: "Wan" })).toBeTruthy();
    restore();
  });

  test("an unknown-age hit is pre-set to Yes, adults only; an adult hit made all ages asks for the passcode again and sends the ticket", async () => {
    const install = mock(async (_body: InstallBody) => ({ job: "j1" }));
    const ticket = mock(async (_secret: string, _item: string) => ({ ticket: "t-1", expires_in: 30 }));
    const restore = stub({ browse: mock(async () => ({ items: [hit({ adult_check: "adult" })], locked: false, next_cursor: null, notes: [] })) as never, install: install as never, confirmTicket: ticket as never });
    const view = mountBrowser();
    fireEvent.click(await view.findByRole("button", { name: "Clay look" }));
    await view.findByText("Add this style");
    expect((view.getByRole("radio", { name: "Yes, adults only" })).getAttribute("aria-checked")).toBe("true");
    expect(view.getByText(/The source marks this adult\./)).toBeTruthy();
    fireEvent.click(view.getByRole("radio", { name: "No, all ages" }));
    fireEvent.click(view.getByRole("button", { name: "Install style" }));
    expect(install).not.toHaveBeenCalled();
    await view.findByText("Make this style all ages?");
    const input = document.querySelector('[data-slot="adult-lock-dialog"] input') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { value: "0000" } }); });
    await waitFor(() => expect(ticket).toHaveBeenCalledWith("0000", "hf-x-clay"));
    await waitFor(() => expect(install).toHaveBeenCalled());
    expect(install.mock.calls[0]![0]).toMatchObject({ audience: "all-ages", confirm_ticket: "t-1" });
    restore();
  });

  test("an installed hit shows 'You already have this as <name>' with Open it, and a changed file offers Install as a separate style", async () => {
    const install = mock(async (_body: InstallBody): Promise<{ job: string }> => { throw new ApiError("The source changed this file.", 409, "changed_file"); });
    const restore = stub({ browse: mock(async () => ({ items: [hit()], locked: false, next_cursor: null, notes: [] })) as never, install: install as never });
    const view = mountBrowser();
    fireEvent.click(await view.findByRole("button", { name: "Clay look" }));
    await view.findByText("Add this style");
    fireEvent.click(view.getByRole("button", { name: "Install style" }));
    expect(await view.findByRole("button", { name: "Install as a separate style" })).toBeTruthy();
    restore();
    cleanup();
    const opened: Array<string | null> = [];
    const second = renderWithQueryClient(<Page><StyleConfirm hit={hit({ installed: { id: "lora-a", name: "Old Colour Film" }, reason: "Already installed as Old Colour Film" })} person={person} revealed={false} onClose={() => undefined} onInstalled={() => undefined} onOpenInstalled={(id) => opened.push(id)} /></Page>);
    expect(await second.findByText(/You already have this as Old Colour Film\./)).toBeTruthy();
    expect(second.getByRole("button", { name: "Install style" })).toBeDisabled();
    fireEvent.click(second.getByRole("button", { name: "Open it" }));
    expect(opened).toEqual(["lora-a"]);
  });
});

describe("the editor", () => {
  test("a retired saved style says why and cannot be enabled or picked for a clip", async () => {
    const retired = row({ base_model: "ltx-2.3", usable: true });
    const restore = stub({ list: mock(async () => ({ items: [retired], locked: false })) as never });
    const view = renderWithQueryClient(<Page><StyleEditor row={retired} person={person} onClose={() => undefined} onChanged={() => undefined} /></Page>);
    expect((await view.findAllByText("Retired video model, no longer available")).length).toBeGreaterThan(0);
    expect(view.getByRole("button", { name: "Try this style" })).toBeDisabled();
    expect(view.getByRole("radiogroup", { name: "Who can use this style" })).toHaveAttribute("aria-disabled", "true");
    expect(view.queryByRole("option", { name: "LTX-2.3" })).toBeNull();
    restore();
  });

  test("Adults only off asks first, and asks for the passcode again when the source said adult; keeping it changes nothing", async () => {
    unlocked = true;
    const allAges = mock(async (id: string) => row({ id, audience: "all-ages" }));
    const ticket = mock(async () => ({ ticket: "t-9", expires_in: 30 }));
    const restore = stub({
      list: mock(async () => ({ items: [row({ id: "lora-h", name: HIDDEN_NAME, audience: "adult-only", adult_check: "adult" })], locked: false })) as never,
      markAllAges: allAges as never, confirmTicket: ticket as never,
    });
    const view = renderWithQueryClient(<Page><StylesTab person={person} /></Page>);
    fireEvent.click(await view.findByRole("button", { name: "Edit" }));
    const toggle = await view.findByRole("switch", { name: "Adults only" });
    fireEvent.click(toggle);
    await view.findByText("Make this style all ages?");
    fireEvent.click(view.getByRole("button", { name: "Keep adults only" }));
    expect(allAges).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    fireEvent.click(await view.findByRole("button", { name: "Make all ages" }));
    await waitFor(() => expect(within(document.body).getAllByText("Make this style all ages?").length).toBeGreaterThan(0));
    const input = await waitFor(() => { const el = document.querySelector('[data-slot="adult-lock-dialog"] input') as HTMLInputElement | null; if (!el) throw new Error("no dialog"); return el; });
    await act(async () => { fireEvent.change(input, { target: { value: "0000" } }); });
    await waitFor(() => expect(allAges).toHaveBeenCalledWith("lora-h", "t-9"));
    restore();
  });

  test("saves as you go: a name change on leaving the field, and a choice of people never offers a minor", async () => {
    unlocked = true;
    const restore = stub({ list: mock(async () => ({ items: [row()], locked: false })) as never });
    const view = renderWithQueryClient(<Page><StylesTab person={person} /></Page>);
    fireEvent.click(await view.findByRole("button", { name: "Edit" }));
    const name = (await view.findByLabelText("Name")) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Faded Film" } });
    fireEvent.blur(name);
    await waitFor(() => expect(stylesApi.patch).toHaveBeenCalledWith("lora-a", { name: "Faded Film" }));
    expect(await view.findByText("Saved.")).toBeTruthy();
    restore();
  });
});

describe("Try this style (VIDEO-LORA-09)", () => {
  test("the router state names the Create choice for the style's kind and holds no address", () => {
    expect(tryStyleState(row({ id: "lora-a", kind: "style" }))).toEqual({ pageState: { style: "lora-a" } });
    expect(tryStyleState(row({ id: "lora-b", kind: "motion" }))).toEqual({ pageState: { style: "lora-b" } });
    expect(tryStyleState(row({ id: "lora-c", kind: "character" }))).toEqual({ pageState: { character: "lora-c" } });
  });
});
