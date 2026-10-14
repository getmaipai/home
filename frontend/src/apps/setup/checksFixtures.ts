export type CheckFixtureState = "green" | "amber" | "red";
export type CheckFixture = { id: string; title: string; state: CheckFixtureState; text: string };
export const CHECK_ROW_IDS = ["engine", "memory", "system", "model-disk", "graphics-driver", "download-host", "download-destination", "hub-disk", "clock", "home-network", "engine-link", "camera"] as const;

const rows = (state: CheckFixtureState, exception?: string): CheckFixture[] => CHECK_ROW_IDS.map((id) => ({
  id, title: id, state: id === exception ? state : "green", text: id === exception ? (state === "amber" ? "This check needs attention but can continue." : "This check blocks setup.") : "This check passed.",
}));

export const CHECK_FIXTURES: Record<CheckFixtureState, CheckFixture[]> = {
  green: rows("green"),
  amber: rows("amber", "graphics-driver"),
  red: rows("red", "download-destination"),
};
