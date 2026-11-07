import type { NavigateFunction } from "react-router-dom";

/** Keep in-app back navigation inside the router's current document. */
export function navigateBack(navigate: NavigateFunction, appHome: string): void {
  const state = window.history.state as { idx?: number } | null;
  if ((state?.idx ?? 0) > 0) navigate(-1);
  else navigate(appHome);
}
