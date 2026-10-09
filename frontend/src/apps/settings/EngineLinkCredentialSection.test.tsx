import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EngineLinkCredentialSection } from "@/apps/settings/EngineLinkCredentialSection";

afterEach(cleanup);

function stubFetch(confirmStatus: number, onConfirm: (body: { check_code: string }) => void) {
  return mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
    if (url.endsWith("/api/engine-link/credentials") && method === "GET") return json({ paired: false });
    if (url.endsWith("/api/engine-link/pair") && method === "POST") return json({ code: "ABCDEFGHJKLM", expires_at: new Date(Date.now() + 600_000).toISOString() });
    if (url.endsWith("/api/engine-link/host-key/scan")) return json({ scanned: true });
    if (url.endsWith("/api/engine-link/host-key/confirm")) {
      onConfirm(JSON.parse(String(init?.body)) as { check_code: string });
      return confirmStatus === 200 ? json({ paired: true }) : json({ error: "The check code did not match the engine computer" }, confirmStatus);
    }
    return Promise.reject(new Error(`unstubbed fetch: ${url} ${method}`));
  }) as unknown as typeof fetch;
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><EngineLinkCredentialSection /></QueryClientProvider>);
}

describe("EngineLinkCredentialSection check code", () => {
  test("asks the owner to type the code and sends what was typed", async () => {
    const original = globalThis.fetch;
    const sent: string[] = [];
    globalThis.fetch = stubFetch(200, (body) => sent.push(body.check_code));
    try {
      const { findByText, findByLabelText, getByText } = mount();
      fireEvent.click(await findByText("Pair engine computer"));
      fireEvent.click(await findByText("Check the engine computer"));
      const input = await findByLabelText("Check code from the engine computer");
      expect(getByText("Type the check code shown on the engine computer.")).toBeTruthy();
      fireEvent.change(input, { target: { value: "abcd-efgh-jklm" } });
      fireEvent.click(getByText("Pin this computer"));
      await waitFor(() => expect(sent).toEqual(["abcd-efgh-jklm"]));
    } finally { globalThis.fetch = original; }
  });

  test("a wrong code shows the error and clears the box", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = stubFetch(400, () => {});
    try {
      const { findByText, findByLabelText, getByText } = mount();
      fireEvent.click(await findByText("Pair engine computer"));
      fireEvent.click(await findByText("Check the engine computer"));
      const input = await findByLabelText("Check code from the engine computer") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "WRONGWRONGWR" } });
      fireEvent.click(getByText("Pin this computer"));
      await findByText("The check code did not match the engine computer");
      expect(input.value).toBe("");
    } finally { globalThis.fetch = original; }
  });

  // PAIR-COPY-01: the panel shows the hub's own words as they are, so the person reads the fix (the https:// address).
  test("a refused pairing start shows the hub's message as it is, not a generic one", async () => {
    const original = globalThis.fetch;
    const message = "Pairing only works when Home is opened at a secure address that starts with https://. Open Home through its https:// address, then try again.";
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (url.endsWith("/api/engine-link/credentials")) return json({ paired: false });
      if (url.endsWith("/api/engine-link/pair") && (init?.method ?? "GET") === "POST") return json({ error: message }, 400);
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;
    try {
      const { findByText, queryByText } = mount();
      fireEvent.click(await findByText("Pair engine computer"));
      expect(await findByText(message)).toBeTruthy();
      expect(queryByText("Could not update the engine computer link.")).toBeNull();
    } finally { globalThis.fetch = original; }
  });

  test("a locked pairing (429) returns to the start", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = stubFetch(429, () => {});
    try {
      const { findByText, findByLabelText, getByText } = mount();
      fireEvent.click(await findByText("Pair engine computer"));
      fireEvent.click(await findByText("Check the engine computer"));
      fireEvent.change(await findByLabelText("Check code from the engine computer"), { target: { value: "WRONGWRONGWR" } });
      fireEvent.click(getByText("Pin this computer"));
      await findByText("Pair engine computer");
    } finally { globalThis.fetch = original; }
  });
});
