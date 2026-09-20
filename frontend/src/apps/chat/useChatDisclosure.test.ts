import { afterEach, expect, test } from "bun:test";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { api, type Roster } from "@/lib/api";
import { useChatDisclosure } from "@/apps/chat/useChatDisclosure";

const read = api.settingsValues;
afterEach(() => {
  cleanup();
  api.settingsValues = read;
});

function makePerson(): Roster {
  return {
    id: "person-disclosure123",
    display_name: "Riff",
    nickname: null,
    role: "owner",
    avatar_seed: "person-disclosure123",
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

// getmaipai/home step 5b review: ChatPage's "Details" toggle and the
// header's ModelPicker both call this hook for the same person - a first
// pass used a plain per-instance useState, so ChatPage's own optimistic
// toggle never reached ModelPicker's separate copy. Fixed onto a shared
// zustand store, but the first version of that fix unconditionally reset
// the shared value to `null` on every mount - a second instance mounting
// after the first had already resolved would flicker the shared value
// away and back. This is the regression test for that flicker, not just
// the sync fix above it.
test("a second instance for an already-resolved person never flickers back to null", async () => {
  const person = makePerson();
  api.settingsValues = async () => [{ key: "ui.show_turn_stats", value: true }] as Awaited<ReturnType<typeof api.settingsValues>>;
  const first = renderHook(() => useChatDisclosure(person));
  await waitFor(() => expect(first.result.current[0]).toBe(true));

  const second = renderHook(() => useChatDisclosure(person));
  // The shared store already holds a resolved value for this person id -
  // the very first render of a second instance must read it synchronously,
  // never the transient `null` "still loading" state a fresh per-instance
  // reset would have produced.
  expect(second.result.current[0]).toBe(true);
});
