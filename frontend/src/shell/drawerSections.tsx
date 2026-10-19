// The phone's menu drawer lists the selected app's own sections below the apps (RULES S1). FullLayout takes them as one
// `mobileSections` node; a page that has a section column hands the same entries here, and the shell passes them on.
import { createContext, useContext, useEffect, type ReactNode } from "react";

export const DrawerSectionsContext = createContext<(sections: ReactNode) => void>(() => {});

/** Shows `sections` in the menu drawer while the calling page is mounted. Pass a stable node (memoised), or the drawer redraws every render. */
export function useDrawerSections(sections: ReactNode): void {
  const set = useContext(DrawerSectionsContext);
  useEffect(() => {
    set(sections);
    return () => set(null);
  }, [sections, set]);
}
