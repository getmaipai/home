import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { DisplayNameSection } from "@/apps/settings/DisplayNameSection";
import type { Roster } from "@/lib/api";

afterEach(cleanup);

function makePerson(displayName: string): Roster {
  return {
    id: "person-abc123",
    display_name: displayName,
    nickname: null,
    role: "owner",
    avatar_seed: "person-abc123",
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
  };
}

// Stubs the global fetch api.updatePerson ultimately calls, rather than
// mock.module()-ing "@/lib/api": this file already has a static import of
// DisplayNameSection, and Bun's module cache does not reliably re-bind a
// module-level mock after a consumer has already imported the real one.
// Same approach as ChangeSecretSection.test.tsx.
function stubFetchOk(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })),
  ) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function stubFetchError(message: string): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify({ error: message }), { status: 400 })),
  ) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe("DisplayNameSection", () => {
  test("renders the current name and disables Save until the name changes", () => {
    const { getByRole, getByDisplayValue } = render(
      <DisplayNameSection person={makePerson("Jesse")} onChanged={() => {}} />,
    );

    expect(getByDisplayValue("Jesse")).toBeTruthy();
    expect(getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("saving calls api.updatePerson with the trimmed name, then onChanged", async () => {
    const restoreFetch = stubFetchOk();
    try {
      const onChanged = mock(() => {});
      const { getByDisplayValue, getByRole } = render(
        <DisplayNameSection person={makePerson("Jesse")} onChanged={onChanged} />,
      );

      fireEvent.change(getByDisplayValue("Jesse"), { target: { value: "  Jo  " } });
      expect(getByRole("button", { name: "Save" })).not.toBeDisabled();

      await act(async () => {
        fireEvent.click(getByRole("button", { name: "Save" }));
      });

      expect(onChanged).toHaveBeenCalledTimes(1);
    } finally {
      restoreFetch();
    }
  });

  test("shows the ApiError message under the field", async () => {
    const restoreFetch = stubFetchError("Server said no.");
    try {
      const { getByDisplayValue, getByRole, getByText } = render(
        <DisplayNameSection person={makePerson("Jesse")} onChanged={() => {}} />,
      );

      fireEvent.change(getByDisplayValue("Jesse"), { target: { value: "Jo" } });

      await act(async () => {
        fireEvent.click(getByRole("button", { name: "Save" }));
      });

      expect(getByText("Server said no.")).toBeTruthy();
    } finally {
      restoreFetch();
    }
  });
});
