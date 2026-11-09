// MUSIC-STUDIO-HOME: what the chat needs around a made album's or song style's card, and the edit button of a made band's card, as a
// hook so the kit's Album, SongStyle and Band Elements are drawn as shipped (rule 9: no wrapper, no markup of Home's own). The card's
// ids ride in the block's `provenance` (`make_album:<album>:<conversation>:<turn>`, likewise `make_song_style`); a button never
// names a route. A saved edit comes back as a new card, so the chat card, the Music app and the edit tools always show one record.
// What a button did is said in a toast (the kit's one transient notice).
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { MediaHostContext } from "@maipai/ui/src/schema/mediaHost";
import { request } from "@/lib/api";
import { errorLine } from "@/lib/hubReachability";

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

type CardReply = { block: { props: Record<string, unknown> }; cover_state?: CoverState };
const musicCardKey = (kind: MusicCardKind, id: string, conversationId: string | null, turnId: string | null) => ["music-card-live", kind, id, conversationId, turnId];
const POLL_MS = 3000;
const POLL_MAX = 40;

/** The props that mean "a picture or a song is still coming", so the card is watched until it arrives. */
export type CoverState = "ready" | "pending" | "no_engine";
/** With no picture engine a cover never comes, so only the songs are waited for. */
export function stillMaking(kind: MusicCardKind, props: Record<string, unknown> | null, cover: CoverState | undefined = undefined): boolean {
  if (!props) return true;
  if (kind === "album") return (!props.cover && cover !== "no_engine") || !Array.isArray(props.tracks) || props.tracks.length === 0;
  return false;
}
export const NO_ENGINE_NOTE = "There is no picture engine set up, so this album has no cover. Add one in Settings under AI and models.";

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
  const [discarded, setDiscarded] = useState(false);
  const [busy, setBusy] = useState(false);
  const told = useRef(false);

  // The card, read again every 3 s while a picture or a song is still coming (at most POLL_MAX reads); a 404 means the record is gone.
  // A band's pictures come from useBandCard; the band card is read here only after an edit, so it is not read at all.
  const cardKey = musicCardKey(kind, id, conversationId, turnId);
  const look = useQuery({
    queryKey: cardKey,
    enabled: id !== "" && kind !== "band",
    retry: false,
    queryFn: () => request<CardReply>(cardPath(kind, id, conversationId, turnId)),
    refetchInterval: (query) => {
      const data = query.state.data;
      if ((query.state.error as { status?: number } | null)?.status === 404) return false;
      if (data && !stillMaking(kind, data.block.props, data.cover_state)) return false;
      return query.state.dataUpdateCount + query.state.errorUpdateCount < POLL_MAX ? POLL_MS : false;
    },
  });
  // After an edit the saved card comes back whole and replaces what was read.
  const [edited, setEdited] = useState<Record<string, unknown> | null>(null);
  const live = edited ?? look.data?.block.props ?? null;
  const gone = discarded || (look.error as { status?: number } | null)?.status === 404;
  const refetchCard = look.refetch;
  const cover = look.data?.cover_state;
  const readProps = look.data?.block.props;
  useEffect(() => {
    // Said once, and only while the album is new (its songs are still coming), so an old album does not announce it on every visit.
    if (cover === "no_engine" && !told.current && readProps && !(Array.isArray(readProps.tracks) && readProps.tracks.length > 0)) { told.current = true; push(NO_ENGINE_NOTE); }
  }, [cover, readProps, push]);

  const play = useCallback((mediaId: string) => {
    if (host) void Promise.resolve(host.onPlay(mediaId, {})).catch((error: unknown) => push(errorLine(error, "That song could not play. Try again.")));
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
        if (action === "discard") { setDiscarded(true); return; }
        const next = (done.album ?? done.style ?? done.band)?.props;
        if (next) setEdited(next);
        if ((action === "play_all" || action === "keep") && done.media_id) play(done.media_id);
        if (action === "remake_cover") { setEdited(null); void refetchCard(); }
      })
      .catch((error: unknown) => push(errorLine(error, "That did not work. Try again.")))
      .finally(() => setBusy(false));
  }, [id, kind, busy, conversationId, turnId, navigate, play, push, refetchCard]);

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
