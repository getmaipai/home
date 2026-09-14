import { useMemo, useState } from "react";

interface UseSelectMode {
  active: boolean;
  enter: () => void;
  exit: () => void;
  selected: Set<string>;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  selectAll: () => void;
  clear: () => void;
  count: number;
}

/** Four pages (NotificationsPage, UsersSection, MemoryPage, PeopleAndThings)
 * each hand-rolled their own select-mode state; a fix that prunes the
 * selected set against the list currently on screen had only reached
 * NotificationsPage. One definition instead, per the platform's own
 * "one definition, one place" rule. */
export function useSelectMode(ids: readonly string[]): UseSelectMode {
  const [active, setActive] = useState(false);
  const [rawSelected, setRawSelected] = useState<Set<string>>(new Set());

  const selected = useMemo(() => {
    const idSet = new Set(ids);
    const pruned = new Set<string>();
    for (const id of rawSelected) {
      if (idSet.has(id)) pruned.add(id);
    }
    return pruned;
  }, [rawSelected, ids]);

  function enter() {
    setActive(true);
  }

  function exit() {
    setActive(false);
    setRawSelected(new Set());
  }

  function isSelected(id: string) {
    return selected.has(id);
  }

  function toggle(id: string) {
    setRawSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setRawSelected(new Set(ids));
  }

  function clear() {
    setRawSelected(new Set());
  }

  return { active, enter, exit, selected, isSelected, toggle, selectAll, clear, count: selected.size };
}
