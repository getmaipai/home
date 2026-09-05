import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ClonedVoicesSection } from "@/apps/settings/ClonedVoicesSection";
import type { Roster } from "@/lib/api";

// `@testing-library/dom`'s global `screen` singleton is computed once at
// module-load time, before Bun's test preload finishes registering
// happy-dom's globals - it permanently falls back to a stub that throws.
// Every query here comes from render()'s own returned queries instead
// (ChatPage.test.tsx's own header comment already documents this).

afterEach(cleanup);

function makePerson(overrides: Partial<Roster> = {}): Roster {
  return {
    id: "person-jesse",
    display_name: "Jesse",
    nickname: null,
    role: "owner",
    avatar_seed: "person-jesse",
    source: "hub",
    local_only: false,
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null,
    hasSecret: true,
    ...overrides,
  } as Roster;
}

const VOICES = [
  { id: "voice-abc", label: "Dad's voice", creatorId: "person-jesse", creatorName: "Jesse", bytes: 4, createdAt: "2026-09-04T00:00:00.000Z" },
  { id: "voice-xyz", label: "Nova's voice", creatorId: "person-nova", creatorName: "Nova", bytes: 4, createdAt: "2026-09-04T00:00:00.000Z" },
];

function stubFetch(
  overrides: { onUpload?: (label: string) => void; onSelect?: (id: string) => void; onDelete?: (id: string) => void } = {},
) {
  let voices = VOICES;
  return mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    if (url.endsWith("/api/voice/cloned") && method === "GET") {
      return Promise.resolve(new Response(JSON.stringify({ voices }), { status: 200 }));
    }
    if (url.includes("/api/settings?scope=")) {
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    }
    if (url.endsWith("/api/voice/cloned") && method === "POST") {
      const body = init?.body as FormData;
      overrides.onUpload?.(String(body.get("label")));
      voices = [...voices, { id: "voice-new", label: String(body.get("label")), creatorId: "person-jesse", creatorName: "Jesse", bytes: 4, createdAt: "now" }];
      return Promise.resolve(new Response(JSON.stringify(voices[voices.length - 1]), { status: 201 }));
    }
    if (url.includes("/select") && method === "POST") {
      const id = url.match(/\/cloned\/([^/]+)\/select/)?.[1] ?? "";
      overrides.onSelect?.(id);
      return Promise.resolve(
        new Response(
          JSON.stringify({ key: "tts.voice_id", value: `http://127.0.0.1:8787/api/voice/cloned/${id}/file`, source: "user", label: "Speaking voice", level: "basic", secret: false }),
          { status: 200 },
        ),
      );
    }
    if (url.includes("/delete") && method === "POST") {
      const id = url.match(/\/cloned\/([^/]+)\/delete/)?.[1] ?? "";
      overrides.onDelete?.(id);
      voices = voices.filter((v) => v.id !== id);
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    }
    return Promise.reject(new Error(`unstubbed fetch: ${url} ${method}`));
  }) as unknown as typeof fetch;
}

describe("ClonedVoicesSection", () => {
  test("lists existing cloned voices with who uploaded them", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch();
    try {
      const { findByText } = render(<ClonedVoicesSection person={makePerson()} />);
      await findByText("Dad's voice");
      await findByText("Uploaded by Nova");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("shows no delete button for a voice neither uploaded by, nor viewable-as-admin", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch();
    try {
      const adult = makePerson({ id: "person-marlow", display_name: "Marlow", role: "adult" });
      const { findByText, findAllByText, queryAllByText } = render(<ClonedVoicesSection person={adult} />);
      await findByText("Dad's voice");
      await findByText("Nova's voice");
      // Marlow uploaded neither and isn't owner/admin: no Delete anywhere.
      expect(queryAllByText("Delete").length).toBe(0);
      // Can still select either voice, though.
      expect((await findAllByText("Use this voice")).length).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("an owner sees Delete on every voice, not just their own", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch();
    try {
      const { findAllByText } = render(<ClonedVoicesSection person={makePerson({ role: "owner" })} />);
      const deletes = await findAllByText("Delete");
      expect(deletes.length).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("uploading sends the real file and label, then the new voice appears", async () => {
    const originalFetch = globalThis.fetch;
    let uploadedLabel: string | null = null;
    globalThis.fetch = stubFetch({ onUpload: (label) => (uploadedLabel = label) });
    try {
      const { container, findByPlaceholderText, findByText } = render(<ClonedVoicesSection person={makePerson()} />);
      await findByText("Dad's voice");

      const labelInput = await findByPlaceholderText("Label (e.g. Dad's voice)");
      fireEvent.change(labelInput, { target: { value: "Mom's voice" } });

      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File([new Uint8Array([1, 2, 3])], "sample.wav", { type: "audio/wav" });
      fireEvent.change(fileInput, { target: { files: [file] } });

      // fireEvent.click on the submit button routes through the browser's
      // native constraint validation first (the file input's own
      // `required` attribute), which happy-dom doesn't recognize as
      // satisfied by a files list assigned this way - submitting the
      // form directly exercises the real onSubmit handler without that
      // unrelated gate.
      fireEvent.submit(container.querySelector("form")!);
      await waitFor(() => expect(uploadedLabel).toBe("Mom's voice"));
      await findByText("Mom's voice");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("selecting a voice calls the dedicated select endpoint and shows it's in use", async () => {
    const originalFetch = globalThis.fetch;
    let selectedId: string | null = null;
    globalThis.fetch = stubFetch({ onSelect: (id) => (selectedId = id) });
    try {
      const { findAllByText, findByText } = render(<ClonedVoicesSection person={makePerson()} />);
      await findByText("Dad's voice");
      fireEvent.click((await findAllByText("Use this voice"))[0]!);
      await waitFor(() => expect(selectedId).toBe("voice-abc"));
      await findByText("Currently using a cloned voice.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("deleting a voice calls the dedicated delete endpoint and removes it from the list", async () => {
    const originalFetch = globalThis.fetch;
    let deletedId: string | null = null;
    globalThis.fetch = stubFetch({ onDelete: (id) => (deletedId = id) });
    try {
      const { findAllByText, findByText, queryByText } = render(<ClonedVoicesSection person={makePerson()} />);
      await findByText("Dad's voice");
      fireEvent.click((await findAllByText("Delete"))[0]!);
      await waitFor(() => expect(deletedId).toBe("voice-abc"));
      await waitFor(() => expect(queryByText("Dad's voice")).toBeNull());
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
