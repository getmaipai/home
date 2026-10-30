/** The shell header reads the selected Clock tab; this stays outside the page body so the title is drawn once. */
export const CLOCK_TAB_EVENT = "maipai:clock-tab";
export type ClockTab = "alarms" | "timers";

export function setClockHeaderTab(tab: ClockTab) {
  window.dispatchEvent(new CustomEvent<ClockTab>(CLOCK_TAB_EVENT, { detail: tab }));
}
