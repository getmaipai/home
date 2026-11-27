// STACK-MODELS-HOME-01: Settings, AI and models is the shared StackModelsPage over Home's forwarder. The Stack is the kit's in-memory fake behind a fetch
// that answers `/api/ai/stack/*` the way the forwarder does (the Stack's sentence and code come back as they are), so these prove the wiring: every call
// goes to the right forwarder route with the Stack's body, a refusal shows the Stack's own sentence, and Home's own sections (who may use each level, the
// links, the notice for an old value the Stack refused) sit under the page. The page itself is tested in the kit.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { createFakeStackClient, type FakeStackClient } from "@maipai/ui/src/stack/fakeStackClient";
import { StackClientError } from "@maipai/ui/src/stack/StackClient";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { AiModelsPage } from "@/apps/settings/AiModelsPage";
import { StackAdminLink } from "@/apps/settings/StackAdminLink";
import { createHomeStackClient } from "@/lib/stackModelsClient";
import { makePerson } from "@/shell/pages/settings/settingsTestKit";

afterEach(cleanup);
const realFetch = globalThis.fetch;
let fake: FakeStackClient;
let wire: Array<{ method: string; path: string; body: unknown }> = [];
let stored: Record<string, unknown> = {};
let adminLink: Record<string, unknown> = { local_url: "http://127.0.0.1:8770/admin/", remote_url: null, reason: "Open this page on the computer that runs MaiPai, or turn on remote access in the Stack's settings." };
let migration: Record<string, unknown> = { done: true, refused: [], dismissed: true };

beforeEach(() => {
  adminLink = { local_url: "http://127.0.0.1:8770/admin/", remote_url: null, reason: "Open this page on the computer that runs MaiPai, or turn on remote access in the Stack's settings." };
  fake = createFakeStackClient(); wire = []; stored = {}; migration = { done: true, refused: [], dismissed: true };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
    const method = init?.method ?? "GET"; const path = url.pathname; const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    if (path.startsWith("/api/settings")) {
      if (method === "PUT") { stored[body.key] = body.value; return Response.json({ key: body.key, value: body.value }); }
      return Response.json(Object.entries(stored).map(([key, value]) => ({ key, value, source: "user" })));
    }
    if (path === "/api/ai/stack/admin-link") return Response.json(adminLink);
    if (path === "/api/ai/stack/licences") { wire.push({ method, path, body }); return Response.json({ terms_version: "2026-11", accepted: method === "POST", accepted_at: method === "POST" ? "now" : null, by: method === "POST" ? "owner-1" : null, licences: [{ id: "model-terms", name: "Model terms", url: "https://example.com/terms", summary: ["Terms apply."] }] }); }
    if (path === "/api/ai/stack/migration") return Response.json(migration);
    if (path === "/api/ai/stack/migration/dismiss") { migration = { ...migration, dismissed: true }; return Response.json(migration); }
    wire.push({ method, path, body });
    const answer = async (run: () => Promise<unknown>) => { try { return Response.json(await run()); } catch (error) { if (error instanceof StackClientError) return Response.json({ error: error.message, code: error.code }, { status: 409 }); throw error; } };
    const seg = path.replace("/api/ai/stack/", "").split("/");
    if (method === "GET" && seg[0] === "choices" && !seg[1]) return answer(() => fake.readChoices());
    if (method === "GET" && seg[1] === "unused") return answer(() => fake.readUnused());
    if (method === "PUT" && seg[0] === "settings") return Response.json({});
    if (method === "PUT" && seg[0] === "choices" && seg[2] === "order") return answer(() => fake.setOrder(seg[1] as never, body));
    if (method === "PUT" && seg[0] === "choices") return answer(() => fake.chooseModel(seg[1] as never, seg[2] as never, body));
    if (method === "POST" && seg[1] === "recommended") return answer(() => fake.recommended(body.dry_run));
    if (method === "POST" && seg[1] === "add-model") return answer(() => fake.addModel(body));
    if (method === "POST" && seg[0] === "parts") return answer(() => fake.installModel(decodeURIComponent(seg[1]!)));
    if (method === "DELETE" && seg[0] === "parts") return answer(() => fake.removeModel(decodeURIComponent(seg[1]!)));
    return Response.json({ error: `unscripted ${method} ${path}`, code: "unscripted" }, { status: 500 });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

const open = () => renderWithQueryClient(<MemoryRouter><AiModelsPage person={makePerson("owner")} onPersonChange={() => {}} /></MemoryRouter>);

describe("the Home client", () => {
  test("each method is one forwarder call with the Stack's own body", async () => {
    const client = createHomeStackClient();
    await client.readChoices();
    await client.chooseModel("pictures", "boost", { model: "flux1-dev-q8", profile: "p64" });
    await client.setOrder("music", { order: ["ace-step-15"], off: [] });
    await client.recommended(true);
    await client.installModel("qwen3-8b-q4");
    await client.removeModel("qwen3-4b-q4").catch(() => undefined);
    await client.setRoleEnabled("video", true);
    await client.setRolePriorities({ chat: 5, music: 7 });
    expect(wire.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/ai/stack/choices", "PUT /api/ai/stack/choices/pictures/boost", "PUT /api/ai/stack/choices/music/order", "POST /api/ai/stack/choices/recommended",
      "POST /api/ai/stack/parts/qwen3-8b-q4/install", "DELETE /api/ai/stack/parts/qwen3-4b-q4", "PUT /api/ai/stack/settings", "PUT /api/ai/stack/settings",
    ]);
    expect(wire[1]!.body).toEqual({ model: "flux1-dev-q8", profile: "p64" });
    expect(wire[3]!.body).toEqual({ dry_run: true });
    expect(wire[6]!.body).toEqual({ "stack.roles.video.enabled": true });
    expect(wire[7]!.body).toEqual({ "stack.roles.chat.priority": 5, "stack.roles.music.priority": 7 });
  });

  test("licence reads and accepts use the Stack proxy routes", async () => {
    const client = createHomeStackClient();
    await client.licences!.read();
    await client.licences!.accept();
    expect(wire.slice(-2).map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: "GET", path: "/api/ai/stack/licences", body: undefined },
      { method: "POST", path: "/api/ai/stack/licences", body: {} },
    ]);
  });

  test("a refusal is the Stack's sentence and code, not Home's", async () => {
    fake.failNext("chooseModel", "That model does not fit this computer. Pick a smaller one.", "does_not_fit");
    const error = await createHomeStackClient().chooseModel("chat", "standard", { model: "x" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StackClientError);
    expect(error).toMatchObject({ message: "That model does not fit this computer. Pick a smaller one.", code: "does_not_fit" });
  });
});

describe("the page", () => {
  test("shows each feature's friendly model name from the Stack, and search finds a model by version", async () => {
    const view = open();
    const chat = await view.findByTestId("feature-chat");
    expect(within(chat).getByText("Qwen3 8B")).toBeTruthy();
    expect(view.queryByText("qwen3-8b-q4")).toBeNull();
    fireEvent.change(view.getByRole("searchbox", { name: "Search models" }), { target: { value: "3.8" } });
    expect(await view.findByText("Qwen3.8 Flash Next 177B")).toBeTruthy();
  });

  test("a model the Stack starts listing shows up with its name and size and no Home change (one definition, in the Stack)", async () => {
    const read = fake.readChoices.bind(fake);
    fake.readChoices = async () => {
      const view = await read();
      const chat = view.categories.find((category) => category.id === "chat")!;
      const base = chat.candidates[0]!;
      chat.candidates.push({ ...base, id: "zz-brand-new-model", label: "Zed One 9B", summary: "A model added to the Stack after Home shipped.", search_text: "zed one 9b zz-brand-new-model", size_bytes: 9_000_000_000, rank: chat.candidates.length + 1 });
      chat.order.push("zz-brand-new-model");
      return view;
    };
    const view = open();
    await view.findByTestId("feature-chat");
    fireEvent.change(view.getByRole("searchbox", { name: "Search models" }), { target: { value: "zed" } });
    expect(await view.findByText("Zed One 9B")).toBeTruthy();
  });

  test("a feature switch saves to the Stack through the forwarder", async () => {
    const view = open();
    const video = await view.findByTestId("feature-video");
    fireEvent.click(within(video).getByRole("switch", { name: "Video on or off" }));
    await waitFor(() => expect(wire.some((call) => call.method === "PUT" && call.path === "/api/ai/stack/settings")).toBe(true));
    expect(wire.find((call) => call.path === "/api/ai/stack/settings")!.body).toEqual({ "stack.roles.video.enabled": true });
  });

  test("Home's own sections sit under the page: who may use each level, and the storage and backup links", async () => {
    const view = open();
    expect(await view.findByTestId("extra-level-access")).toBeTruthy();
    expect(await view.findByTestId("extra-storage-backups")).toBeTruthy();
    expect(view.getByRole("button", { name: "Backups" })).toBeTruthy();
  });

  test("saving who may use a level writes Home's slot setting and keeps its stored model", async () => {
    stored["engines.pictures.tier.boost"] = { model: "old-pick", options: {} };
    const view = open();
    fireEvent.click(await view.findByRole("button", { name: "Who can use each Pictures level" }));
    const boost = await view.findByTestId("ai-access-boost");
    fireEvent.click(within(boost).getByRole("radio", { name: "Admins and assigned people" }));
    fireEvent.click(view.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(stored["engines.pictures.tier.boost"]).toEqual({ model: "old-pick", options: {}, who: "admins" }));
  });

  test("a value the Stack refused when Home moved its choices shows as a plain notice until it is read", async () => {
    migration = { done: true, accepted: 1, refused: [{ kind: "slot", key: "image.max", reason: "That picture model is not on this computer any more." }], dismissed: false };
    const view = open();
    const notice = await view.findByTestId("ai-migration-notice");
    expect(notice.textContent).toContain("That picture model is not on this computer any more.");
    fireEvent.click(within(notice).getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(view.queryByTestId("ai-migration-notice")).toBeNull());
  });

  test("a person who is not an owner or admin sees the actions locked with a sentence", async () => {
    const view = renderWithQueryClient(<MemoryRouter><AiModelsPage person={makePerson("adult")} onPersonChange={() => {}} /></MemoryRouter>);
    expect((await view.findAllByText("Only an adult admin can change the AI and models.")).length).toBeGreaterThan(0);
  });
});

describe("the link to the Stack's admin page", () => {
  const openLink = (hostname: string) => renderWithQueryClient(<StackAdminLink hostname={hostname} />);
  test("the link is no longer a card on this page: it lives on Settings, Stack, General", async () => {
    const view = open();
    await view.findByTestId("feature-chat");
    expect(view.queryByRole("link", { name: "Open Stack admin" })).toBeNull();
    expect(view.queryByTestId("extra-stack-admin")).toBeNull();
  });
  test("on the computer itself it is one link that opens a new tab", async () => {
    const view = openLink("localhost");
    const link = (await view.findByRole("link", { name: "Open Stack admin" })) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("http://127.0.0.1:8770/admin/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
  test("from another device with remote access off it is not a link and says why in plain words", async () => {
    const view = openLink("hub.example.com");
    expect(await view.findByText(/turn on remote access in the Stack's settings/)).toBeTruthy();
    expect(view.queryByRole("link", { name: "Open Stack admin" })).toBeNull();
  });
  test("from another device with remote access on it links to the Tailscale address", async () => {
    adminLink = { local_url: "http://127.0.0.1:8770/admin/", remote_url: "http://100.64.0.9:8770/admin/", reason: null };
    const view = openLink("hub.example.com");
    expect(((await view.findByRole("link", { name: "Open Stack admin" })) as HTMLAnchorElement).getAttribute("href")).toBe("http://100.64.0.9:8770/admin/");
  });
  test("on the computer itself (localhost) it always links to the local address", async () => {
    adminLink = { local_url: "http://127.0.0.1:8770/admin/", remote_url: "http://100.64.0.9:8770/admin/", reason: null };
    const view = openLink("localhost");
    expect(((await view.findByRole("link", { name: "Open Stack admin" })) as HTMLAnchorElement).getAttribute("href")).toBe("http://127.0.0.1:8770/admin/");
  });
});
