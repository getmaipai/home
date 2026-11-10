// ADULT-LOCK-03b (docs/design/video-loras-2026-11-02.md section 11, tests 2 to 4): the shell host of the kit's AdultLockProvider. The fake hub answers
// like the real one: a page-data request without the proof header is the one tile, with it the clip (adult_only, so its picture is fetched into a blob).
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { NodeRenderer } from "@maipai/ui/src/schema/NodeRenderer";
import { PackageScopeContext, PageStateContext } from "@maipai/ui/src/schema/packageScope";
import { MediaShelfNodeSchema, type UiNode } from "@maipai/ui/src/schema/types";
import { AdultLockProvider } from "@maipai/ui/src/elements/adult-lock";
import { AdultLockController, unlockRequest, useAdultLockProps } from "@/shell/AdultLockHost";
import { adultClocks, adultResponse, getAdultProof, setAdultProof, revokeAdultBlobs } from "@/lib/adultLock";
import { renderWithQueryClient } from "../../tests/renderWithQueryClient";
import { createQueryClient } from "@maipai/ui/src/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { stubMatchMedia } from "../../tests/stubMatchMedia";
import type { Roster } from "@/lib/api";
import * as passkeyAssertion from "@/lib/passkeyAssertion";

const TILE = "Locked items. Press to enter your passcode.";
const TITLE = "Zebraquill velvet cabaret dancer";
const PROOF = "proof-issued-by-the-hub";
const originalFetch = globalThis.fetch;
const realMatchMedia = window.matchMedia;
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;

let calls: Array<{ url: string; method: string; proof: string | null }> = [];
let revoked: string[] = [];
let created = 0;

beforeEach(() => {
  stubMatchMedia({});
  calls = []; revoked = []; created = 0;
  setAdultProof(null); revokeAdultBlobs();
  // The test document starts at about:blank (origin "null"); the kit draws a blob: source only when it is of the page's own origin, as in a real page.
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("http://localhost:3000/apps/videos/clips");
  URL.createObjectURL = (() => `blob:${window.location.origin}/adult-test-${++created}`) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => { revoked.push(url); }) as typeof URL.revokeObjectURL;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers = new Headers(init?.headers);
    const proof = headers.get("x-adult-unlock");
    const method = init?.method ?? "GET";
    calls.push({ url, method, proof });
    if (url === "/api/adult-lock/unlock") {
      const body = JSON.parse(String(init?.body)) as { secret: string };
      return Promise.resolve(body.secret === "0000" || body.secret === "pw-correct" ? Response.json({ proof: PROOF, idle_seconds: 120 }) : Response.json({ error: "Invalid PIN or password", attemptsLeft: 4 }, { status: 401 }));
    }
    if (url === "/api/adult-lock/lock") return Promise.resolve(Response.json({ locked: true }));
    if (url.startsWith("/api/plugins/videos/data/")) {
      if (proof !== PROOF) return Promise.resolve(Response.json([{ locked: true, making: false }]));
      return Promise.resolve(Response.json([{ id: "c1", title: TITLE, thumbnail: "/api/files/c1/thumb", adult_only: true, created_at: new Date().toISOString() }]));
    }
    if (url === "/api/files/c1/thumb") return Promise.resolve(proof === PROOF ? new Response("jpeg") : new Response("{}", { status: 404 }));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch; window.matchMedia = realMatchMedia; URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke;
  adultClocks.idleMs = 2 * 60 * 1000; adultClocks.capMs = 15 * 60 * 1000;
  setAdultProof(null); revokeAdultBlobs();
});

const shelf = MediaShelfNodeSchema.parse({
  type: "media_shelf", bind: { source: "package", path: "recipes", stream: false }, item_key_field: "id", item_label_field: "title", item_media_field: "thumbnail",
  layout: "grid", locked_field: "locked", making_field: "making", heading: "My clips",
}) as unknown as UiNode;

const person = { pinDigits: 4, hasSecret: true } as Pick<Roster, "pinDigits" | "hasSecret">;

function Nav() {
  const navigate = useNavigate();
  return <><button type="button" onClick={() => navigate("/elsewhere")}>go elsewhere</button><button type="button" onClick={() => navigate("/?tab=styles")}>go to another tab</button><button type="button" onClick={() => navigate("/?tab=styles&q=1")}>same tab, other query</button><button type="button" onClick={() => navigate("/?tab=pictures")}>go to a third tab</button></>;
}

// The shell's own composition (Routes.tsx): the hook's props on the kit's provider, the controller inside it.
function Shell({ children, who = person }: { children: ReactNode; who?: Pick<Roster, "pinDigits" | "hasSecret"> }) {
  const props = useAdultLockProps(who);
  return <AdultLockProvider {...props}><AdultLockController />{children}</AdultLockProvider>;
}

function mount(who?: Pick<Roster, "pinDigits" | "hasSecret">) {
  return renderWithQueryClient(
    <MemoryRouter>
      <Shell who={who}>
        <Nav />
        <PackageScopeContext.Provider value={{ packageId: "videos" }}>
          <PageStateContext.Provider value={{ merge: () => {} }}>
            <NodeRenderer node={shelf} state={{}} />
          </PageStateContext.Provider>
        </PackageScopeContext.Provider>
      </Shell>
    </MemoryRouter>,
  );
}

async function unlock(view: ReturnType<typeof mount>) {
  fireEvent.click((await view.findAllByRole("button", { name: TILE }))[0]!);
  await view.findByText("Enter your passcode");
  const input = document.querySelector('[data-slot="adult-lock-dialog"] input') as HTMLInputElement;
  await act(async () => { fireEvent.change(input, { target: { value: "0000" } }); });
  await view.findByText(TITLE);
}

describe("while locked", () => {
  test("one tile, and the title is nowhere in the tree, its attributes or its accessible names", async () => {
    const view = mount();
    expect((await view.findAllByRole("button", { name: TILE })).length).toBe(1);
    expect(document.documentElement.outerHTML.includes("Zebraquill")).toBe(false);
    expect(document.title.includes("Zebraquill")).toBe(false);
    expect(getAdultProof()).toBeNull();
  });
});

describe("passkey availability", () => {
  test("offers onPasskey only when passkeys are available", async () => {
    const available = spyOn(passkeyAssertion, "passkeysAvailable");
    try {
      available.mockResolvedValue(false);
      const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter><QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider></MemoryRouter>;
      const without = renderHook(() => useAdultLockProps(person), { wrapper });
      await waitFor(() => expect(without.result.current.onPasskey).toBeUndefined());
      without.unmount();
      available.mockResolvedValue(true);
      const withKey = renderHook(() => useAdultLockProps(person), { wrapper });
      await waitFor(() => expect(withKey.result.current.onPasskey).toBeDefined());
      expect(withKey.result.current.onPasskey).toBeFunction();
      expect(withKey.result.current.onPasskey).toBeDefined();
    } finally { available.mockRestore(); }
  });
});

describe("who signs in with a password (ADULT-LOCK-07)", () => {
  const passwordPerson = { pinDigits: null, hasSecret: true } as Pick<Roster, "pinDigits" | "hasSecret">;
  const field = () => document.querySelector<HTMLInputElement>('[data-slot="adult-lock-dialog"] input')!;
  const submit = () => fireEvent.submit(field().closest("form")!);

  test("the dialog asks for a password in a masked field, not digit boxes, and says nothing about setting a passcode", async () => {
    const view = mount(passwordPerson);
    fireEvent.click((await view.findAllByRole("button", { name: TILE }))[0]!);
    await view.findByText("Enter your password");
    expect(field().type).toBe("password");
    expect(document.querySelector('[data-slot="adult-lock-dialog"]')!.textContent).not.toContain("Set a passcode");
    expect(document.querySelectorAll('[data-slot="adult-lock-dialog"] input').length).toBe(1);
  });

  test("a wrong password shows the plain line and keeps the page locked; the right one unlocks and the content appears", async () => {
    const view = mount(passwordPerson);
    fireEvent.click((await view.findAllByRole("button", { name: TILE }))[0]!);
    await view.findByText("Enter your password");
    await act(async () => { fireEvent.change(field(), { target: { value: "nope" } }); });
    await act(async () => { submit(); });
    await waitFor(() => expect(document.querySelector('[data-slot="adult-lock-error"]')?.textContent).toBe("That password was not right. Check it and try again."));
    expect(getAdultProof()).toBeNull();
    await act(async () => { fireEvent.change(field(), { target: { value: "pw-correct" } }); });
    await act(async () => { submit(); });
    await view.findByText(TITLE);
    expect(getAdultProof()).toBe(PROOF);
    const sent = calls.filter((c) => c.url === "/api/adult-lock/unlock").length;
    expect(sent).toBe(2);
  });

  test("a person with no secret set still sees where to set one, and a PIN person still gets digits", async () => {
    const none = mount({ pinDigits: null, hasSecret: false });
    fireEvent.click((await none.findAllByRole("button", { name: TILE }))[0]!);
    await none.findByText(/Set a passcode in Account/);
    expect(document.querySelector('[data-slot="adult-lock-dialog"] input')).toBeNull();
    cleanup();
    const pin = mount();
    fireEvent.click((await pin.findAllByRole("button", { name: TILE }))[0]!);
    await pin.findByText("Enter your passcode");
    expect(field().type).not.toBe("password");
  });
});

describe("after the unlock", () => {
  test("the clip is there, its picture is a blob fetched with the proof, and the proof is in no storage, cookie or URL", async () => {
    const view = mount();
    await unlock(view);
    expect(getAdultProof()).toBe(PROOF);
    expect(calls.some((c) => c.url.startsWith("/api/plugins/videos/data/") && c.proof === PROOF)).toBe(true);
    await waitFor(() => expect(calls.some((c) => c.url === "/api/files/c1/thumb" && c.proof === PROOF)).toBe(true));
    await waitFor(() => expect(document.querySelector("img")?.getAttribute("src") ?? "").toStartWith("blob:http://localhost:3000/adult-test-"));
    const stores = [JSON.stringify({ ...window.localStorage }), JSON.stringify({ ...window.sessionStorage }), document.cookie, window.location.href];
    for (const text of stores) expect(text.includes(PROOF)).toBe(false);
    expect(view.queryAllByRole("button", { name: TILE }).length).toBe(0);
  });

  test("Lock now sends the old proof to the hub, revokes the blob URLs and brings the one tile back", async () => {
    const view = mount();
    await unlock(view);
    await waitFor(() => expect(document.querySelector("img")?.getAttribute("src") ?? "").toStartWith("blob:"));
    fireEvent.click(await view.findByRole("button", { name: "Lock now" }));
    await view.findByRole("button", { name: TILE });
    expect(getAdultProof()).toBeNull();
    expect(calls.find((c) => c.url === "/api/adult-lock/lock")?.proof).toBe(PROOF);
    expect(revoked.length).toBeGreaterThan(0);
    expect(document.documentElement.outerHTML.includes("Zebraquill")).toBe(false);
  });
});

describe("a page ends the unlock", () => {
  test("a route change relocks", async () => {
    const view = mount();
    await unlock(view);
    fireEvent.click(view.getByText("go elsewhere"));
    await view.findByRole("button", { name: TILE });
    expect(getAdultProof()).toBeNull();
    expect(calls.some((c) => c.url === "/api/adult-lock/lock" && c.proof === PROOF)).toBe(true);
  });

  test("VIDEO-SETTINGS-02: a Settings tab (?tab= on the same route) is a page: changing it relocks, a query that is not the tab does not", async () => {
    const view = mount();
    fireEvent.click(view.getByText("go to another tab"));
    await unlock(view);
    fireEvent.click(view.getByText("same tab, other query"));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(getAdultProof()).toBe(PROOF);
    fireEvent.click(view.getByText("go to a third tab"));
    await view.findByRole("button", { name: TILE });
    expect(getAdultProof()).toBeNull();
    expect(calls.some((c) => c.url === "/api/adult-lock/lock" && c.proof === PROOF)).toBe(true);
  });

  test("the tab becoming hidden relocks, with no grace period", async () => {
    const view = mount();
    await unlock(view);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    try {
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    } finally { delete (document as unknown as Record<string, unknown>).visibilityState; }
    await view.findByRole("button", { name: TILE });
    expect(getAdultProof()).toBeNull();
  });

  test("idle time relocks, and activity inside the window slides it", async () => {
    adultClocks.idleMs = 150;
    const view = mount();
    await unlock(view);
    await new Promise((r) => setTimeout(r, 90));
    fireEvent.pointerDown(document.body);
    await new Promise((r) => setTimeout(r, 90));
    expect(getAdultProof()).toBe(PROOF);
    await view.findByRole("button", { name: TILE }, { timeout: 1500 });
    expect(getAdultProof()).toBeNull();
  });

  test("the absolute cap relocks however active the page is", async () => {
    adultClocks.capMs = 250;
    const view = mount();
    await unlock(view);
    const keep = setInterval(() => fireEvent.pointerDown(document.body), 40);
    try { await view.findByRole("button", { name: TILE }, { timeout: 2000 }); } finally { clearInterval(keep); }
    expect(getAdultProof()).toBeNull();
  });

  test("unmounting while unlocked (sign-out ends the shell) tells the hub and revokes the blobs", async () => {
    const view = mount();
    await unlock(view);
    await waitFor(() => expect(document.querySelector("img")?.getAttribute("src") ?? "").toStartWith("blob:"));
    view.unmount();
    expect(getAdultProof()).toBeNull();
    expect(calls.some((c) => c.url === "/api/adult-lock/lock" && c.proof === PROOF)).toBe(true);
    expect(revoked.length).toBeGreaterThan(0);
  });
});

describe("a flag that flips on while something plays", () => {
  const play = (src: string) => {
    const el = document.createElement("video");
    el.setAttribute("src", src);
    Object.defineProperty(el, "paused", { configurable: true, get: () => false });
    document.body.append(el);
    return el;
  };

  test("the item that flipped, playing, stops the page and relocks", async () => {
    const view = mount();
    await unlock(view);
    const el = play("/api/files/flip-1/content");
    try {
      await act(async () => {
        await adultResponse([{ id: "flip-1", title: "open" }]);
        await adultResponse([{ id: "flip-1", adult_only: true }]);
      });
      await view.findByRole("button", { name: TILE });
      expect(getAdultProof()).toBeNull();
    } finally { el.remove(); }
  });

  test("another item's flip does not touch what plays, and does not relock", async () => {
    const view = mount();
    await unlock(view);
    const el = play("/api/files/other-song/content");
    try {
      await act(async () => {
        await adultResponse([{ id: "flip-2", title: "open" }]);
        await adultResponse([{ id: "flip-2", adult_only: true }]);
      });
      expect(getAdultProof()).toBe(PROOF);
      expect(view.queryAllByRole("button", { name: TILE }).length).toBe(0);
    } finally { el.remove(); }
  });
});

describe("the unlock call", () => {
  test("maps the hub's answers to ok, failed (with the tries left) and locked_out (with the wait); anything else rejects", async () => {
    const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await unlockRequest("0000", "v", answer(200, { proof: "p", idle_seconds: 120 }))).toEqual({ status: "ok", proof: "p" });
    expect(await unlockRequest("1", "v", answer(401, { error: "x", attemptsLeft: 2 }))).toEqual({ status: "failed", attemptsLeft: 2 });
    expect(await unlockRequest("1", "v", answer(429, { error: "x", retryAfter: 30 }))).toEqual({ status: "locked_out", retryAfterSeconds: 30 });
    await expect(unlockRequest("1", "v", answer(500, {}))).rejects.toThrow();
    await expect(unlockRequest("1", "v", answer(403, { error: "Unlock on your own screen." }))).rejects.toThrow();
  });
});
