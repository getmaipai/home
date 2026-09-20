import { useEffect, type Dispatch, type SetStateAction } from "react";
import { create } from "zustand";
import { api, type Roster } from "@/lib/api";

/** Chat's own Developer-disclosure gate (docs/SETTINGS.md's three
 * levels): owner, admin, and adult can hold the `ui.show_turn_stats`
 * setting; a child or teen never can. */
export function canViewChatDetails(role: Roster["role"]): boolean {
  return role === "owner" || role === "admin" || role === "adult";
}

// Keyed by person id, shared across every `useChatDisclosure` call site -
// ChatTurnStats's own detail popover, ChatPage's "Details" toggle, and the
// header's own model picker (spec.md "The senses dock and the model
// picker": "shows the companion's current model only at the Developer
// disclosure level") all read and write the same `ui.show_turn_stats`
// value. A plain per-instance `useState` (the first pass) left ChatPage's
// own optimistic toggle invisible to ModelPicker's separate instance until
// something forced a remount - real state, not two independently drifting
// copies, same pattern chatMemoryState.ts already uses for turn memory.
const useDisclosureStore = create<{ byPersonId: Record<string, boolean | null>; set: (personId: string, value: boolean | null) => void }>((set) => ({
  byPersonId: {},
  set: (personId, value) => set((s) => ({ byPersonId: { ...s.byPersonId, [personId]: value } })),
}));

// Guards the fetch below, not the store: without it, the second of two
// call sites mounting for the same person (ModelPicker already showing a
// resolved value, then ChatPage mounts) would both reset-to-null and
// refetch, flickering the first instance's already-correct value away
// for a beat - found live by the review that required this whole shared-
// store rewrite. Module-scoped, not component state, since it tracks a
// request in flight across every mounted instance, not one component's
// own lifecycle.
const fetchInFlight = new Set<string>();

/** The person-scoped `ui.show_turn_stats` setting. `null` while loading,
 * not permission to show anything yet; `false` outright for a role that
 * can never hold the setting. The setter is exposed for the one caller
 * (ChatPage's own "Details" toggle) that needs an optimistic update
 * before the write settles; every other caller only reads it. */
export function useChatDisclosure(person: Roster): [boolean | null, Dispatch<SetStateAction<boolean | null>>] {
  const eligible = canViewChatDetails(person.role);
  const visible = useDisclosureStore((s) => s.byPersonId[person.id] ?? null);
  const setStoreValue = useDisclosureStore((s) => s.set);
  useEffect(() => {
    let active = true;
    if (!eligible) {
      setStoreValue(person.id, false);
      return () => {
        active = false;
      };
    }
    // A value already resolved (by another mounted instance, or an
    // earlier mount of this same one) stays on screen while any refresh
    // happens in the background - only a truly unresolved state (never
    // fetched, `undefined` in the store) resets to the loading `null`.
    const cached = useDisclosureStore.getState().byPersonId[person.id];
    if (cached === undefined) setStoreValue(person.id, null);
    if (fetchInFlight.has(person.id)) {
      return () => {
        active = false;
      };
    }
    fetchInFlight.add(person.id);
    api.settingsValues(`person:${person.id}`).then((values) => {
      if (!active) return;
      const setting = values.find((value) => value.key === "ui.show_turn_stats");
      setStoreValue(person.id, setting?.value === true);
    }).catch(() => {}).finally(() => {
      fetchInFlight.delete(person.id);
    });
    return () => {
      active = false;
    };
  }, [eligible, person.id, setStoreValue]);
  const setVisible: Dispatch<SetStateAction<boolean | null>> = (action) => {
    const current = useDisclosureStore.getState().byPersonId[person.id] ?? null;
    const next = typeof action === "function" ? (action as (prev: boolean | null) => boolean | null)(current) : action;
    setStoreValue(person.id, next);
  };
  return [eligible ? visible : false, setVisible];
}
