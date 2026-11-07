import { i18n } from "@lingui/core";

/** ROBOT-PAIR-02: a body with no published vendor login; it describes the pairing gate, not a feature. */
export const NO_VENDOR_LOGIN = "no_vendor_login";

export const robotCapabilityLabels = (): Record<string, string> => ({
  head_pan_tilt: i18n._({ id: "Head turns and nods", message: "Head turns and nods" }),
  light_ring: i18n._({ id: "Light ring", message: "Light ring" }),
  battery_readout: i18n._({ id: "Battery level", message: "Battery level" }),
  camera: i18n._({ id: "Camera", message: "Camera" }),
  speaker: i18n._({ id: "Speaker", message: "Speaker" }),
  lease: i18n._({ id: "Motion control", message: "Motion control" }),
  estop: i18n._({ id: "Emergency stop", message: "Emergency stop" }),
  speech_pod: i18n._({ id: "Speaks through Home", message: "Speaks through Home" }),
});

export function robotCapabilityLabel(id: string): string {
  return robotCapabilityLabels()[id] ?? id;
}
