import { isStackConfigured } from "@/lib/stackEngine";
import { raiseIssue, resolveIssue } from "@/lib/issues";

export const STACK_REQUIREMENT_ISSUE = { source: "stack", key: "stack.not-configured" } as const;

/** Keep the missing-Stack boot decision small and independently testable. */
export async function syncStackRequirementIssue(configured = isStackConfigured()): Promise<void> {
  if (configured) {
    resolveIssue(STACK_REQUIREMENT_ISSUE.source, STACK_REQUIREMENT_ISSUE.key);
    return;
  }
  await raiseIssue({
    ...STACK_REQUIREMENT_ISSUE,
    severity: "error",
    title: "Home needs the MaiPai Stack",
    detail: "Home runs every model through the MaiPai Stack and none is set up on this computer. Install or start the Stack, then restart Home.",
  });
}
