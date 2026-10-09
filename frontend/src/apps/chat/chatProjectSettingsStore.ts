import { useSyncExternalStore } from "react";

// PROJECTS-UI-02: which project's settings dialog is open. The column (twice:
// desktop and the phone sheet), the listing and the project page all open the
// one dialog the chat page hosts, so the target lives here, not in any of them.
export type ProjectSettingsTarget = { kind: "edit"; id: string } | { kind: "share"; id: string } | { kind: "new" } | null;

let target: ProjectSettingsTarget = null;
const listeners = new Set<() => void>();

const publish = (next: ProjectSettingsTarget) => {
  target = next;
  for (const listener of listeners) listener();
};

export const openProjectSettings = (next: Exclude<ProjectSettingsTarget, null>) => publish(next);
export const closeProjectSettings = () => publish(null);

export const useProjectSettingsTarget = (): ProjectSettingsTarget =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => target,
    () => null,
  );
