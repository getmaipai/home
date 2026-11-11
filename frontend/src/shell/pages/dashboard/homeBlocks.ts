export type HomeLayout = "ask" | "board" | "shelves";
export type HomeBlockId = "greeting" | "admin" | "ask" | "make" | "actions" | "hero" | "pick_up" | "today" | "family" | "getting_started" | "today_chips" | "media_continue" | "media_new" | "media_made";

/** One ordered block list keeps Home ready for additional arrangements. */
export function homeBlocks(layout: HomeLayout = "ask", shelvesReady = true): HomeBlockId[] {
  if (layout === "shelves" && !shelvesReady) return homeBlocks("ask");
  if (layout === "ask") return ["greeting", "hero", "ask", "make", "today_chips", "pick_up", "family", "getting_started", "admin"];
  if (layout === "board") return ["greeting", "hero", "ask", "make", "pick_up", "today", "family", "getting_started", "admin"];
  return ["greeting", "hero", "ask", "make", "media_continue", "today", "media_new", "media_made", "family", "getting_started", "admin"];
}
