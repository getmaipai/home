import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PhoneHeaderExtras } from "@/shell/PhoneHeaderExtras";
import { renderWithQueryClient } from "../../tests/renderWithQueryClient";

afterEach(cleanup);

function stubFetch(byPath: Record<string, unknown>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const match = Object.entries(byPath).find(([path]) => url.includes(path));
    if (!match) throw new Error(`unstubbed fetch: ${url}`);
    return Promise.resolve(new Response(JSON.stringify(match[1]), { status: 200 }));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function renderExtras(overrides: Partial<Parameters<typeof PhoneHeaderExtras>[0]> = {}) {
  const openSearch = mock(() => {});
  const close = mock(() => {});
  const setAppearance = mock(() => {});
  const result = renderWithQueryClient(
    <MemoryRouter>
      <PhoneHeaderExtras openSearch={openSearch} close={close} setAppearance={setAppearance} {...overrides} />
    </MemoryRouter>,
  );
  return { ...result, openSearch, close, setAppearance };
}

describe("PhoneHeaderExtras", () => {
  test("Search opens the palette and closes the menu", () => {
    const restore = stubFetch({ "/api/notifications": [] });
    try {
      const { getByText, openSearch, close } = renderExtras();
      fireEvent.click(getByText("Search"));
      expect(openSearch).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  test("from a light page, the row offers dark and closes the menu", () => {
    const restore = stubFetch({ "/api/notifications": [] });
    document.documentElement.classList.add("light");
    try {
      const { getByText, setAppearance, close } = renderExtras();
      fireEvent.click(getByText("Switch to dark appearance"));
      expect(setAppearance).toHaveBeenCalledWith("dark");
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      restore();
      document.documentElement.classList.remove("light");
    }
  });

  test("from a dark page, the row offers light", () => {
    const restore = stubFetch({ "/api/notifications": [] });
    document.documentElement.classList.add("dark");
    try {
      const { getByText, setAppearance } = renderExtras();
      fireEvent.click(getByText("Switch to light appearance"));
      expect(setAppearance).toHaveBeenCalledWith("light");
    } finally {
      restore();
      document.documentElement.classList.remove("dark");
    }
  });

  // Same query key/cache as NotificationBell.tsx's own poll - this is
  // what lets the phone header's avatar dot and this row's own count
  // agree without a second fetch loop.
  test("Notifications links to the history page and shows the real pending count", async () => {
    const restore = stubFetch({
      "/api/notifications": [
        { id: "n1", typeId: "model.download_ready", text: "Model ready", channels: ["in_app"], createdAt: "2026-09-05T00:00:00.000Z", readAt: null, dismissedAt: null, subjectTurnId: null, memoryIds: null, toast: true },
      ],
    });
    try {
      const { findByRole, close } = renderExtras();
      const link = await findByRole("link", { name: "Notifications (1)" });
      expect(link).toHaveAttribute("href", "/notifications");
      fireEvent.click(link);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  test("with nothing pending, the count is omitted rather than showing (0)", async () => {
    const restore = stubFetch({ "/api/notifications": [] });
    try {
      const { findByRole } = renderExtras();
      expect(await findByRole("link", { name: "Notifications" })).toBeInTheDocument();
    } finally {
      restore();
    }
  });
});
