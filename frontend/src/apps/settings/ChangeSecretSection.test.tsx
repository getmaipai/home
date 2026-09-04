import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { ChangeSecretSection } from "@/apps/settings/ChangeSecretSection";
import type { Roster } from "@/lib/api";

afterEach(cleanup);

function makePerson(hasSecret: boolean): Roster {
  return {
    id: "person-abc123",
    display_name: "Jesse",
    nickname: null,
    role: "owner",
    avatar_seed: "person-abc123",
    source: "hub",
    local_only: false,
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null,
    hasSecret,
  };
}

// Stubs the global fetch api.changeSecret ultimately calls, rather than
// mock.module()-ing "@/lib/api": this file already has a static import of
// ChangeSecretSection, and Bun's module cache does not reliably re-bind a
// module-level mock after a consumer has already imported the real one.
// Stubbing fetch avoids that timing pitfall entirely and is what
// SettingField.test.tsx's own real-render-over-mocked-network approach
// already established.
function stubFetchOk(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })),
  ) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe("ChangeSecretSection", () => {
  // Real gap this section closed tonight, code-review-flagged for missing
  // coverage: onChanged is what lets App.tsx's person.hasSecret catch up
  // without a full page reload (docs/dev.md's PIN-change slice).
  test("calls onChanged exactly once after a successful first-time set", async () => {
    const restoreFetch = stubFetchOk();
    try {
      const onChanged = mock(() => {});
      const { getByPlaceholderText, getByRole } = render(
        <ChangeSecretSection person={makePerson(false)} onChanged={onChanged} />,
      );

      fireEvent.change(getByPlaceholderText("Choose a PIN or password"), {
        target: { value: "1234" },
      });
      fireEvent.change(getByPlaceholderText("Confirm"), { target: { value: "1234" } });

      await act(async () => {
        fireEvent.click(getByRole("button", { name: "Set it" }));
      });

      expect(onChanged).toHaveBeenCalledTimes(1);
    } finally {
      restoreFetch();
    }
  });

  test("does not call onChanged, or touch the network, when the two new values don't match", async () => {
    const onChanged = mock(() => {});
    const { getByPlaceholderText, getByRole, getByText } = render(
      <ChangeSecretSection person={makePerson(false)} onChanged={onChanged} />,
    );

    fireEvent.change(getByPlaceholderText("Choose a PIN or password"), { target: { value: "1234" } });
    fireEvent.change(getByPlaceholderText("Confirm"), { target: { value: "5678" } });

    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Set it" }));
    });

    expect(onChanged).not.toHaveBeenCalled();
    expect(getByText("Those two don't match.")).toBeTruthy();
  });
});
