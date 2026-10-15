import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { StorageStep, type StorageChoice } from "./StorageStep";

afterEach(cleanup);

const listing = (path: string, writable = true) => ({ path, parent: path === "/" ? null : "/", freeBytes: 500e9, writable, folders: [{ name: "Disks", path: `${path === "/" ? "" : path}/Disks`, writable: true }, { name: "Locked", path: `${path}/Locked`, writable: false }] });

function setup(rows: unknown[] = []) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}${init?.body ? ` ${String(init.body)}` : ""}`);
    if (url.includes("/api/setup/storage/check")) return new Response(JSON.stringify({ rows }), { status: 200 });
    if (url.includes("/api/setup/folders") && init?.method === "POST") return new Response(JSON.stringify({ name: "Models", path: "/Disks/Models", writable: true }), { status: 200 });
    if (url.includes("/api/setup/folders")) {
      const path = new URL(url, "http://x").searchParams.get("path") ?? "/Users/me";
      return new Response(JSON.stringify(listing(path)), { status: 200 });
    }
    throw new Error(`Unstubbed request ${url}`);
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function Host({ split = false, report }: { split?: boolean; report: (value: StorageChoice, blocked: boolean) => void }) {
  const [value, setValue] = useState<StorageChoice>({});
  return <StorageStep split={split} value={value} onChange={(next, blocked) => { setValue(next); report(next, blocked); }} />;
}

describe("StorageStep", () => {
  test("one computer shows both folders with the default kept, and nothing blocks Continue", async () => {
    const h = setup();
    try {
      const report = mock((_value: StorageChoice, _blocked: boolean) => {});
      const view = render(<Host report={report} />);
      expect(view.container.textContent).toContain("AI models folder");
      expect(view.container.textContent).toContain("Home's data folder");
      expect(view.getAllByText("The ready-to-use folder (recommended)")).toHaveLength(2);
      await waitFor(() => expect(report).toHaveBeenCalled());
      expect(report.mock.calls.at(-1)).toEqual([{}, false]);
      expect(h.calls).toEqual([]);
    } finally { h.restore(); }
  });

  test("a split setup asks only for Home's data folder", () => {
    const h = setup();
    try {
      const view = render(<Host split report={() => {}} />);
      expect(view.container.textContent).not.toContain("AI models folder");
      expect(view.container.textContent).toContain("Home's data folder");
      expect(view.container.textContent).toContain("you choose its models folder there");
    } finally { h.restore(); }
  });

  test("choosing a folder in the picker runs the placement check and shows the good result", async () => {
    const h = setup();
    try {
      const report = mock((_value: StorageChoice, _blocked: boolean) => {});
      const view = render(<Host report={report} />);
      await act(async () => { fireEvent.click(view.getAllByRole("button", { name: "Choose a folder" })[0]!); });
      await waitFor(() => expect(view.getByRole("button", { name: "Use this folder" })).toBeTruthy());
      await act(async () => { fireEvent.click(view.getByRole("button", { name: /Disks/ })); });
      await waitFor(() => expect(view.container.textContent).toContain("/Disks"));
      await act(async () => { fireEvent.click(view.getByRole("button", { name: "Use this folder" })); });
      await waitFor(() => expect(view.container.textContent).toContain("Home can use your choice."));
      expect(h.calls.some((call) => call.startsWith("POST /api/setup/storage/check") && call.includes("\"models\":\"/Users/me/Disks\""))).toBe(true);
      expect(report.mock.calls.at(-1)).toEqual([{ models: "/Users/me/Disks" }, false]);
      await act(async () => { fireEvent.click(view.getByRole("button", { name: "Keep the default" })); });
      await waitFor(() => expect(report.mock.calls.at(-1)).toEqual([{ models: undefined }, false]));
    } finally { h.restore(); }
  });

  test("a refusal is shown in plain words with the fix and blocks Continue", async () => {
    const h = setup([{ class: "records", kind: "refusal", id: "write", text: "The service account cannot write to records.", fix: "Choose a folder it can write to." }]);
    try {
      const report = mock((_value: StorageChoice, _blocked: boolean) => {});
      const view = render(<Host report={report} />);
      await act(async () => { fireEvent.click(view.getAllByRole("button", { name: "Choose a folder" })[1]!); });
      await waitFor(() => expect(view.getByRole("button", { name: "Use this folder" })).toBeTruthy());
      await act(async () => { fireEvent.click(view.getByRole("button", { name: "Use this folder" })); });
      await waitFor(() => expect(view.container.textContent).toContain("The service account cannot write to records. Choose a folder it can write to."));
      expect(view.container.textContent).toContain("Home can't use this folder");
      expect(report.mock.calls.at(-1)![1]).toBe(true);
    } finally { h.restore(); }
  });

  test("a warning is shown but does not block Continue", async () => {
    const h = setup([{ class: "models", kind: "warning", id: "space", text: "This drive has little free space.", fix: "Free some space soon." }]);
    try {
      const report = mock((_value: StorageChoice, _blocked: boolean) => {});
      const view = render(<Host report={report} />);
      await act(async () => { fireEvent.click(view.getAllByRole("button", { name: "Choose a folder" })[0]!); });
      await waitFor(() => expect(view.getByRole("button", { name: "Use this folder" })).toBeTruthy());
      await act(async () => { fireEvent.click(view.getByRole("button", { name: "Use this folder" })); });
      await waitFor(() => expect(view.container.textContent).toContain("This drive has little free space. Free some space soon."));
      expect(report.mock.calls.at(-1)![1]).toBe(false);
    } finally { h.restore(); }
  });

  test("a listing that fails says what to do and offers Try again", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock(async () => new Response(JSON.stringify({ error: "That folder is not there any more. Go up a level and pick another folder." }), { status: 404 })) as unknown as typeof fetch;
    try {
      const view = render(<Host report={() => {}} />);
      await act(async () => { fireEvent.click(view.getAllByRole("button", { name: "Choose a folder" })[0]!); });
      await waitFor(() => expect(view.container.textContent).toContain("Go up a level and pick another folder"));
    } finally { globalThis.fetch = original; }
  });
});
