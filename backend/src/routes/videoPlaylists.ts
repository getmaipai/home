// MEDIA-PARITY-02 (Videos): the routes the playlist and history actions call, under /api/plugins/video. Rules live in lib/videos/playlists.ts and history.ts.
import { jsonBody } from "@/lib/validation";
import { apiRouter, respond } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { createVideoPlaylist, deleteVideoPlaylist, removeFromVideoPlaylist, renameVideoPlaylist, reorderVideoPlaylist, saveToVideoPlaylist } from "@/lib/videos/playlists";
import { removeFromHistory } from "@/lib/videos/history";
import { addPick, togglePickVote } from "@/lib/media/familyPicks";

export function videoPlaylistRoutes() {
  const routes = apiRouter();
  routes.post("/playlists/new", requireAuth, async (c) => respond(c, createVideoPlaylist(c.get("person"), (await jsonBody(c)).title)));
  routes.post("/playlists/save", requireAuth, async (c) => respond(c, saveToVideoPlaylist(c.get("person"), await jsonBody(c))));
  routes.post("/playlists/reorder", requireAuth, async (c) => respond(c, reorderVideoPlaylist(c.get("person"), await jsonBody(c))));
  routes.post("/playlists/remove", requireAuth, async (c) => respond(c, removeFromVideoPlaylist(c.get("person"), await jsonBody(c))));
  routes.post("/playlists/rename", requireAuth, async (c) => respond(c, renameVideoPlaylist(c.get("person"), await jsonBody(c))));
  routes.post("/playlists/delete", requireAuth, async (c) => respond(c, deleteVideoPlaylist(c.get("person"), await jsonBody(c))));
  routes.post("/history/remove", requireAuth, async (c) => respond(c, removeFromHistory(c.get("person"), await jsonBody(c))));
  routes.post("/picks/add", requireAuth, async (c) => respond(c, addPick(c.get("person"), String((await jsonBody(c)).media_id ?? ""))));
  routes.post("/picks/vote", requireAuth, async (c) => respond(c, togglePickVote(c.get("person"), String((await jsonBody(c)).media_id ?? ""))));
  return routes;
}
