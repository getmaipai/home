import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { useRef } from "react";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import { ChatThread } from "@/apps/chat/ChatThread";
import { clearSubmittedFeedback, createChatFeedbackAdapter, useFeedbackFormStore } from "@/apps/chat/chatActionBar";
import { ChatAgeBandContext } from "@/apps/chat/chatThreadContexts";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";

// ELEMENTS-ADOPT-02: the kit's feedback-dialog after a thumbs-down, wired to
// the additive reasons and note on the feedback route.
const NOOP: ChatModelAdapter = { run: async function* () { /* seeded */ } };
const MESSAGES: ThreadMessageLike[] = [
  { role: "user", content: [{ type: "text", text: "When does the library open?" }] },
  {
    role: "assistant",
    content: [{ type: "text", text: "It opens at nine." }],
    status: { type: "complete", reason: "stop" },
    metadata: { custom: { turnId: "turn-feedbackui1" } },
  },
];

function Harness({ band }: { band: "child" | "teen" | "adult" }) {
  const ref = useRef<ReturnType<typeof useLocalRuntime>>(undefined);
  const runtime = useLocalRuntime(NOOP, {
    initialMessages: MESSAGES,
    adapters: {
      feedback: createChatFeedbackAdapter({
        clearRating: (id) => {
          if (ref.current) clearSubmittedFeedback(ref.current.thread, id);
        },
      }),
    },
  });
  ref.current = runtime;
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatAgeBandContext.Provider value={band}>
        <ChatThread />
      </ChatAgeBandContext.Provider>
    </AssistantRuntimeProvider>
  );
}

const realFetch = globalThis.fetch;
let posted: Array<{ url: string; body: Record<string, unknown> }> = [];
let deleted: string[] = [];
beforeEach(() => {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  posted = [];
  deleted = [];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "DELETE") deleted.push(url);
    if (init?.method === "POST") posted.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return Promise.resolve(Response.json({}));
  }) as unknown as typeof fetch;
  useFeedbackFormStore.setState({ open: {} });
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

function feedbackPosts() {
  return posted.filter((entry) => entry.url.includes("/api/conversations/turns/turn-feedbackui1/feedback"));
}

describe("ReplyFeedbackDialog", () => {
  for (const band of ["adult", "teen"] as const) {
    test(`${band}: a thumbs-down opens "What went wrong?", and Send posts the picked reasons and the note`, async () => {
      const view = renderWithQueryClient(<MemoryRouter><Harness band={band} /></MemoryRouter>);
      expect(view.container.querySelector('[data-slot="feedback-dialog"]')).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Not helpful" }));
      await waitFor(() => expect(view.container.querySelector('[data-slot="feedback-dialog"]')).not.toBeNull());
      expect(view.getByText("What went wrong?")).toBeTruthy();
      await waitFor(() => expect(feedbackPosts()).toHaveLength(1));
      expect(feedbackPosts()[0]!.body).toEqual({ verdict: "down", reason: null });

      fireEvent.click(view.getByRole("button", { name: "Wrong" }));
      fireEvent.click(view.getByRole("button", { name: "Too long" }));
      fireEvent.change(view.getByLabelText("Anything else?"), { target: { value: " The hours were for another branch. " } });
      fireEvent.click(view.getByRole("button", { name: "Send feedback" }));
      await waitFor(() => expect(feedbackPosts()).toHaveLength(2));
      expect(feedbackPosts()[1]!.body).toEqual({ verdict: "down", reason: "wrong", reasons: ["wrong", "too_long"], note: "The hours were for another branch." });
      await waitFor(() => expect(view.getByText("Thanks. That helps us tune the model.")).toBeTruthy());
    });
  }

  test("child: a thumbs-down stays one tap; no reasons form is drawn and nothing but the verdict is sent", async () => {
    const view = renderWithQueryClient(<MemoryRouter><Harness band="child" /></MemoryRouter>);
    fireEvent.click(view.getByRole("button", { name: "Not helpful" }));
    await waitFor(() => expect(feedbackPosts()).toHaveLength(1));
    expect(feedbackPosts()[0]!.body).toEqual({ verdict: "down", reason: null });
    expect(view.container.querySelector('[data-slot="feedback-dialog"]')).toBeNull();
    expect(view.queryByText("What went wrong?")).toBeNull();
  });

  test("a thumbs-up closes an open form", async () => {
    const view = renderWithQueryClient(<MemoryRouter><Harness band="adult" /></MemoryRouter>);
    fireEvent.click(view.getByRole("button", { name: "Not helpful" }));
    await waitFor(() => expect(view.container.querySelector('[data-slot="feedback-dialog"]')).not.toBeNull());
    fireEvent.click(view.getByRole("button", { name: "Helpful" }));
    await waitFor(() => expect(view.container.querySelector('[data-slot="feedback-dialog"]')).toBeNull());
  });

  test("after sending, a second thumbs-down opens an empty form again, not the old thanks", async () => {
    const view = renderWithQueryClient(<MemoryRouter><Harness band="adult" /></MemoryRouter>);
    fireEvent.click(view.getByRole("button", { name: "Not helpful" }));
    await waitFor(() => expect(view.container.querySelector('[data-slot="feedback-dialog"]')).not.toBeNull());
    fireEvent.click(view.getByRole("button", { name: "Wrong" }));
    fireEvent.click(view.getByRole("button", { name: "Send feedback" }));
    await waitFor(() => expect(view.getByText("Thanks. That helps us tune the model.")).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Helpful" }));
    await waitFor(() => expect(view.container.querySelector('[data-slot="feedback-dialog"]')).toBeNull());
    fireEvent.click(view.getByRole("button", { name: "Not helpful" }));
    await waitFor(() => expect(view.getByRole("button", { name: "Send feedback" })).toBeTruthy());
    expect(view.getByRole("button", { name: "Wrong" }).getAttribute("aria-pressed")).toBe("false");
  });

  test("a reloaded thread never reopens the form for an earlier rating", () => {
    const view = renderWithQueryClient(<MemoryRouter><Harness band="adult" /></MemoryRouter>);
    expect(view.container.querySelector('[data-slot="feedback-dialog"]')).toBeNull();
  });

  // FEEDBACK-CANCEL-01
  for (const band of ["adult", "teen"] as const) {
    test(`${band}: Cancel closes the form without sending, and the thumbs-down stays lit`, async () => {
      const view = renderWithQueryClient(<MemoryRouter><Harness band={band} /></MemoryRouter>);
      fireEvent.click(view.getByRole("button", { name: "Not helpful" }));
      await waitFor(() => expect(view.getByRole("button", { name: "Cancel" })).toBeTruthy());
      fireEvent.click(view.getByRole("button", { name: "Wrong" }));
      fireEvent.click(view.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(view.container.querySelector('[data-slot="feedback-dialog"]')).toBeNull());
      expect(feedbackPosts()).toHaveLength(1);
      expect(deleted).toHaveLength(0);
      expect(view.getByRole("button", { name: "Not helpful" }).getAttribute("data-submitted")).toBe("true");
    });
  }

  test("Escape closes the form without sending", async () => {
    const view = renderWithQueryClient(<MemoryRouter><Harness band="adult" /></MemoryRouter>);
    fireEvent.click(view.getByRole("button", { name: "Not helpful" }));
    await waitFor(() => expect(view.getByLabelText("Anything else?")).toBeTruthy());
    fireEvent.keyDown(view.getByLabelText("Anything else?"), { key: "Escape" });
    await waitFor(() => expect(view.container.querySelector('[data-slot="feedback-dialog"]')).toBeNull());
    expect(feedbackPosts()).toHaveLength(1);
  });

  test("a press outside the form closes it without sending", async () => {
    const view = renderWithQueryClient(<MemoryRouter><Harness band="adult" /></MemoryRouter>);
    fireEvent.click(view.getByRole("button", { name: "Not helpful" }));
    await waitFor(() => expect(view.getByLabelText("Anything else?")).toBeTruthy());
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(view.container.querySelector('[data-slot="feedback-dialog"]')).toBeNull());
    expect(feedbackPosts()).toHaveLength(1);
  });

  for (const band of ["adult", "teen", "child"] as const) {
    for (const [thumb, verdict] of [["Not helpful", "down"], ["Helpful", "up"]] as const) {
      test(`${band}: tapping the lit "${thumb}" thumb again clears the rating once and un-lights it`, async () => {
        const view = renderWithQueryClient(<MemoryRouter><Harness band={band} /></MemoryRouter>);
        fireEvent.click(view.getByRole("button", { name: thumb }));
        await waitFor(() => expect(feedbackPosts()).toHaveLength(1));
        expect(feedbackPosts()[0]!.body).toEqual({ verdict, reason: null });
        await waitFor(() => expect(view.getByRole("button", { name: thumb }).getAttribute("data-submitted")).toBe("true"));
        fireEvent.click(view.getByRole("button", { name: thumb }));
        await waitFor(() => expect(deleted).toHaveLength(1));
        expect(deleted[0]).toContain("/api/conversations/turns/turn-feedbackui1/feedback");
        await waitFor(() => expect(view.getByRole("button", { name: thumb }).getAttribute("data-submitted")).not.toBe("true"));
        expect(view.container.querySelector('[data-slot="feedback-dialog"]')).toBeNull();
        expect(feedbackPosts()).toHaveLength(1);
        // Rating again after a clear stores it afresh.
        fireEvent.click(view.getByRole("button", { name: thumb }));
        await waitFor(() => expect(feedbackPosts()).toHaveLength(2));
        expect(deleted).toHaveLength(1);
      });
    }
  }

  test("child: the form never appears and Cancel does not exist", async () => {
    const view = renderWithQueryClient(<MemoryRouter><Harness band="child" /></MemoryRouter>);
    fireEvent.click(view.getByRole("button", { name: "Not helpful" }));
    await waitFor(() => expect(feedbackPosts()).toHaveLength(1));
    expect(view.queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});
