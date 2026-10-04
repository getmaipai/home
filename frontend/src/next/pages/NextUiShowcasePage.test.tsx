import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UI_FIXTURES, findFixture } from "@maipai/home-backend/src/lib/uiFixtures";
import { NextUiShowcasePage } from "@/next/pages/NextUiShowcasePage";
import { readAssistantTurnStream } from "@/lib/assistantTurnStream";
import { assistantStreamBody, ASSISTANT_STREAM_HEADERS } from "../../../tests/assistantStreamBody";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Roster } from "@/lib/api";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";

// UI-SHOWCASE: every fixture decodes through the chat's own reader, and the
// page plays them through the real chat components.
function fixtureResponse(id: string): Response {
  return new Response(assistantStreamBody(findFixture(id)!.events), { status: 200, headers: ASSISTANT_STREAM_HEADERS });
}
async function decode(id: string) {
  const out: Record<string, unknown>[] = [];
  for await (const event of readAssistantTurnStream(fixtureResponse(id))) out.push(event as unknown as Record<string, unknown>);
  return out;
}

describe("showcase fixtures through the real client reader", () => {
  for (const fixture of UI_FIXTURES) {
    test(`${fixture.id}: decodes to its own events with exactly one terminal`, async () => {
      const events = await decode(fixture.id);
      expect(events[0]!.type).toBe("turn_meta");
      expect(events.filter((e) => e.type === "done" || e.type === "error")).toHaveLength(1);
      const text = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
      const done = events.find((e) => e.type === "done") as { value: { reply: { text: string } } } | undefined;
      if (done) expect(text).toBe(done.value.reply.text);
    });
  }

  test("the table fixture streams a markdown table, search carries three sources, failures carry their code", async () => {
    expect((await decode("table")).filter((e) => e.type === "delta").map((e) => e.text).join("")).toContain("| --- |");
    const search = (await decode("search")).find((e) => e.type === "done") as { value: { sources: unknown[] } };
    expect(search.value.sources).toHaveLength(3);
    expect((await decode("failure-safety")).at(-1)).toMatchObject({ type: "error", code: "safety_refused" });
    expect((await decode("failure-engine-down")).at(-1)).toMatchObject({ type: "error", code: "engine_unavailable" });
  });
});

const ADMIN = { id: "p1", display_name: "Oliver", role: "owner" } as unknown as Roster;
const CHILD = { id: "p2", display_name: "Sprout", role: "child" } as unknown as Roster;
const realFetch = globalThis.fetch;
let streamed: string[] = [];

beforeEach(() => {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  streamed = [];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/dev/ui-fixtures") return Promise.resolve(Response.json({ fixtures: UI_FIXTURES.map(({ id, title, description }) => ({ id, title, description })) }));
    const match = /\/api\/dev\/ui-fixtures\/([^/]+)\/stream$/.exec(url);
    if (match && init?.method === "POST") {
      streamed.push(`${match[1]}:${JSON.parse(String(init.body)).pace}`);
      return Promise.resolve(fixtureResponse(match[1]!));
    }
    return Promise.resolve(Response.json({}));
  }) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const open = (person = ADMIN) => renderWithQueryClient(<MemoryRouter><NextUiShowcasePage person={person} /></MemoryRouter>);

describe("NextUiShowcasePage", () => {
  test("a non-admin sees the denial and never asks for the fixtures", () => {
    const view = open(CHILD);
    expect(view.container.textContent).toContain("for owners and admins");
    expect(streamed).toEqual([]);
  });

  test("lists every scenario as a button", async () => {
    const view = open();
    await waitFor(() => expect(view.getAllByRole("button", { name: /^Table\./ })).toHaveLength(1));
    for (const fixture of UI_FIXTURES) expect(view.getByRole("button", { name: new RegExp(`^${fixture.title.replace(/[()]/g, "\\$&")}\\.`) })).toBeTruthy();
  });

  test("the Table button plays the table turn through the chat thread: a real table element, at the chosen pace", async () => {
    const view = open();
    const button = await waitFor(() => view.getByRole("button", { name: /^Table\./ }));
    fireEvent.click(button);
    await waitFor(() => expect(view.container.querySelector("table")).not.toBeNull(), { timeout: 5000 });
    expect(streamed).toEqual(["table:normal"]);
    expect(within(view.container.querySelector("table")!).getByText("Juniper")).toBeTruthy();
  });

  test("the Code button renders both fenced blocks, each with a copy button", async () => {
    const view = open();
    fireEvent.click(await waitFor(() => view.getByRole("button", { name: /^Code blocks\./ })));
    await waitFor(() => expect(view.container.querySelectorAll("pre").length).toBe(2), { timeout: 5000 });
    for (const pre of Array.from(view.container.querySelectorAll("pre"))) {
      const scope = pre.parentElement!;
      expect(within(scope).getAllByRole("button", { name: /copy/i }).length).toBeGreaterThan(0);
    }
  });

  test("a failure scenario ends the thread in the error, not a silent blank", async () => {
    const view = open();
    fireEvent.click(await waitFor(() => view.getByRole("button", { name: /^Failure: engine down \(chat\)\./ })));
    await waitFor(() => expect(view.container.textContent).toContain("AI isn't running right now"), { timeout: 5000 });
  });
});
