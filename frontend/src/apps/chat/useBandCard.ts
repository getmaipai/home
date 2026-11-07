// MUSIC-LIKE-01: what the chat needs around a made band's card, as a hook so the kit's Band Element is drawn as shipped (rule 9:
// no wrapper component, no markup of Home's own). It turns the hub's picture references into file addresses, watches the band's
// record so the portrait and logo appear when their pictures finish, and sends the card's buttons to the band route. The band id and
// the turn the card was made in ride in the block's `provenance` (`make_band:<band>:<conversation>:<turn>`); a button never names a
// route. What a button did is said in a toast (the kit's one transient notice), because the card has no place for a status line.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { request } from "@/lib/api";
import { likeThisMessage } from "@/shell/pages/MusicLikeThisPage";
import { musicRefOf } from "@/apps/chat/useMusicCard";

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

const POLL_MS = 3000;
const POLL_MAX = 100;

/** For a `band` block: its props with live pictures, the button handler, and whether the band is gone. For any other block: inert. */
export function useBandCard(block: { kind: string; provenance?: string; props: unknown }): { props: Record<string, unknown> | null; onAction: ((blockId: string, action: string) => void) | null; gone: boolean } {
  const navigate = useNavigate();
  const { push } = useToast();
  const ref = block.kind === "band" ? musicRefOf("band", block.provenance ?? "") : null;
  const bandId = ref?.id ?? "";
  const conversationId = ref?.conversationId ?? null; const turnId = ref?.turnId ?? null;
  const [band, setBand] = useState<Band | null>(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [watch, setWatch] = useState(0);
  // After a remake the server still holds the old picture until the new one is filed: the old id means "not ready yet".
  const staleRef = useRef<Stale>({});

  useEffect(() => {
    if (!bandId) return;
    let live = true; let polls = 0; let timer: ReturnType<typeof setTimeout> | undefined;
    const look = async () => {
      try {
        const got = await request<Band>(`/api/music/bands/${encodeURIComponent(bandId)}`);
        if (!live) return;
        const next = settleStale(got, staleRef.current);
        setBand(next);
        if (next.portrait_file_id && next.logo_file_id) return;
      } catch (error) {
        if (!live) return;
        if ((error as { status?: number }).status === 404) { setGone(true); return; }
      }
      polls += 1;
      if (live && polls < POLL_MAX) timer = setTimeout(look, POLL_MS);
    };
    void look();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [bandId, watch]);

  const onAction = useCallback((_blockId: string, action: string) => {
    if (!bandId || busy) return;
    setBusy(true);
    request<Done>(`/api/music/bands/${encodeURIComponent(bandId)}/action`, { method: "POST", body: JSON.stringify({ action, conversation_id: conversationId, turn_id: turnId }) })
      .then((done) => {
        push(done.done);
        if (action === "discard") setGone(true);
        else if (action === "remake" && done.seed_media_id) navigate(`/chat?ask=${encodeURIComponent(likeThisMessage("band", done.seed_media_id))}`);
        else if (action === "remake_portrait" || action === "remake_logo") {
          const part = action === "remake_logo" ? "logo_file_id" : "portrait_file_id";
          setBand((now) => { if (now) staleRef.current[part] = now[part] ?? null; return now ? { ...now, [part]: null } : now; });
          setWatch((n) => n + 1);
        }
      })
      .catch((error: unknown) => push(error instanceof Error && error.message ? error.message : "That did not work. Try again."))
      .finally(() => setBusy(false));
  }, [bandId, conversationId, turnId, busy, navigate, push]);

  if (!ref) return { props: null, onAction: null, gone: false };
  return { props: withBandPictures(block.props as Record<string, unknown>, band), onAction, gone };
}
