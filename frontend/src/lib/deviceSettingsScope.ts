const DEVICE_SETTINGS_ID_KEY = "maipai.device-settings-id.v1";

/** Stable browser-profile identity for per-device settings. Wakeword capture
 * happens in this browser's microphone, so it must not use the hub host's
 * install id or a person/household scope. */
export function getDeviceSettingsScope(): string {
  let id = localStorage.getItem(DEVICE_SETTINGS_ID_KEY);
  if (!id || !/^[a-z0-9-]{16,64}$/.test(id)) {
    id = crypto.randomUUID().toLowerCase();
    localStorage.setItem(DEVICE_SETTINGS_ID_KEY, id);
  }
  return `device:${id}`;
}
