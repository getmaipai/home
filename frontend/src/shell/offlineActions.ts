import { keepOnDevice, type OfflineRecordRef, type OfflineResult } from "@/lib/offlineMedia";

/** Apps pass this action to their kit action control and show a failed result in that form's Alert.
 * The shell owns the label and handler; every app uses the same person bucket and manifest protocol. */
export function keepOnThisDeviceAction(record: OfflineRecordRef): { label: string; run: () => Promise<OfflineResult> } {
  return { label: "Keep on this device", run: () => keepOnDevice(record) };
}
