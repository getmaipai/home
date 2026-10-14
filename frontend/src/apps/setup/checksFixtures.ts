export type CheckFixtureState = "green" | "amber" | "red";
export type CheckFixture = { id: string; title: string; state: CheckFixtureState; text: string };
export const CHECK_ROW_IDS = ["engine", "memory", "system", "model-disk", "graphics-driver", "download-host", "download-destination", "hub-disk", "clock", "home-network", "engine-link", "camera"] as const;

export const CHECK_FIXTURES: Record<CheckFixtureState, CheckFixture[]> = {
  green: CHECK_ROW_IDS.map((id) => ({ id, title: id, state: "green", text: "This check passed." })),
  amber: CHECK_ROW_IDS.map((id) => ({ id, title: id, state: "amber", text: "This check needs attention but can continue." })),
  red: CHECK_ROW_IDS.map((id) => ({ id, title: id, state: "red", text: "This check blocks setup." })),
};
