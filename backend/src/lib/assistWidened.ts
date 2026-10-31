// ASSIST-BENCH-01: the held-off switch for the wider `remind` and `timer` model-facing schemas.
// The wider description and `args` live beside each package as args.widened.json and are not part of manifest.json,
// so nothing the model sees changes until the household setting `tools.assist.widened` is true. The bench turns it
// on for its on arm; the setting stays off until the bench report passes for the chat model in use (design note
// docs/plans/assistant-tools-lists-reminders-alarms-2026-10-30.md section 5).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { getHouseholdSettingValue } from "@/lib/settings";
import { resolvePackageDir } from "@/lib/packageResolve";

export const WIDENED_SETTING_KEY = "tools.assist.widened";
export const WIDENED_PACKAGE_IDS = ["remind", "timer"] as const;

interface WidenedFile {
  description: string;
  args: Record<string, unknown>;
}

/** Reads a package's args.widened.json, or null when it has none or it is unreadable. */
export function readWidenedFile(id: string): WidenedFile | null {
  const path = join(resolvePackageDir(id), "args.widened.json");
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<WidenedFile>;
    if (typeof parsed.description !== "string" || typeof parsed.args !== "object" || parsed.args === null) return null;
    return { description: parsed.description, args: parsed.args };
  } catch {
    return null;
  }
}

/** Whether the household has switched the wider schemas on. Any read failure means off. */
export function widenedAssistOn(): boolean {
  try {
    return getHouseholdSettingValue(WIDENED_SETTING_KEY) === true;
  } catch {
    return false;
  }
}

/** The manifest the model and the argument check see: unchanged (the same object) unless the setting is on and
 * this is `remind` or `timer`, in which case the description and `args` come from args.widened.json. */
export function applyWidenedAssist(manifest: PackageManifest): PackageManifest {
  if (!(WIDENED_PACKAGE_IDS as readonly string[]).includes(manifest.id)) return manifest;
  if (!widenedAssistOn()) return manifest;
  const widened = readWidenedFile(manifest.id);
  if (!widened) return manifest;
  return { ...manifest, description: widened.description, args: widened.args } as PackageManifest;
}
