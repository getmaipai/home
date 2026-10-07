import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import { cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ChatMessageQueue } from "@/apps/chat/chatThreadSlots";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import type { HomeJobView, Roster } from "@/lib/api";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

const NOOP: ChatModelAdapter = { run: async function* () {} };
let rows: HomeJobView[] = [];
const realFetch = globalThis.fetch;

function Harness({ personRole }: { personRole: "child" | "teen" | "owner" }) {
  const runtime = useLocalRuntime(NOOP);
  const person = { id: personRole === "child" ? "nova" : personRole === "teen" ? "ember" : "sage", role: personRole } as Roster;
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <MemoryRouter>
        <WakeWordPersonContext.Provider value={person}>
          <ChatMessageQueue />
        </WakeWordPersonContext.Provider>
      </MemoryRouter>
    </AssistantRuntimeProvider>
  );
}

beforeEach(() => {
  rows = [];
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const path = String(input);
    return Promise.resolve(Response.json(path.endsWith("/api/jobs") ? rows : []));
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

describe("ChatMessageQueue activity Elements", () => {
  test("the child sees Asked a parent without approval actions", async () => {
    rows = [{
      id: "approval-child",
      kind: "approval",
      state: "waiting_for_you",
      startedBy: "nova",
      forPerson: "nova",
      title: 'Asked to install "Chess"',
      actions: [],
    }];
    const view = renderWithQueryClient(<Harness personRole="child" />);

    await waitFor(() => expect(view.container.textContent).toContain("Asked a parent"));
    expect(view.container.querySelector('[data-slot="task-card"]')?.getAttribute("data-state")).toBe("waiting");
    expect(view.container.querySelector('[data-slot="task-card-actions"]')).toBeNull();
    expect(view.queryByRole("button", { name: /Approve|Deny/ })).toBeNull();
  });

  test("the teen sees their own ask without gaining parent actions", async () => {
    rows = [{
      id: "approval-teen",
      kind: "approval",
      state: "waiting_for_you",
      startedBy: "ember",
      forPerson: "ember",
      title: 'Asked to install "Chess"',
      actions: [],
    }];
    const view = renderWithQueryClient(<Harness personRole="teen" />);

    await waitFor(() => expect(view.container.textContent).toContain('Asked to install "Chess"'));
    expect(view.container.querySelector('[data-slot="task-card"]')?.getAttribute("data-state")).toBe("waiting");
    expect(view.container.querySelector('[data-slot="task-card-actions"]')).toBeNull();
    expect(view.queryByRole("button", { name: /Approve|Deny/ })).toBeNull();
  });

  test("the adult sees the allowed approval actions through TaskCard", async () => {
    rows = [{
      id: "approval-child",
      kind: "approval",
      state: "waiting_for_you",
      startedBy: "nova",
      forPerson: "nova",
      title: 'Nova asked to install "Chess"',
      actions: ["approve", "deny"],
    }];
    const view = renderWithQueryClient(<Harness personRole="owner" />);

    await waitFor(() => expect(view.getByRole("button", { name: /Approve/ })).toBeTruthy());
    expect(view.getByRole("button", { name: /Deny/ })).toBeTruthy();
    expect(view.container.querySelector('[data-slot="task-card"]')?.getAttribute("data-state")).toBe("waiting");
  });

  test("comfortable calm TaskCard and BackgroundInbox show active jobs without duplicating the selected row", async () => {
    rows = [
      { id: "job-1", kind: "image", state: "running", startedBy: "sage", forPerson: "sage", title: "Making a picture", createdAt: "2026-10-07T10:00:00.000Z", actions: ["stop"] },
      { id: "job-2", kind: "video", state: "running", startedBy: "sage", forPerson: "sage", title: "Making a short video", createdAt: "2026-10-07T10:01:00.000Z", actions: ["stop"] },
    ];
    const view = renderWithQueryClient(<Harness personRole="owner" />);

    await waitFor(() => expect(view.container.querySelector('[data-slot="background-inbox"]')).not.toBeNull());
    const taskCard = view.container.querySelector('[data-slot="task-card"]');
    const inbox = view.container.querySelector('[data-slot="background-inbox"]');
    expect(taskCard?.getAttribute("data-state")).toBe("working");
    expect(taskCard?.textContent).toContain("Making a picture");
    expect(inbox?.textContent).toContain("Making a short video");
    expect(inbox?.textContent).not.toContain("Making a picture");
    expect(taskCard?.querySelector(".animate-spin")).toBeNull();
    expect(inbox?.querySelector(".animate-spin")).toBeNull();
    expect(view.getByRole("button", { name: /Stop Making a picture/ }).classList.contains("text-base")).toBe(true);
  });
});
