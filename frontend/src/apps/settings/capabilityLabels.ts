export const ROBOT_CAPABILITY_LABELS: Record<string, string> = {
  head_pan_tilt: "Head turns and nods",
  light_ring: "Light ring",
  battery_readout: "Battery level",
  camera: "Camera",
  speaker: "Speaker",
  lease: "Motion control",
  estop: "Emergency stop",
  speech_pod: "Speaks through Home",
};

export function robotCapabilityLabel(id: string): string {
  return ROBOT_CAPABILITY_LABELS[id] ?? id;
}
