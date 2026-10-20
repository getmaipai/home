/** ROBOT-PAIR-02: a body with no published vendor login; it describes the pairing gate, not a feature. */
export const NO_VENDOR_LOGIN = "no_vendor_login";

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
