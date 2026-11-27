// STACK-LORAS-01 slice 6: runs lib/loras/legacyDrop.ts at hub start. The Stack may start after Home, so a refusal is tried again a few times; after that the
// old tables stay until the next start. The outcome is one log line (ids and counts only, never a style's name or a person).
import { join } from "node:path";
import { sqlite } from "@/db";
import { dataDir } from "@/lib/paths";
import { nextHlc } from "@/lib/hlc";
import { callStack } from "@/lib/loras/stackLibrary";
import { dropLegacyLoraTables, type LegacyDropResult } from "@/lib/loras/legacyDrop";

type StackList = { loras?: Array<{ id?: unknown }> };

/** Every id the Stack lists, live and in its trash. Throws when the Stack cannot be read. */
export async function stackLoraIds(): Promise<string[]> {
  const [live, trash] = await Promise.all([callStack("GET", "/stack/v1/loras"), callStack("GET", "/stack/v1/loras?removed=true")]);
  return [live.body, trash.body].flatMap((body) => ((body as StackList).loras ?? []).map((l) => l.id).filter((id): id is string => typeof id === "string"));
}

export function runLegacyLoraDrop(): Promise<LegacyDropResult> {
  return dropLegacyLoraTables({ sqlite, listStackIds: stackLoraIds, archiveDir: join(dataDir, "legacy-archive"), hlc: nextHlc });
}

function report(result: LegacyDropResult): void {
  if (result.state === "dropped") console.log(`[loras] old Home LoRA tables archived and dropped: ${JSON.stringify(result.rows)}, people copied ${result.peopleCopied}, archive ${result.file ?? "none (tables were empty)"}`);
  else if (result.state === "refused") console.warn(`[loras] old Home LoRA tables kept (${result.reason}): ${result.detail}${result.missing ? ` Missing ids: ${result.missing.slice(0, 20).join(", ")}` : ""}`);
}

/** Starts the check in the background: now, then after 30 seconds and 2 minutes if the Stack was not ready. Never throws. */
export function startLegacyLoraDrop(delaysMs: readonly number[] = [0, 30_000, 120_000]): void {
  const attempt = (i: number): void => {
    const timer = setTimeout(() => {
      runLegacyLoraDrop().then((result) => {
        // Only an unreachable Stack is worth another try; a missing id or a failed archive will not change in two minutes.
        if (result.state === "refused" && result.reason === "stack_unreachable" && i + 1 < delaysMs.length) { attempt(i + 1); return; }
        report(result);
      }).catch((error: unknown) => console.warn(`[loras] legacy table check failed: ${(error as Error).message}`));
    }, delaysMs[i] ?? 0);
    timer.unref();
  };
  attempt(0);
}
