export type HomeLayout = "ask" | "board" | "shelves";
export type HomeBlockId = "greeting" | "admin" | "ask" | "hero" | "pick_up" | "today" | "family" | "getting_started" | "today_chips" | "media_continue" | "media_new" | "media_made";

/** One ordered block list keeps Home ready for additional arrangements. */
export function homeBlocks(layout: HomeLayout = "ask", shelvesReady = true): HomeBlockId[] {
  if (layout === "shelves" && !shelvesReady) return homeBlocks("ask");
  if (layout === "ask") return ["greeting", "admin", "ask", "today_chips", "pick_up", "family", "getting_started"];
  if (layout === "board") return ["greeting", "admin", "hero", "ask", "pick_up", "today", "family", "getting_started"];
  return ["greeting", "admin", "ask", "media_continue", "today", "media_new", "media_made", "getting_started"];
}
