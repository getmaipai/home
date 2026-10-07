import { afterEach, describe, expect, test, mock } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ProfileForm } from "@/apps/people/ProfileForm";
import type { Roster } from "@/lib/api";

afterEach(cleanup);

function makePerson(overrides: Partial<Roster> = {}): Roster {
  return {
    id: "person-abc123",
    display_name: "Avery",
    nickname: null,
    role: "adult",
    avatar_seed: "person-abc123",
    source: "hub",
    local_only: false,
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null,
    hasSecret: false,
    bio: "Likes books",
    accent: "blue",
    ...overrides,
  } as Roster;
}

describe("ProfileForm", () => {
  test("renders the person's current profile values", () => {
    const { getByLabelText, getByText, queryByLabelText } = render(<ProfileForm person={makePerson()} canEdit />);
    expect((getByLabelText("Name") as HTMLInputElement).value).toBe("Avery");
    expect((getByLabelText("Bio") as HTMLTextAreaElement).value).toBe("Likes books");
    expect(getByText("Blue")).toBeTruthy();
    expect(queryByLabelText("Use a real photo")).toBeNull();
  });

  test("saving a changed name sends only the changed field to this person's API route", async () => {
    const requests: Array<{ url: string; method: string | undefined; body: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) });
      return Promise.resolve(new Response(JSON.stringify({ ...makePerson(), display_name: "Avery Lane" }), { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      const { getByLabelText, getByRole } = render(<ProfileForm person={makePerson()} canEdit />);
      fireEvent.change(getByLabelText("Name"), { target: { value: "Avery Lane" } });
      fireEvent.click(getByRole("button", { name: "Save" }));
      await waitFor(() => expect(requests).toHaveLength(1));
      expect(requests[0]).toEqual({ url: "/api/people/person-abc123", method: "PATCH", body: { displayName: "Avery Lane" } });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("save writes the edited values and a refetch keeps them", async () => {
    const originalFetch = globalThis.fetch;
    let saved = makePerson();
    let patchBody: unknown;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "/api/people/person-abc123" || init?.method !== "PATCH") throw new Error("Unexpected request");
      patchBody = JSON.parse(String(init.body));
      saved = { ...saved, display_name: "Avery Lane", bio: "Loves art", accent: "teal" };
      return Promise.resolve(new Response(JSON.stringify(saved), { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      const view = render(<ProfileForm person={saved} canEdit layout="page" />);
      fireEvent.change(view.getByLabelText("Name"), { target: { value: "Avery Lane" } });
      fireEvent.change(view.getByLabelText("Bio"), { target: { value: "Loves art" } });
      await act(async () => { fireEvent.click(view.getByRole("combobox", { name: "Accent color" })); });
      const teal = await view.findByRole("option", { name: "Teal" });
      await act(async () => {
        fireEvent.pointerDown(teal, { pointerId: 1, pointerType: "mouse", button: 0 });
        fireEvent.pointerUp(teal, { pointerId: 1, pointerType: "mouse", button: 0 });
        fireEvent.click(teal);
      });
      await waitFor(() => expect(view.getByRole("combobox", { name: "Accent color" }).textContent).toContain("Teal"));
      fireEvent.click(view.getByRole("button", { name: "Save" }));

      await view.findByText("Saved.");
      expect(patchBody).toEqual({ displayName: "Avery Lane", bio: "Loves art", accent: "teal" });
      expect(view.queryByText("Unsaved changes.")).toBeNull();

      view.rerender(<ProfileForm person={{ ...saved }} canEdit layout="page" />);
      await waitFor(() => {
        expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("Avery Lane");
        expect((view.getByLabelText("Bio") as HTMLTextAreaElement).value).toBe("Loves art");
        expect(view.getByRole("combobox", { name: "Accent color" }).textContent).toContain("Teal");
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("dirty page forms ask before following a route link or leaving the page", () => {
    const originalConfirm = window.confirm;
    window.confirm = mock(() => false);
    try {
      const view = render(
        <>
          <ProfileForm person={makePerson()} canEdit layout="page" />
          <a href="/settings/account/privacy">Privacy</a>
        </>,
      );
      fireEvent.change(view.getByLabelText("Name"), { target: { value: "Avery Lane" } });
      expect(view.getByText("Unsaved changes.")).toBeTruthy();
      const routeClick = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
      view.getByText("Privacy").dispatchEvent(routeClick);
      expect(routeClick.defaultPrevented).toBe(true);
      expect(window.confirm).toHaveBeenCalledWith("Leave without saving?");
      const unload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(true);
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("a bio over 160 characters blocks saving and shows its limit message", () => {
    let requestCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => {
      requestCount += 1;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      const { getByLabelText, getByRole, getByText } = render(<ProfileForm person={makePerson()} canEdit />);
      const bio = getByLabelText("Bio");
      fireEvent.change(bio, { target: { value: "x".repeat(161) } });
      expect(getByText("Bio must be 160 characters or less.")).toBeTruthy();
      expect(getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
      fireEvent.click(getByRole("button", { name: "Save" }));
      expect(requestCount).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a server 403 shows its sentence and does not call onSaved", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ error: "You cannot edit this profile." }), { status: 403 }))) as unknown as typeof fetch;
    const onSaved = mock(() => {});
    try {
      const { getByLabelText, getByRole, findByText } = render(<ProfileForm person={makePerson()} canEdit onSaved={onSaved} />);
      fireEvent.change(getByLabelText("Name"), { target: { value: "Changed" } });
      fireEvent.click(getByRole("button", { name: "Save" }));
      await findByText("You cannot edit this profile.");
      expect(onSaved).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("canEdit false displays disabled values, the admin note, and no Save button", () => {
    const { getByLabelText, getAllByText, queryByRole } = render(<ProfileForm person={makePerson()} canEdit={false} />);
    expect((getByLabelText("Name") as HTMLInputElement).disabled).toBe(true);
    expect((getByLabelText("Bio") as HTMLTextAreaElement).disabled).toBe(true);
    expect(getAllByText("Ask an admin to change this.")).toHaveLength(3);
    expect(queryByRole("button", { name: "Save" })).toBeNull();
  });

  test("page layout has one Save button and only shows Cancel when onCancel is provided", () => {
    const person = makePerson();
    const withoutCancel = render(<ProfileForm person={person} canEdit layout="page" />);
    expect(withoutCancel.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(withoutCancel.queryByRole("button", { name: "Cancel" })).toBeNull();
    withoutCancel.unmount();

    const withCancel = render(<ProfileForm person={person} canEdit layout="page" onCancel={() => {}} />);
    expect(withCancel.getAllByRole("button", { name: "Save" })).toHaveLength(1);
    expect(withCancel.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });
});
