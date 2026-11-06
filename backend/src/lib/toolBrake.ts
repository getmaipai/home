export type BrakeTool = "remind" | "timer" | "lists" | "house";
export type BrakeMode = "do" | "ask" | "never";
export interface ToolBrakeInput {
  tool: BrakeTool;
  action: string;
  args: Record<string, unknown>;
  itemCount?: number;
  confirm?: boolean;
  targets?: number;
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

/** Structured, deterministic gate for tool writes. Decided from fields only, never wording. */
export function brakeFor(input: ToolBrakeInput): ToolBrakeResult {
  if (input.mode === "never") return { decision: "never", reason: "mode_never" };
  const unknownSpeaker = input.actor.role === "guest" || input.actor.role === "unknown" || !input.actor.id;
  if (unknownSpeaker) return { decision: "never", reason: "unknown_speaker" };

  // ASSIST-UNDO-03: undoing the speaker's own latest change is always allowed for a known speaker; it can only reverse
  // what that person did, so neither the household mode, a minor's band nor a tainted run needs a card.
  if (input.action === "undo") return { decision: "do" };

  if (input.tool === "house") {
    // Only an exact "do" acts without a card; any other value (a typo, an empty string, "off") is read as ask.
    if (input.mode !== "do") return { decision: "ask", reason: "mode_ask" };
    if (input.confirm) return { decision: "ask", reason: "confirmation_required" };
    if (input.tainted || (input.targets ?? 0) > BULK_THRESHOLD) return { decision: "ask", reason: "confirmation_required" };
    return { decision: "do" };
  }

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
