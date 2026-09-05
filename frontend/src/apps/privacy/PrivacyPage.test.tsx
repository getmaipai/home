import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, waitFor } from "@testing-library/react";
import { PrivacyPage, joinNames } from "@/apps/privacy/PrivacyPage";
import type { PrivacyConnection } from "@/lib/api";

afterEach(cleanup);

// Every query comes from render()'s own returned queries, never the
// global `screen` singleton - ChatPage.test.tsx's header comment
// documents why that singleton is unusable under bun's preload.

function connection(over: Partial<PrivacyConnection> = {}): PrivacyConnection {
  return {
    id: "weather:open-meteo",
    source: "Weather",
    sourceKind: "plugin",
    destination: "Open-Meteo (open-meteo.com), a free public weather API",
    when: "each time the family asks for the weather somewhere",
    what: "the place name spoken in the request",
    who: "Open-Meteo",
    optIn: true,
    retention: "unknown, see Open-Meteo's own policy",
    ...over,
  };
}

function stubPrivacy(body: { connections: PrivacyConnection[]; offlinePlugins: string[] }) {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/privacy")) {
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }
    return Promise.reject(new Error(`unstubbed fetch: ${url}`));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe("the privacy page", () => {
  // The org standard names exactly four questions every row must answer:
  // each outbound connection, when it happens, what it carries, and who
  // receives it. A page that renders the list but drops one of them does
  // not satisfy it, so all four are asserted on a real row.
  test("answers all four questions for each connection", async () => {
    const restore = stubPrivacy({ connections: [connection()], offlinePlugins: [] });
    try {
      const { findByText, getByText } = render(<PrivacyPage />);
      await findByText("Open-Meteo (open-meteo.com), a free public weather API");
      expect(getByText(/each time the family asks for the weather/)).toBeInTheDocument();
      expect(getByText(/the place name spoken in the request/)).toBeInTheDocument();
      expect(getByText("Who gets it:").parentElement?.textContent).toContain("Open-Meteo");
      expect(getByText(/unknown, see Open-Meteo's own policy/)).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("shows the hub's own connections next to the packages', in one table", async () => {
    const restore = stubPrivacy({
      connections: [
        connection({
          id: "platform:language-models",
          source: "MaiPai Home",
          sourceKind: "platform",
          destination: "huggingface.co",
          who: "huggingface.co",
        }),
        connection(),
      ],
      offlinePlugins: [],
    });
    try {
      const { findByLabelText } = render(<PrivacyPage />);
      const list = await findByLabelText("Outbound connections");
      expect(list.querySelectorAll("li")).toHaveLength(2);
      expect(list.textContent).toContain("MaiPai Home itself");
      expect(list.textContent).toContain("Weather");
    } finally {
      restore();
    }
  });

  test("counts the connections in the heading, so nothing is quietly added below the fold", async () => {
    const restore = stubPrivacy({
      connections: [connection(), connection({ id: "define:dictionaryapi-dev" })],
      offlinePlugins: [],
    });
    try {
      const { findByText } = render(<PrivacyPage />);
      expect(await findByText("What leaves your house (2)")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  // A table of four rows with two packages missing reads like an
  // omission unless the missing ones are named.
  test("names the packages that connect to nothing at all", async () => {
    const restore = stubPrivacy({ connections: [connection()], offlinePlugins: ["Remember", "Recall"] });
    try {
      const { findByText } = render(<PrivacyPage />);
      expect(await findByText(/Remember and Recall work entirely on this computer/)).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("omits the never-leaves section rather than showing an empty one", async () => {
    const restore = stubPrivacy({ connections: [connection()], offlinePlugins: [] });
    try {
      const { findByText, queryByText } = render(<PrivacyPage />);
      await findByText("What leaves your house (1)");
      expect(queryByText("Never leaves your house")).toBeNull();
    } finally {
      restore();
    }
  });

  test("states the zero-phone-home promise in plain words", async () => {
    const restore = stubPrivacy({ connections: [connection()], offlinePlugins: [] });
    try {
      const { findByText } = render(<PrivacyPage />);
      expect(
        await findByText(/We do not collect usage information, crash reports, or statistics/),
      ).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("offers a retry rather than a blank page when the fetch fails", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "nope" }), { status: 500 })),
    ) as unknown as typeof fetch;
    try {
      const { findByRole } = render(<PrivacyPage />);
      expect(await findByRole("button", { name: "Try again" })).toBeInTheDocument();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("is readable while it loads instead of flashing an empty table", async () => {
    const restore = stubPrivacy({ connections: [], offlinePlugins: [] });
    try {
      const { getByRole } = render(<PrivacyPage />);
      expect(getByRole("status")).toHaveTextContent("Loading the privacy page");
      await waitFor(() => {});
    } finally {
      restore();
    }
  });
});

// A code review (2026-09-05) caught both of these on a page whose whole
// job is to be accurate and readable.
describe("privacy page copy details", () => {
  test("the hub's own rows do not claim a toggle that does not exist", async () => {
    const restore = stubPrivacy({
      connections: [
        connection({ id: "platform:tts-model", source: "MaiPai Home", sourceKind: "platform", optIn: true }),
      ],
      offlinePlugins: [],
    });
    try {
      const { findByLabelText } = render(<PrivacyPage />);
      const list = await findByLabelText("Outbound connections");
      expect(list.textContent).toContain("MaiPai Home itself");
      expect(list.textContent).not.toContain("only if you turn it on");
    } finally {
      restore();
    }
  });

  test("a package row still shows whether it is opt-in", async () => {
    const restore = stubPrivacy({ connections: [connection({ optIn: true })], offlinePlugins: [] });
    try {
      const { findByLabelText } = render(<PrivacyPage />);
      const list = await findByLabelText("Outbound connections");
      expect(list.textContent).toContain("Weather · only if you turn it on");
    } finally {
      restore();
    }
  });
});

describe("joinNames", () => {
  test("reads as a sentence at one, two, and three names", () => {
    expect(joinNames(["Remember"])).toBe("Remember");
    expect(joinNames(["Remember", "Recall"])).toBe("Remember and Recall");
    expect(joinNames(["Remember", "Recall", "Notes"])).toBe("Remember, Recall, and Notes");
  });
});
