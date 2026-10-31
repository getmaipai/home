import type { Hardware } from "./profileTable";
import { hardwareFromBudget } from "./profileSource";
import { getStackClient } from "../stackEngine";

let cached: Hardware | null = null;

export async function refreshStackHardware(): Promise<void> {
  try {
    cached = hardwareFromBudget(await getStackClient().budget());
  } catch {
    // Keep the last complete table while Stack is unavailable.
  }
}

export function currentHardware(): Hardware | null { return cached; }

export function startStackHardwareRefresh(): () => void {
  void refreshStackHardware();
  const timer = setInterval(() => void refreshStackHardware(), 60_000);
  timer.unref();
  return () => clearInterval(timer);
}

export function __setHardwareForTests(hw: Hardware | null): void { cached = hw; }
