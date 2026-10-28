// MODEL-ADD-01 S4: the add panel reads a link first (no download), shows what the repository states, then adds on confirm.
import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { AddChatModel } from "@/apps/settings/AddChatModel";
import areasFile from "@maipai/spec/settings/areas.json";

// The words are the spec's: the same card copy the page hands the panel.
const copy = (areasFile.areas as unknown as Array<{ sections: Array<{ cards?: Array<{ view?: string; copy?: Record<string, string> }> }> }>)
  .flatMap((area) => area.sections).flatMap((section) => section.cards ?? []).find((card) => card.view === "ai.glance")?.copy ?? {};

const realFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

const found = { repo: "owner/Tiny-7B-GGUF", file: "Tiny-7B-Q4_K_M.gguf", sizeBytes: 4e9, sha256: "a".repeat(64), licence: "apache-2.0", architecture: "llama", verifiedArchitecture: true, ramBytes: 6e9, fits: "fits" };

test("reading a link shows name, licence and the untested label; Download and use adds it", async () => {
  const paths: string[] = [];
  let added = 0;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const path = (typeof input === "string" ? input : input.toString()).split("?")[0]!;
    paths.push(path);
    if (path.endsWith("/api/ai/models/inspect")) return Promise.resolve(Response.json(found));
    if (path.endsWith("/api/ai/models/add")) return Promise.resolve(Response.json({ ok: true, id: "added-tiny", label: "Tiny-7B", jobs: [] }));
    return Promise.resolve(Response.json({}));
  }) as typeof fetch;
  const view = renderWithQueryClient(<AddChatModel copy={copy} onAdded={() => { added += 1; }} />);
  fireEvent.change(view.getByRole("textbox"), { target: { value: "https://huggingface.co/owner/Tiny-7B-GGUF" } });
  fireEvent.click(view.getByRole("button", { name: "Read the link" }));
  const card = await view.findByTestId("ai-add-model-found");
  expect(card.textContent).toContain("apache-2.0");
  expect(card.textContent).toContain("Not tested by MaiPai");
  expect(paths.some((path) => path.endsWith("/api/ai/models/add"))).toBe(false);
  fireEvent.click(view.getByRole("button", { name: "Download and use" }));
  await waitFor(() => expect(added).toBe(1));
  expect(view.queryByTestId("ai-add-model-found")).toBeNull();
});

test("a refusal shows its sentence", async () => {
  globalThis.fetch = ((_input: RequestInfo | URL) => Promise.resolve(Response.json({ error: "That repository needs a licence agreement. Pick another.", code: "add_model" }, { status: 400 }))) as typeof fetch;
  const view = renderWithQueryClient(<AddChatModel copy={copy} />);
  fireEvent.change(view.getByRole("textbox"), { target: { value: "owner/gated" } });
  fireEvent.click(view.getByRole("button", { name: "Read the link" }));
  expect(await view.findByText("That repository needs a licence agreement. Pick another.")).toBeTruthy();
});
