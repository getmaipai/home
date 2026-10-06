import { afterEach, describe, expect, test } from "bun:test";
import { cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import { ChatThread } from "@/apps/chat/ChatThread";
import { DATE_DIVIDER_GAP_MS, dateDividerLabel, needsDateDivider } from "@/apps/chat/chatDateDivider";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

afterEach(cleanup);

describe("needsDateDivider", () => {
  const at = new Date(2026, 9, 6, 9, 0);
  test("the first message opens the conversation with a line", () => {
    expect(needsDateDivider(undefined, at)).toBe(true);
  });
  test("a quick follow-up the same day has none", () => {
    expect(needsDateDivider(new Date(2026, 9, 6, 8, 50), at)).toBe(false);
  });
  test("a pause of an hour or more earns a line", () => {
    expect(needsDateDivider(new Date(at.getTime() - DATE_DIVIDER_GAP_MS), at)).toBe(true);
  });
  test("a new calendar day earns a line even after a short gap", () => {
    expect(needsDateDivider(new Date(2026, 9, 5, 23, 59), new Date(2026, 9, 6, 0, 5))).toBe(true);
  });
});

describe("dateDividerLabel", () => {
  const now = new Date(2026, 9, 6, 14, 0);
  test("names today, yesterday and a weekday, then dates", () => {
    expect(dateDividerLabel(new Date(2026, 9, 6, 9, 5), now)).toStartWith("Today ");
    expect(dateDividerLabel(new Date(2026, 9, 5, 21, 5), now)).toStartWith("Yesterday ");
    expect(dateDividerLabel(new Date(2026, 9, 2, 8, 0), now)).toStartWith("Friday ");
    expect(dateDividerLabel(new Date(2026, 8, 20, 8, 0), now)).toStartWith("Sep 20");
    expect(dateDividerLabel(new Date(2025, 8, 20, 8, 0), now)).toStartWith("Sep 20, 2025");
  });
});

const NOOP: ChatModelAdapter = { run: async function* () { /* seeded */ } };
const done = { type: "complete", reason: "stop" } as const;

function Harness({ messages }: { messages: ThreadMessageLike[] }) {
  const runtime = useLocalRuntime(NOOP, { initialMessages: messages });
  return <AssistantRuntimeProvider runtime={runtime}><ChatThread /></AssistantRuntimeProvider>;
}

describe("the thread's date lines", () => {
  test("one line opens the conversation and one marks a return after a pause, none between quick messages", async () => {
    const t = (h: number, m: number) => new Date(2026, 9, 6, h, m);
    const view = renderWithQueryClient(
      <MemoryRouter>
        <Harness
          messages={[
            { role: "user", content: "Morning", createdAt: t(8, 0) },
            { role: "assistant", content: "Hello.", createdAt: t(8, 1), status: done },
            { role: "user", content: "Later question", createdAt: t(11, 0) },
            { role: "assistant", content: "Later answer.", createdAt: t(11, 1), status: done },
          ]}
        />
      </MemoryRouter>,
    );
    const lines = await view.findAllByRole("separator");
    const labels = lines.filter((el) => el.getAttribute("data-slot") === "day-divider").map((el) => el.getAttribute("aria-label"));
    expect(labels).toHaveLength(2);
  });
});
