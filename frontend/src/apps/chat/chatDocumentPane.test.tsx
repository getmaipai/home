import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { TurnArtifact } from "@maipai/spec/gen/ts/turn-artifact.js";
import { ChatDocumentOpenContext, ChatDocumentPane, DocumentHandle } from "@/apps/chat/chatDocumentPane";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  mock.restore();
});

const originalFetch = globalThis.fetch;

const source = {
  id: "src-example123",
  kind: "web" as const,
  title: "Example source",
  url: "https://example.com/details",
  site: "example.com",
  snippet: "A useful source excerpt.",
  source: "turn-example123",
  created_at: "2026-09-16T00:00:00.000Z",
  hlc: "1788000000000:0:example",
};

function artifact(section: unknown, sources = [source]): TurnArtifact {
  return {
    id: "doc-example123",
    turn_id: "turn-example123",
    revision: 1,
    evidence_version: "outcome-example123",
    section,
    sources,
    provenance: "composer:turn-example123:lookup",
    created_at: "2026-09-16T00:00:00.000Z",
    hlc: "1788000000000:0:example",
  } as TurnArtifact;
}

function renderPane(value: TurnArtifact) {
  globalThis.fetch = mock(() => Promise.resolve(Response.json(value))) as unknown as typeof fetch;
  return renderWithQueryClient(<ChatDocumentPane turnId="turn-example123" onClose={() => {}} />);
}

describe("COMP-01d details pane", () => {
  test("the reply handle is absent without a document and opens the matching turn", () => {
    const open = mock(() => {});
    const { queryByRole, getByRole, rerender } = renderWithQueryClient(
      <ChatDocumentOpenContext.Provider value={open}>
        <DocumentHandle turnId="turn-example123" available={false} />
      </ChatDocumentOpenContext.Provider>,
    );
    expect(queryByRole("button", { name: "View details" })).toBeNull();
    rerender(
      <ChatDocumentOpenContext.Provider value={open}>
        <DocumentHandle turnId="turn-example123" available />
      </ChatDocumentOpenContext.Provider>,
    );
    fireEvent.click(getByRole("button", { name: "View details" }));
    expect(open).toHaveBeenCalledWith("turn-example123");
  });

  test("renders a lookup section and source links with the citation card's safe attributes", async () => {
    const view = renderPane(artifact({
      type: "lookup",
      query: "best family hikes",
      results: [{ title: "Greenway Trail", line: "A short trail for families.", source_id: source.id }],
    }));
    expect(await view.findByRole("heading", { name: "Results for best family hikes" })).toBeInTheDocument();
    expect(view.getByText("A short trail for families.")).toBeInTheDocument();
    const link = await view.findByRole("link", { name: "Example source · example.com" });
    expect(link).toHaveAttribute("href", source.url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  test("renders a card section", async () => {
    const view = renderPane(artifact({
      type: "card",
      kind: "film",
      name: "Moonrise Kingdom",
      year: 2012,
      director: "Wes Anderson",
      genres: ["Comedy", "Drama"],
      source_id: source.id,
    }));
    expect(await view.findByRole("heading", { name: "Moonrise Kingdom" })).toBeInTheDocument();
    expect(view.getByText("Director: Wes Anderson")).toBeInTheDocument();
    expect(view.getByText("Genres: Comedy, Drama")).toBeInTheDocument();
  });

  test("renders ordered procedure steps and quantities", async () => {
    const view = renderPane(artifact({
      type: "procedure",
      title: "Make tea",
      steps: [
        { position: 1, instruction: "Boil the water.", quantities: [{ amount: 2, unit: "cups", item: "water" }] },
        { position: 2, instruction: "Steep the tea.", quantities: [] },
      ],
    }));
    expect(await view.findByRole("heading", { name: "Make tea" })).toBeInTheDocument();
    expect(view.getByText("Boil the water.")).toBeInTheDocument();
    expect(view.getByText("2 cups water")).toBeInTheDocument();
    expect(view.getByText("Steep the tea.")).toBeInTheDocument();
  });

  test("renders comparison subjects and values", async () => {
    const view = renderPane(artifact({
      type: "comparison",
      title: "Tea choices",
      subjects: [{ id: "subject-oolong1", name: "Oolong" }, { id: "subject-green1", name: "Green" }],
      rows: [{ attribute: "Caffeine", values: [{ subject_id: "subject-oolong1", value: "Medium" }, { subject_id: "subject-green1", value: "Low" }] }],
    }));
    expect(await view.findByRole("heading", { name: "Tea choices" })).toBeInTheDocument();
    expect(view.getByText("Oolong:")).toBeInTheDocument();
    expect(view.getByText("Medium")).toBeInTheDocument();
    expect(view.getByText("Green:")).toBeInTheDocument();
  });

  test("child projection with no sources renders no source section or links", async () => {
    const view = renderPane(artifact({
      type: "lookup",
      query: "safe animals",
      results: [{ title: "Bunny", line: "A gentle animal.", source_id: "src-example123" }],
    }, []));
    expect(await view.findByText("A gentle animal.")).toBeInTheDocument();
    await waitFor(() => expect(view.queryByRole("heading", { name: "Sources" })).toBeNull());
    expect(view.queryByRole("link")).toBeNull();
  });

  test("desktop uses a side pane", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    try {
      const { container } = renderWithQueryClient(<ChatDocumentPane turnId={null} onClose={() => {}} />);
      const sidePane = container.querySelector('aside[aria-label="Reply details"]');
      expect(sidePane?.className).toContain("w-96");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  test("phone uses the kit sheet's bottom side", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    try {
      renderPane(artifact({
        type: "lookup",
        query: "safe animals",
        results: [{ title: "Bunny", line: "A gentle animal.", source_id: source.id }],
      }));
      await waitFor(() => expect(document.body.querySelector('[data-side="bottom"]')).not.toBeNull());
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });
});
