import { useEffect } from "react";
import { create } from "zustand";
import { api, type Roster } from "@/lib/api";

// `ui.reasoning_open` (person scope, backend/src/settings/uiKeys.ts): whether
// a finished reply's reasoning is shown expanded. Default collapsed. One
// store keyed by person so every reasoning group on the page agrees, and a
// toggle in one reply carries to the next.
const useStore = create<{ byPersonId: Record<string, boolean>; set: (personId: string, value: boolean) => void }>((set) => ({
  byPersonId: {},
  set: (personId, value) => set((s) => ({ byPersonId: { ...s.byPersonId, [personId]: value } })),
}));

const fetched = new Set<string>();

/** Test hook: forget what was fetched and chosen. */
export function resetReasoningOpenForTests() {
  fetched.clear();
  useStore.setState({ byPersonId: {} });
}

export function useReasoningOpen(person: Pick<Roster, "id"> | null): [boolean, (open: boolean) => void] {
  const id = person?.id ?? "";
  const open = useStore((s) => s.byPersonId[id] ?? false);
  const setStore = useStore((s) => s.set);
  useEffect(() => {
    if (!id || fetched.has(id)) return;
    fetched.add(id);
    api
      .settingsValues(`person:${id}`)
      .then((values) => {
        const found = values.find((v) => v.key === "ui.reasoning_open");
        if (found?.value === true) setStore(id, true);
      })
      .catch(() => {
        fetched.delete(id);
      });
  }, [id, setStore]);
  const setOpen = (next: boolean) => {
    setStore(id, next);
    if (id) api.setSetting(`person:${id}`, "ui.reasoning_open", next).catch(() => {});
  };
  return [open, setOpen];
}
