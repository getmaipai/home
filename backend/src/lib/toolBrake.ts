export type BrakeTool = "remind" | "timer" | "lists";
export type BrakeMode = "do" | "ask" | "never";
export interface ToolBrakeInput {
  tool: BrakeTool;
  action: string;
  args: Record<string, unknown>;
  itemCount?: number;
  actor: { id: string; role: string; band: "child" | "teen" | "adult" };
  listScope?: "household" | "person";
  tainted: boolean;
  mode: BrakeMode;
}
export interface ToolBrakeResult { decision: BrakeMode; reason?: "mode_never" | "mode_ask" | "confirmation_required" | "parent_required" | "unknown_speaker"; }

const ASK_ACTIONS = new Set(["delete_list", "clear_list", "delete"]);
const MINOR_ROLES = new Set(["child", "teen"]);

const CLEARS_OR_DELETES_LIST = new Set(["delete_list", "clear_list"]);
const BULK_THRESHOLD = 5;

/** Structured, deterministic gate for reminder, timer, and list writes. Decided from fields only, never wording. */
export function brakeFor(input: ToolBrakeInput): ToolBrakeResult {
  if (input.mode === "never") return { decision: "never", reason: "mode_never" };
  const unknownSpeaker = input.actor.role === "guest" || input.actor.role === "unknown" || !input.actor.id;
  if (unknownSpeaker) return { decision: "never", reason: "unknown_speaker" };

  const minor = MINOR_ROLES.has(input.actor.band) || MINOR_ROLES.has(input.actor.role);
  const householdList = input.tool === "lists" && input.listScope === "household";
  if (minor) {
    // A minor acts at once on their own records; a household delete or clear is a parent's to do.
    if (householdList && CLEARS_OR_DELETES_LIST.has(input.action)) return { decision: "never", reason: "parent_required" };
    return { decision: "do" };
  }

  if (input.mode === "ask") return { decision: "ask", reason: "mode_ask" };
  const bulk = (input.itemCount ?? 0) > BULK_THRESHOLD;
  const destructive = ASK_ACTIONS.has(input.action) || (householdList && CLEARS_OR_DELETES_LIST.has(input.action));
  if (input.tainted || bulk || destructive) return { decision: "ask", reason: "confirmation_required" };
  return { decision: "do" };
}
