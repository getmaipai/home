import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { IncognitoProvider } from "@/shell/incognitoContext";
import { writeIncognitoCache } from "@/shell/incognitoCache";
import { ProjectsPage } from "@/shell/pages/ProjectsPage";
import type { ChatFolderView, Roster } from "@/lib/api";

afterEach(() => {
  cleanup();
  sessionStorage.removeItem("maipai.incognito");
  localStorage.removeItem("maipai.incognito-explanation-seen");
});

function person(role: Roster["role"] = "owner"): Roster {
  return {
    id: "person-sage123",
    display_name: "Sage",
    nickname: null,
    role,
    avatar_seed: "person-sage123",
    source: "hub",
    local_only: false,
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null,
    enabled: true,
    guest_expires_at: null,
    memorialized_at: null,
    hlc: "1788000000000:0:test",
    hasSecret: true,
    age_band: role === "child" ? "child" : role === "teen" ? "teen" : "adult",
  };
}

function folder(id: string, name: string, access: ChatFolderView["access"] = "manage", patch: Partial<ChatFolderView> = {}): ChatFolderView {
  return {
    id,
    name,
    person: "person-sage123",
    access,
    icon: "leaf",
    color: "green",
    description: "",
    instructions: "",
    memory_mode: "project_only",
    pinned: false,
    pinned_at: null,
    archived_at: null,
    shares: [],
    sort_order: 0,
    source: "hub",
    provenance: "person-sage123 (self)",
    hlc: "1788000000000:0:test",
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    deleted_at: null,
    last_activity_at: "2026-10-01T00:00:00.000Z",
    counts: { chats: 2, files: 0, artifacts: 0 },
    ...patch,
  };
}

function renderPage(who: Roster, onFetch: (url: string, init?: RequestInit) => Response | Promise<Response>, route = "/chat/projects") {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return Promise.resolve(onFetch(url, init));
  }) as unknown as typeof fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <IncognitoProvider>
        <MemoryRouter initialEntries={[route]}>
          <Location />
          <Routes><Route path="/chat/projects" element={<ProjectsPage person={who} />} /><Route path="/chat" element={<h1>Chat</h1>} /></Routes>
        </MemoryRouter>
      </IncognitoProvider>
    </QueryClientProvider>,
  );
  return { ...view, restore: () => { globalThis.fetch = originalFetch; } };
}

function Location() {
  const { pathname } = useLocation();
  return <output data-testid="location">{pathname}</output>;
}

describe("ProjectsPage (PROJECTS-UI-03)", () => {
  test("renders ProjectMark rows and access-gated edit and pin actions", async () => {
    const own = folder("folder-own123", "Garden", "manage", { pinned: true, last_activity_at: "2026-10-06T00:00:00.000Z" });
    const edit = folder("folder-edit123", "Shared notes", "edit");
    const use = folder("folder-use123", "Family plan", "use");
    const view = renderPage(person(), (url) => url.includes("/api/chat-folders") ? Response.json([own, edit, use]) : Response.json({}));
    try {
      await view.findByText("Garden");
      expect(new URL("http://home" + (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls[0]![0]).searchParams.get("scope")).toBe("all");
      const row = (name: string) => view.getByText(name).closest('[data-slot="projects-list-row"]') as HTMLElement;
      expect(row("Garden").querySelector('[data-slot="project-mark"]')?.getAttribute("data-hue")).toBe("green");
      expect(within(row("Garden")).getByRole("button", { name: "Unpin Garden" })).toBeTruthy();
      expect(within(row("Garden")).getByRole("button", { name: "Edit Garden" })).toBeTruthy();
      expect(within(row("Shared notes")).queryByRole("button", { name: "Pin Shared notes" })).toBeNull();
      expect(within(row("Shared notes")).getByRole("button", { name: "Edit Shared notes" })).toBeTruthy();
      expect(within(row("Family plan")).queryByRole("button", { name: /Pin|Edit/ })).toBeNull();
    } finally {
      view.restore();
    }
  });

  test("Create opens the project settings Element and saves through POST", async () => {
    let created: ChatFolderView[] = [];
    const posts: unknown[] = [];
    const view = renderPage(person(), (url, init) => {
      if (url.includes("/api/chat-folders") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push(body);
        created = [folder("folder-recipes1", String(body.name), "manage")];
        return Response.json(created[0], { status: 201 });
      }
      if (url.includes("/api/chat-folders")) return Response.json(created);
      return Response.json({});
    });
    try {
      fireEvent.click(await view.findByRole("button", { name: "Create" }));
      expect(await view.findByText("Project settings")).toBeTruthy();
      fireEvent.change(view.getByRole("textbox", { name: "Project name" }), { target: { value: "Recipes" } });
      expect(view.queryByLabelText("Memory")).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(posts).toEqual([expect.objectContaining({ name: "Recipes" })]));
      expect(await view.findByText("Recipes")).toBeTruthy();
    } finally {
      view.restore();
    }
  });

  test("a child can see projects but cannot create, edit or pin them", async () => {
    const view = renderPage(person("child"), (url) => url.includes("/api/chat-folders") ? Response.json([folder("folder-homework", "Homework", "use")]) : Response.json({}));
    try {
      const row = (await view.findByText("Homework")).closest('[data-slot="projects-list-row"]') as HTMLElement;
      expect(view.queryByRole("button", { name: "Create" })).toBeNull();
      expect(within(row).queryByRole("button", { name: /Pin|Edit/ })).toBeNull();
    } finally {
      view.restore();
    }
  });

  test("Incognito returns to chat without requesting projects", async () => {
    localStorage.setItem("maipai.incognito-explanation-seen", "true");
    writeIncognitoCache(true);
    let listRequested = false;
    const view = renderPage(person(), (url) => {
      if (url.includes("/api/chat-folders")) listRequested = true;
      return Response.json([]);
    });
    try {
      await waitFor(() => expect(view.getByTestId("location").textContent).toBe("/chat"));
      expect(listRequested).toBe(false);
    } finally {
      view.restore();
    }
  });
});
