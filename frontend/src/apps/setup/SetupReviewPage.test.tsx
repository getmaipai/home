import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SetupReviewPage } from "./SetupReviewPage";

afterEach(cleanup);

function setupReviewHarness() {
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("/api/repairs/review")) return Response.json({ engine: "this_computer", checks: [{ id: "engine", title: "Engine service", state: "green", text: "Checked by the Stack." }] });
    if (url.includes("/api/settings")) return Response.json({ key: "engines.stack.where", value: "this_computer" });
    return Response.json({});
  }) as unknown as typeof fetch;
  const rendered = render(<MemoryRouter initialEntries={["/setup/review"]}><Routes><Route path="/setup/review" element={<SetupReviewPage />} /><Route path="/repairs" element={<p>Repairs</p>} /></Routes></MemoryRouter>);
  return { ...rendered, requests, restore: () => { globalThis.fetch = original; } };
}

describe("SetupReviewPage", () => {
  test("review mode shows exactly the four production screens and no owner step", async () => {
    const h = setupReviewHarness();
    try {
      await waitFor(() => expect(h.container.textContent).toContain("How should Home run?"));
      expect(h.getAllByRole("button", { name: "Continue" })).toHaveLength(1);
      await fireEvent.click(h.getByRole("button", { name: "Continue" }));
      expect(h.container.textContent).toContain("Choose where to store data");
      await fireEvent.click(h.getByRole("button", { name: "Continue" }));
      expect(h.container.textContent).toContain("Checking your computer");
      expect(h.container.textContent).toContain("Engine service");
      await fireEvent.click(h.getByRole("button", { name: "Continue" }));
      expect(h.container.textContent).toContain("Your setup plan");
      expect(h.container.textContent).not.toContain("Create your owner account");
      expect(h.container.textContent).not.toContain("Owner or admin?");
    } finally { h.restore(); }
  });

  test("review never requests a setup endpoint and an unchanged review writes nothing", async () => {
    const h = setupReviewHarness();
    try {
      await waitFor(() => expect(h.container.textContent).toContain("How should Home run?"));
      for (let i = 0; i < 3; i++) await fireEvent.click(h.getByRole("button", { name: "Continue" }));
      await fireEvent.click(h.getByRole("button", { name: "Done" }));
      await waitFor(() => expect(h.container.textContent).toContain("Repairs"));
      expect(h.requests.some((request) => request.includes("/api/setup/"))).toBe(false);
      expect(h.requests.some((request) => request.startsWith("PUT "))).toBe(false);
    } finally { h.restore(); }
  });

  test("storage location stays read only", async () => {
    const h = setupReviewHarness();
    try {
      await waitFor(() => expect(h.container.textContent).toContain("How should Home run?"));
      await fireEvent.click(h.getByRole("button", { name: "Continue" }));
      expect(h.container.textContent).toContain("Home uses its ready-to-use default folder.");
      expect(h.container.querySelector("input,button[role=radio]")).toBeNull();
    } finally { h.restore(); }
  });
});
