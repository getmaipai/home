import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { StorageStep, type StorageChoice } from "./StorageStep";

afterEach(cleanup);

const listing = (path: string, writable = true) => ({ path, parent: path === "/" ? null : "/", freeBytes: 500e9, writable, folders: [{ name: "Disks", path: `${path === "/" ? "" : path}/Disks`, writable: true }, { name: "Locked", path: `${path}/Locked`, writable: false }] });

function setup(rows: unknown[] = [], native: unknown = { status: "unavailable" }, chosen: StorageChoice = {}) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}${init?.body ? ` ${String(init.body)}` : ""}`);
    if (url.includes("/api/setup/storage/defaults")) return new Response(JSON.stringify({ records: "/Users/me/maipai/data", models: "/Users/me/maipai/data/models", models_need_bytes: 89 * 1024 ** 3, chosen }), { status: 200 });
    if (url.includes("/api/setup/folders/native")) return new Response(JSON.stringify(native), { status: 200 });
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
  test("the models card says how much room the plan needs, from the server's figure and not a fixed number", async () => {
    const h = setup();
    try {
      const view = render(<Host report={() => {}} />);
      await waitFor(() => expect(view.container.textContent).toContain("Plan for about 89 GB free there."));
      expect(view.container.textContent).not.toContain("200 GB");
    } finally { h.restore(); }
  });

  test("one computer shows both folders with the default kept, and nothing blocks Continue", async () => {
    const h = setup();
    try {
      const report = mock((_value: StorageChoice, _blocked: boolean) => {});
      const view = render(<Host report={report} />);
      expect(view.container.textContent).toContain("AI models");
      expect(view.container.textContent).toContain("Home's data");
      await waitFor(() => expect(view.getByText("/Users/me/maipai/data/models")).toBeTruthy());
      expect(view.getByText("/Users/me/maipai/data")).toBeTruthy();
      await waitFor(() => expect(report).toHaveBeenCalled());
      expect(report.mock.calls.at(-1)).toEqual([{}, false]);
      expect(h.calls.some((call) => call.startsWith("POST /api/setup/storage/check") || call.includes("/api/setup/storage/check"))).toBe(true);
      expect(h.calls.some((call) => call.includes("/api/setup/folders"))).toBe(false);
    } finally { h.restore(); }
  });

  test("a folder already saved on the server is shown again when the step opens empty", async () => {
    const h = setup([], { status: "unavailable" }, { records: "/Volumes/Big/home-data", models: "/Volumes/Big/models" });
    try {
      const report = mock((_value: StorageChoice, _blocked: boolean) => {});
      const view = render(<Host report={report} />);
      await waitFor(() => expect(view.getByText("/Volumes/Big/home-data")).toBeTruthy());
      expect(view.getByText("/Volumes/Big/models")).toBeTruthy();
    } finally { h.restore(); }
  });

  test("a drive without enough space keeps Continue blocked and says how much is needed", async () => {
    const h = setup([{ class: "models", kind: "refusal", id: "space-wizard:models", text: "The AI models needs about 200 GB, and this drive has 40 GB free. Choose a folder on a drive with more room.", fix: "Choose a folder on a drive with more free space." }]);
    try {
      const report = mock((_value: StorageChoice, _blocked: boolean) => {});
      const view = render(<Host report={report} />);
      await waitFor(() => expect(view.container.textContent).toContain("needs about 200 GB"));
      expect(report.mock.calls.at(-1)?.[1]).toBe(true);
      const cards = Array.from(view.container.querySelectorAll('[data-slot="card"]')) as HTMLElement[];
      const models = cards.find((card) => card.textContent?.includes("needs about 200 GB"))!;
      expect(models.dataset.state).toBe("invalid");
      expect(models.textContent).toContain("AI models");
      expect(cards.find((card) => card.textContent?.includes("Home's data"))!.dataset.state).toBe("valid");
    } finally { h.restore(); }
  });

  test("a split setup asks only for Home's data folder", () => {
    const h = setup();
    try {
      const view = render(<Host split report={() => {}} />);
      expect(view.container.textContent).not.toContain("Choose the AI models");
      expect(view.queryByText("AI models")).toBeNull();
      expect(view.container.textContent).toContain("Home's data");
      expect(view.container.textContent).toContain("set on your other computer");
    } finally { h.restore(); }
  });

  test("choosing a folder in the picker runs the placement check and shows the good result", async () => {
    const h = setup();
    try {
      const report = mock((_value: StorageChoice, _blocked: boolean) => {});
      const view = render(<Host report={report} />);
      await act(async () => { fireEvent.click(view.getAllByRole("button", { name: "Choose a folder" })[1]!); });
      await waitFor(() => expect(view.getByRole("button", { name: "Use this folder" })).toBeTruthy());
      await act(async () => { fireEvent.click(view.getByRole("button", { name: /Disks/ })); });
      await waitFor(() => expect(view.container.textContent).toContain("/Disks"));
      await act(async () => { fireEvent.click(view.getByRole("button", { name: "Use this folder" })); });
      await waitFor(() => expect(view.container.textContent).toContain("Home can use this folder."));
      expect(h.calls.some((call) => call.startsWith("POST /api/setup/storage/check") && call.includes("\"models\":\"/Users/me/Disks\""))).toBe(true);
      expect(report.mock.calls.at(-1)).toEqual([{ models: "/Users/me/Disks" }, false]);
      await act(async () => { fireEvent.click(view.getByRole("button", { name: "Keep the default" })); });
      await waitFor(() => expect(report.mock.calls.at(-1)).toEqual([{ models: undefined }, false]));
    } finally { h.restore(); }
  });

  test("the computer's own folder window is used first and its choice is checked", async () => {
    const h = setup([], { status: "chosen", path: "/Volumes/Big/models" });
    try {
      const report = mock((_value: StorageChoice, _blocked: boolean) => {});
      const view = render(<Host report={report} />);
      await act(async () => { fireEvent.click(view.getAllByRole("button", { name: "Choose a folder" })[1]!); });
      await waitFor(() => expect(view.getByText("/Volumes/Big/models")).toBeTruthy());
      expect(view.queryByRole("button", { name: "Use this folder" })).toBeNull();
      expect(h.calls.some((call) => call.startsWith("POST /api/setup/folders/native") && call.includes('"folder":"models"'))).toBe(true);
      await waitFor(() => expect(report.mock.calls.at(-1)).toEqual([{ models: "/Volumes/Big/models" }, false]));
    } finally { h.restore(); }
  });

  test("a folder Home cannot write to, picked in the window, is explained inside its card", async () => {
    const h = setup([], { status: "refused", error: "Home can't save files in that folder. Choose a folder you own, or make a new one." });
    try {
      const view = render(<Host report={() => {}} />);
      await act(async () => { fireEvent.click(view.getAllByRole("button", { name: "Choose a folder" })[1]!); });
      await waitFor(() => expect(view.container.textContent).toContain("Home can't save files in that folder"));
      const card = Array.from(view.container.querySelectorAll('[data-slot="card"]')).find((c) => c.textContent?.includes("Home can't save files in that folder"))!;
      expect(card.textContent).toContain("AI models");
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
