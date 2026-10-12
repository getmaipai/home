import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import { ChatThread } from "@/apps/chat/ChatThread";
import { ChatAgeBandContext } from "@/apps/chat/chatThreadContexts";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";

// MINOR-SEARCH-01h (design row L6): a child sees source names and excerpts with no outbound link;
// a teen and an adult get the link.
const NOOP: ChatModelAdapter = { run: async function* () { /* seeded */ } };

function Harness({ band }: { band: "child" | "teen" | "adult" }) {
  const messages: ThreadMessageLike[] = [
    { role: "user", content: [{ type: "text", text: "how hot is boiling water" }] },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Water boils at 100 C [1](#citation-1). More at [a page](https://far.example.org/boil)." },
        { type: "source", sourceType: "url", id: "src-w1", url: "https://example.com/water", title: "Water facts" },
      ],
      status: { type: "complete", reason: "stop" },
      metadata: { custom: { turnId: "turn-links01" } },
    },
  ];
  const runtime = useLocalRuntime(NOOP, { initialMessages: messages });
  return <AssistantRuntimeProvider runtime={runtime}><ChatAgeBandContext.Provider value={band}><ChatThread /></ChatAgeBandContext.Provider></AssistantRuntimeProvider>;
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  globalThis.fetch = mock(() => Promise.resolve(Response.json({}))) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

async function outboundLinks(band: "child" | "teen" | "adult"): Promise<string[]> {
  const view = renderWithQueryClient(<MemoryRouter><Harness band={band} /></MemoryRouter>);
  await waitFor(() => expect(view.container.textContent).toContain("Water boils at 100 C"));
  return Array.from(view.container.querySelectorAll<HTMLAnchorElement>("a[href^='http']")).map((a) => a.getAttribute("href") ?? "");
}

describe("MINOR-SEARCH-01h child links", () => {
  test("a child's answer carries no outbound link and keeps the text of the link", async () => {
    expect(await outboundLinks("child")).toEqual([]);
    // The reply text and its citation marker are still there; only the link is gone.
    const view = renderWithQueryClient(<MemoryRouter><Harness band="child" /></MemoryRouter>);
    await waitFor(() => expect(view.container.textContent).toContain("a page"));
    expect(view.container.textContent).toContain("Water boils at 100 C");
  });
  test("a teen's answer keeps the links", async () => {
    const links = await outboundLinks("teen");
    expect(links).toContain("https://example.com/water");
  });
  test("an adult's answer keeps the links", async () => {
    expect((await outboundLinks("adult")).length).toBeGreaterThan(0);
  });
});

// MINOR-SEARCH-01n: on a touch screen (no hover, a tapped button may not take focus) a child can still read the excerpt.
describe("MINOR-SEARCH-01n touch citation", () => {
  test("a child's tap on the citation chip shows the source name, and a tap elsewhere hides it", async () => {
    const view = renderWithQueryClient(<MemoryRouter><Harness band="child" /></MemoryRouter>);
    await waitFor(() => expect(view.container.textContent).toContain("Water boils at 100 C"));
    const chip = await waitFor(() => {
      const found = Array.from(view.container.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "1");
      expect(found).toBeTruthy();
      return found!;
    });
    fireEvent.pointerDown(chip, { pointerType: "touch" });
    fireEvent.click(chip);
    expect(await within(document.body).findByText("Water facts")).toBeTruthy();
    fireEvent.pointerDown(document.body, { pointerType: "touch" });
    await waitFor(() => expect(within(document.body).queryByText("Water facts")).toBeNull());
  });
});
