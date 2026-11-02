// MUSIC-STUDIO-HOME: what the chat needs around a made album's or song style's card, and the edit button of a made band's card, as a
// hook so the kit's Album, SongStyle and Band Elements are drawn as shipped (rule 9: no wrapper, no markup of Home's own). The card's
// ids ride in the block's `provenance` (`make_album:<album>:<conversation>:<turn>`, likewise `make_song_style`); a button never
// names a route. A saved edit comes back as a new card, so the chat card, the Music app and the edit tools always show one record.
// What a button did is said in a toast (the kit's one transient notice).
import { useCallback, useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { MediaHostContext } from "@maipai/ui/src/schema/mediaHost";
import { request } from "@/lib/api";

export type MusicCardKind = "album" | "song_style" | "band";
type Block = { kind: string; provenance?: string; props: unknown };
type Done = { action: string; done: string; media_id?: string | null; album?: { props?: Record<string, unknown> }; style?: { props?: Record<string, unknown> }; band?: { props?: Record<string, unknown> } };

const ROUTE = { album: "albums", song_style: "styles", band: "bands" } as const;
const PRODUCER = { album: "make_album", song_style: "make_song_style", band: "make_band" } as const;
const ID_SHAPE = { album: /^malbum-[a-z0-9]+$/, song_style: /^sstyle-[a-z0-9]+$/, band: /^mband-[a-z0-9]+$/ } as const;

/** `make_album:<album>:<conversation>:<turn>` (or the style or band producer) to its parts; anything else is not a card of ours. */
export function musicRefOf(kind: string, provenance: string): { id: string; conversationId: string | null; turnId: string | null } | null {
  if (kind !== "album" && kind !== "song_style" && kind !== "band") return null;
  const [producer, id, conversationId, turnId] = provenance.split(":");
  if (producer !== PRODUCER[kind] || !id || !ID_SHAPE[kind].test(id)) return null;
  return { id, conversationId: conversationId && conversationId !== "-" ? conversationId : null, turnId: turnId && turnId !== "-" ? turnId : null };
}

/** The card route's address, with where the card was made so a new cover can be filed in that chat. */
export function cardPath(kind: MusicCardKind, id: string, conversationId: string | null, turnId: string | null): string {
  const query = conversationId && turnId ? `?conversation_id=${encodeURIComponent(conversationId)}&turn_id=${encodeURIComponent(turnId)}` : "";
  return `/api/music/${ROUTE[kind]}/${encodeURIComponent(id)}/card${query}`;
}

/** The chat ask a "make something from this" button opens: the words, then the object link the turn reads (one object per turn). */
export function studioAsk(action: "make_album" | "make_song", kind: MusicCardKind, id: string): string {
  const object = kind === "song_style" ? "style" : kind;
  return `${action === "make_album" ? "Make an album in this sound." : "Make me a new song in this sound."}\n\nmaipai://music/${object}/${id}`;
}

/** The kit's edit action for a card kind, as the action route names it. */
const EDIT_ACTION = { album: "edit_album", song_style: "edit_song_style", band: "edit_band" } as const;

const POLL_MS = 3000;
const POLL_MAX = 40;

/** The props that mean "a picture or a song is still coming", so the card is watched until it arrives. */
function stillMaking(kind: MusicCardKind, props: Record<string, unknown> | null): boolean {
  if (!props) return true;
  if (kind === "album") return !props.cover || !Array.isArray(props.tracks) || props.tracks.length === 0;
  return false;
}

/**
 * For an `album` or `song_style` block (and the edit button of a `band` block): its live props, the button handler and whether the
 * record is gone. For any other block: inert. A band's pictures are `useBandCard`'s job; this hook only adds the band edit.
 */
export function useMusicCard(block: Block): { props: Record<string, unknown> | null; onAction: ((blockId: string, action: string, detail?: Record<string, unknown>) => void) | null; gone: boolean } {
  const navigate = useNavigate();
  const { push } = useToast();
  const host = useContext(MediaHostContext);
  const ref = musicRefOf(block.kind, block.provenance ?? "");
  const kind = (ref ? block.kind : "album") as MusicCardKind;
  const id = ref?.id ?? ""; const conversationId = ref?.conversationId ?? null; const turnId = ref?.turnId ?? null;
  const [live, setLive] = useState<Record<string, unknown> | null>(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [watch, setWatch] = useState(0);

  useEffect(() => {
    // A band's pictures come from useBandCard; the band card is read here only after an edit.
    if (!id || kind === "band") return;
    let alive = true; let polls = 0; let timer: ReturnType<typeof setTimeout> | undefined;
    const look = async () => {
      try {
        const got = await request<{ block: { props: Record<string, unknown> } }>(cardPath(kind, id, conversationId, turnId));
        if (!alive) return;
        setLive(got.block.props);
        if (!stillMaking(kind, got.block.props)) return;
      } catch (error) {
        if (!alive) return;
        if ((error as { status?: number }).status === 404) { setGone(true); return; }
      }
      polls += 1;
      if (alive && polls < POLL_MAX) timer = setTimeout(look, POLL_MS);
    };
    void look();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [id, kind, conversationId, turnId, watch]);

  const play = useCallback((mediaId: string) => {
    if (host) void Promise.resolve(host.onPlay(mediaId, {})).catch((error: unknown) => push(error instanceof Error && error.message ? error.message : "That song could not play. Try again."));
    else navigate(`/media/${encodeURIComponent(mediaId)}`);
  }, [host, navigate, push]);

  const onAction = useCallback((_blockId: string, action: string, detail?: Record<string, unknown>) => {
    if (!id || busy) return;
    if (action === "play_track") { if (typeof detail?.media_id === "string") play(detail.media_id); return; }
    if (action === "open_app") { navigate("/apps/music"); return; }
    if (action === "make_song" || action === "make_album") { navigate(`/chat?ask=${encodeURIComponent(studioAsk(action, kind, id))}`); return; }
    const isEdit = action === EDIT_ACTION[kind];
    const send = isEdit ? { action: "edit", patch: detail ?? {} } : { action };
    setBusy(true);
    request<Done>(`/api/music/${ROUTE[kind]}/${encodeURIComponent(id)}/action`, { method: "POST", body: JSON.stringify({ ...send, conversation_id: conversationId, turn_id: turnId }) })
      .then((done) => {
        push(done.done);
        if (action === "discard") { setGone(true); return; }
        const next = (done.album ?? done.style ?? done.band)?.props;
        if (next) setLive(next);
        if ((action === "play_all" || action === "keep") && done.media_id) play(done.media_id);
        if (action === "remake_cover") setWatch((n) => n + 1);
      })
      .catch((error: unknown) => push(error instanceof Error && error.message ? error.message : "That did not work. Try again."))
      .finally(() => setBusy(false));
  }, [id, kind, busy, conversationId, turnId, navigate, play, push]);

  if (!ref) return { props: null, onAction: null, gone: false };
  // A band's props stay useBandCard's until an edit brings back the whole saved card.
  if (kind === "band") return { props: live, onAction, gone };
  return { props: live ? { ...(block.props as Record<string, unknown>), ...live } : (block.props as Record<string, unknown>), onAction, gone };
}

type Handler = ((blockId: string, action: string, detail?: Record<string, unknown>) => void) | null;
/** A band card has two hooks (its pictures and buttons: useBandCard; its edit: this one). Edit goes to the studio hook, everything else to the band hook. */
export function joinBandAndStudio(band: Handler, studio: Handler): Handler {
  if (!studio || !band) return studio ?? band;
  return (id, action, detail) => (action === "edit_band" ? studio : band)(id, action, detail);
}
