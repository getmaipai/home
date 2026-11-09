// MUSIC-LIKE-01: what the chat needs around a made band's card, as a hook so the kit's Band Element is drawn as shipped (rule 9:
// no wrapper component, no markup of Home's own). It turns the hub's picture references into file addresses, watches the band's
// record so the portrait and logo appear when their pictures finish, and sends the card's buttons to the band route. The band id and
// the turn the card was made in ride in the block's `provenance` (`make_band:<band>:<conversation>:<turn>`); a button never names a
// route. What a button did is said in a toast (the kit's one transient notice), because the card has no place for a status line.
import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { request } from "@/lib/api";
import { likeThisMessage } from "@/shell/pages/MusicLikeThisPage";
import { musicRefOf } from "@/apps/chat/useMusicCard";
import { errorLine } from "@/lib/hubReachability";

type Band = { id: string; portrait_file_id?: string | null; logo_file_id?: string | null };
type Done = { action: string; done: string; seed_media_id?: string | null };

/** The hub's picture reference carries the file id in hex (`hubimg-<hex>`); the file's own address serves the picture. */
export function bandImageSrc(src: string): string {
  const hex = /^hubimg-([a-f0-9]{8,})$/.exec(src)?.[1];
  if (!hex || hex.length % 2) return src;
  const id = new TextDecoder().decode(Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16)));
  return `/api/files/${encodeURIComponent(id)}/thumb?w=640`;
}
const refOf = (fileId: string): string => `hubimg-${Array.from(new TextEncoder().encode(fileId), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;

/** The block with the band's finished pictures filled in (or a remade one removed until it is ready). */
export function withBandPictures(props: Record<string, unknown>, band: Band | null): Record<string, unknown> {
  if (!band) return props;
  const next = { ...props };
  const name = String(props.name ?? "");
  if (band.portrait_file_id) next.portrait = { src: refOf(band.portrait_file_id), alt: (props.portrait as { alt?: string } | undefined)?.alt ?? `Portrait of the band ${name}` };
  else delete next.portrait;
  if (band.logo_file_id) next.logo = { src: refOf(band.logo_file_id), alt: (props.logo as { alt?: string } | undefined)?.alt ?? `Logo of the band ${name}` };
  else delete next.logo;
  return next;
}

type Stale = { portrait_file_id?: string | null; logo_file_id?: string | null };
/** After a remake the server still holds the old picture until the new one is filed. A picture that still has its old id counts as not ready;
 * the first different id clears the mark (the map is updated in place). */
export function settleStale(band: Band, stale: Stale): Band {
  const next = { ...band };
  for (const part of ["portrait_file_id", "logo_file_id"] as const) {
    const old = stale[part];
    if (old === undefined) continue;
    if ((next[part] ?? null) === old) next[part] = null; else delete stale[part];
  }
  return next;
}

const bandKey = (bandId: string) => ["music-band-card", bandId];
const POLL_MS = 3000;
const POLL_MAX = 100;

/** For a `band` block: its props with live pictures, the button handler, and whether the band is gone. For any other block: inert. */
export function useBandCard(block: { kind: string; provenance?: string; props: unknown }): { props: Record<string, unknown> | null; onAction: ((blockId: string, action: string) => void) | null; gone: boolean } {
  const navigate = useNavigate();
  const { push } = useToast();
  const ref = block.kind === "band" ? musicRefOf("band", block.provenance ?? "") : null;
  const bandId = ref?.id ?? "";
  const conversationId = ref?.conversationId ?? null; const turnId = ref?.turnId ?? null;
  const queryClient = useQueryClient();
  const [discarded, setDiscarded] = useState(false);
  const [busy, setBusy] = useState(false);
  // After a remake the server still holds the old picture until the new one is filed: the old id means "not ready yet".
  const staleRef = useRef<Stale>({});
  // The band record, read again every 3 s until both pictures are filed (at most POLL_MAX reads); a 404 means the band is gone.
  const look = useQuery({
    queryKey: bandKey(bandId),
    enabled: bandId !== "",
    retry: false,
    queryFn: async () => settleStale(await request<Band>(`/api/music/bands/${encodeURIComponent(bandId)}`), staleRef.current),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.portrait_file_id && data.logo_file_id) return false;
      if ((query.state.error as { status?: number } | null)?.status === 404) return false;
      return query.state.dataUpdateCount + query.state.errorUpdateCount < POLL_MAX ? POLL_MS : false;
    },
  });
  const refetchBand = look.refetch;
  const band = look.data ?? null;
  const gone = discarded || (look.error as { status?: number } | null)?.status === 404;

  const onAction = useCallback((_blockId: string, action: string) => {
    if (!bandId || busy) return;
    setBusy(true);
    request<Done>(`/api/music/bands/${encodeURIComponent(bandId)}/action`, { method: "POST", body: JSON.stringify({ action, conversation_id: conversationId, turn_id: turnId }) })
      .then((done) => {
        push(done.done);
        if (action === "discard") setDiscarded(true);
        else if (action === "remake" && done.seed_media_id) navigate(`/chat?ask=${encodeURIComponent(likeThisMessage("band", done.seed_media_id))}`);
        else if (action === "remake_portrait" || action === "remake_logo") {
          const part = action === "remake_logo" ? "logo_file_id" : "portrait_file_id";
          const now = queryClient.getQueryData<Band>(bandKey(bandId));
          if (now) { staleRef.current[part] = now[part] ?? null; queryClient.setQueryData<Band>(bandKey(bandId), { ...now, [part]: null }); }
          void refetchBand();
        }
      })
      .catch((error: unknown) => push(errorLine(error, "That did not work. Try again.")))
      .finally(() => setBusy(false));
  }, [bandId, conversationId, turnId, busy, navigate, push, queryClient, refetchBand]);

  if (!ref) return { props: null, onAction: null, gone: false };
  return { props: withBandPictures(block.props as Record<string, unknown>, band), onAction, gone };
}
