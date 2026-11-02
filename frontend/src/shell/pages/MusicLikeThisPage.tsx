// MUSIC-LIKE-01: the Player's "Create a band like this" and "Create a song like this" buttons land here with the playing song's
// media id. The page writes one short chat message and hands it to the chat's `?ask=` entry. A band ask carries the song's
// `maipai://music/track/<id>` reference, so the turn offers `make_band` for that object (never for the wording). A song ask
// carries the song's genre as a plain style brief, never its title or words: a like-this is a brief, never a copy.
import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { api, type Roster } from "@/lib/api";

export const BAND_PROMPT = "Create a band like this song, with a first single.";
export const SONG_PROMPT = "Make me a new song in a similar style. New words and a new tune, not a copy.";

export function likeThisMessage(op: "band" | "song", id: string, genre?: string): string {
  if (op === "band") return `${BAND_PROMPT}\n\nmaipai://music/track/${id}`;
  return genre ? `${SONG_PROMPT} The style is ${genre}.` : SONG_PROMPT;
}

export function MusicLikeThisPage({ person }: { person: Roster }) {
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state as { pageState?: { id?: unknown; op?: unknown } } | null)?.pageState;
  const id = typeof state?.id === "string" ? state.id : "";
  const op = state?.op === "song" ? "song" : "band";
  const [genre, setGenre] = useState<string | null>(op === "song" && id ? null : "");
  const child = person.age_band === "child";
  const adultOnly = op === "band" && person.age_band !== "adult";
  useEffect(() => {
    if (genre !== null || !id) return;
    let live = true;
    api.mediaItem(id).then((r) => { if (live) setGenre(String((r.item as { genre?: unknown }).genre ?? "").slice(0, 80)); }).catch(() => { if (live) setGenre(""); });
    return () => { live = false; };
  }, [genre, id]);
  if (id && !child && !adultOnly) {
    if (genre === null) return null;
    return <Navigate to={`/chat?ask=${encodeURIComponent(likeThisMessage(op, id, genre))}`} replace />;
  }
  const message = child || adultOnly
    ? "Making a band is for adults. Ask a grown-up to make one with you."
    : "This song is not available. Go back to Music and pick it again.";
  return <EmptyState icon="music" text={message} actionLabel="Back to Music" onAction={() => navigate("/apps/music")} />;
}
