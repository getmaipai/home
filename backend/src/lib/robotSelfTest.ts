export const ROBOT_SELF_TEST_PARTS = {
  speaker: ["speaker"],
  face: ["eyes", "screen"],
  head: ["head_pan_tilt", "head_6dof"],
  lights: ["lights", "light_ring"],
  mic: ["mic"],
} as const;

export type RobotSelfTestPart = keyof typeof ROBOT_SELF_TEST_PARTS;

export function robotSelfTestPartsFor(device: { capabilities: string[] }): RobotSelfTestPart[] {
  return (Object.keys(ROBOT_SELF_TEST_PARTS) as RobotSelfTestPart[]).filter((part) =>
    ROBOT_SELF_TEST_PARTS[part].some((capability) => device.capabilities.includes(capability)));
}
