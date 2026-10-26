export type HomeBlockId = "greeting" | "admin" | "ask" | "hero" | "pick_up" | "today" | "family" | "getting_started";

/** One ordered block list keeps Home ready for additional arrangements. */
export function homeBlocks(_layout: string = "default"): HomeBlockId[] {
  return ["greeting", "admin", "ask", "hero", "pick_up", "today", "family", "getting_started"];
}
