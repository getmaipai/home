// ACTIVITY-01d: the header's Running now button, wired to the jobs and
// approvals routes and to the open chat's reply.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { RunningNowButton } from "@/shell/RunningNowButton";
import { ChatHeaderDataProvider, useSetChatHeaderData, type ChatHeaderData } from "@/apps/chat/chatHeaderData";
import type { HomeJobView } from "@/lib/api";
import { renderWithQueryClient } from "../../tests/renderWithQueryClient";

// The kit's overlay counter has no reader; record what the button asks of it.
const tvNavCalls: boolean[] = [];
mock.module("@maipai/ui/src/tvNav", () => ({ pauseTvNavForOverlay: (open: boolean) => { tvNavCalls.push(open); } }));
const tvNavPaused = () => tvNavCalls.filter(Boolean).length > tvNavCalls.filter((open) => !open).length;

afterEach(async () => {
  cleanup();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
});

const owner = { id: "sage", role: "owner" };
const child = { id: "nova", role: "child" };

function stubJobs(jobs: HomeJobView[]) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/api/jobs")) return Promise.resolve(Response.json(jobs));
    return Promise.resolve(Response.json({ ok: true, id: "x" }));
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function ChatReply({ onStop, running = true }: { onStop: () => void; running?: boolean }) {
  const data: ChatHeaderData = { title: "Trip plan", ttsAvailable: false, autoReadReplies: false, onAutoReadRepliesChange: () => {}, onRename: async () => {}, onDelete: async () => {}, replyRunning: running, onStopReply: onStop };
  useSetChatHeaderData(data);
  return null;
}

const now = new Date().toISOString();

describe("RunningNowButton", () => {
  test("a running reply shows in the panel and Stop stops generation", async () => {
    const { restore } = stubJobs([]);
    const stop = mock(() => {});
    try {
      const view = renderWithQueryClient(
        <MemoryRouter>
          <ChatHeaderDataProvider>
            <ChatReply onStop={stop} />
            <RunningNowButton person={owner} />
          </ChatHeaderDataProvider>
        </MemoryRouter>,
      );
      const trigger = await view.findByRole("button", { name: "Running now, 1 item" });
      fireEvent.click(trigger);
      fireEvent.click(await view.findByRole("button", { name: "Stop Writing a reply" }));
      expect(stop).toHaveBeenCalledTimes(1);
    } finally { restore(); }
  });

  test("a reply that starts after the page opened reaches the button, and leaves it when done", async () => {
    const { restore } = stubJobs([]);
    try {
      function Toggle() {
        const [running, setRunning] = useState(false);
        return <><button type="button" onClick={() => setRunning((r) => !r)}>toggle reply</button><ChatReply onStop={() => {}} running={running} /></>;
      }
      const view = renderWithQueryClient(<MemoryRouter><ChatHeaderDataProvider><Toggle /><RunningNowButton person={owner} /></ChatHeaderDataProvider></MemoryRouter>);
      await waitFor(() => expect(view.queryByRole("button", { name: /^Running now/ })).toBeNull());
      fireEvent.click(view.getByRole("button", { name: "toggle reply" }));
      await view.findByRole("button", { name: "Running now, 1 item" });
      fireEvent.click(view.getByRole("button", { name: "toggle reply" }));
      await waitFor(() => expect(view.queryByRole("button", { name: /^Running now/ })).toBeNull());
    } finally { restore(); }
  });

  test("Stop on a job posts to its stop route; Approve posts the decision", async () => {
    const { calls, restore } = stubJobs([
      { id: "pic-1", kind: "image", state: "running", startedBy: "sage", forPerson: "sage", title: "Making a picture of a red fox", createdAt: now, updatedAt: now, actions: ["stop"] },
      { id: "approval-1", kind: "approval", state: "waiting_for_you", startedBy: "nova", forPerson: "nova", title: 'Nova asked to install "Chess"', createdAt: now, updatedAt: now, actions: ["approve", "deny"] },
    ]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><ChatHeaderDataProvider><RunningNowButton person={owner} /></ChatHeaderDataProvider></MemoryRouter>);
      fireEvent.click(await view.findByRole("button", { name: "Running now, 2 items" }));
      fireEvent.click(await view.findByRole("button", { name: "Stop Making a picture of a red fox" }));
      fireEvent.click(await view.findByRole("button", { name: 'Approve Nova asked to install "Chess"' }));
      await waitFor(() => {
        expect(calls).toContain("POST /api/jobs/pic-1/stop");
        expect(calls).toContain("POST /api/approvals/approval-1/approve");
      });
    } finally { restore(); }
  });

  test("a child sees a parent-started job with no Stop", async () => {
    const { restore } = stubJobs([
      { id: "for-nova", kind: "image", state: "running", startedBy: "sage", forPerson: "nova", title: "Drawing a dinosaur", createdAt: now, updatedAt: now, actions: [] },
    ]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><ChatHeaderDataProvider><RunningNowButton person={child} /></ChatHeaderDataProvider></MemoryRouter>);
      fireEvent.click(await view.findByRole("button", { name: "Running now, 1 item" }));
      expect(await view.findByText("Drawing a dinosaur")).toBeTruthy();
      expect(view.getByText("Working on it")).toBeTruthy();
      expect(view.queryByRole("button", { name: /^Stop/ })).toBeNull();
    } finally { restore(); }
  });

  test("Open goes to the chat and releases the TV navigation pause the panel took", async () => {
    const { restore } = stubJobs([
      { id: "ask:conv-9", kind: "chat_ask", state: "waiting_for_you", startedBy: "sage", forPerson: "sage", title: "Locking up", conversationId: "conv-9", createdAt: now, updatedAt: now, actions: ["open"] },
    ]);
    try {
      tvNavCalls.length = 0;
      const view = renderWithQueryClient(<MemoryRouter><ChatHeaderDataProvider><RunningNowButton person={owner} /></ChatHeaderDataProvider></MemoryRouter>);
      fireEvent.click(await view.findByRole("button", { name: "Running now, 1 item" }));
      expect(tvNavPaused()).toBe(true);
      fireEvent.click(await view.findByRole("button", { name: "Open Locking up" }));
      await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
      expect(tvNavPaused()).toBe(false);
    } finally { restore(); }
  });

  test("with nothing relevant the button stays out of the header", async () => {
    const { calls, restore } = stubJobs([]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><ChatHeaderDataProvider><RunningNowButton person={owner} /></ChatHeaderDataProvider></MemoryRouter>);
      await waitFor(() => expect(calls).toContain("GET /api/jobs"));
      expect(view.queryByRole("button", { name: /^Running now/ })).toBeNull();
    } finally { restore(); }
  });

  test("a reply that finishes while the panel is open leaves it open, reading plainly", async () => {
    const { restore } = stubJobs([]);
    try {
      function Toggle() {
        const [running, setRunning] = useState(true);
        return <><button type="button" onClick={() => setRunning(false)}>finish reply</button><ChatReply onStop={() => {}} running={running} /></>;
      }
      const view = renderWithQueryClient(<MemoryRouter><ChatHeaderDataProvider><Toggle /><RunningNowButton person={owner} /></ChatHeaderDataProvider></MemoryRouter>);
      fireEvent.click(await view.findByRole("button", { name: "Running now, 1 item" }));
      await view.findByText("Writing a reply");
      fireEvent.click(view.getByRole("button", { name: "finish reply" }));
      expect(await view.findByText("Nothing is running right now.")).toBeTruthy();
    } finally { restore(); }
  });
});
