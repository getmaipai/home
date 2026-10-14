import { classDir } from "@/lib/paths";
import { checkPlacement } from "@/lib/placement";
export type PlacementDiskCheckResult = { status: "green" | "amber" | "red"; message?: string; fix?: string };

async function result(classId: "models" | "records", path: string, opts: { models?: readonly string[] } = {}): Promise<PlacementDiskCheckResult> {
  const rows = await checkPlacement({ [classId]: path }, { models: opts.models });
  const space = rows.find((row) => row.class === classId && row.id === `space:${classId}`);
  if (!space) return { status: "green" };
  if (space.kind === "unknown") return { status: "amber", message: space.text, fix: space.fix };
  return { status: "red", message: space.text, fix: space.fix };
}

/** Setup Checks row 4: free space is sourced from the placement check. */
export function checkModelDisk(path = classDir("models"), models?: readonly string[]): Promise<PlacementDiskCheckResult> {
  return result("models", path, { models });
}

/** Setup Checks row 7: the hub's records volume is checked by the same placement rules. */
export function checkHubDisk(path = classDir("records")): Promise<PlacementDiskCheckResult> {
  return result("records", path);
}
