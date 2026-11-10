// MUSIC-STUDIO-HOME: the Music app's Create pages (Make a band, Make an album, Make a song style), the "My creations" library of what the
// household made (bands, albums and styles) and the editor a library tile opens. Every page draws the kit's own Band, Album and
// SongStyleCard (rule 9: as shipped, restyled by tokens only, no wrapper component); the cards are the same ones the chat shows, and
// they save through the same routes as the edit tools, so a change made here or in chat is one change to one record.
// A page cannot be a schema page: the schema has no node for an editor card, so (like the Now playing page) it is drawn here, inside
// the app's own sidebar chrome. Pictures are made in chat, songs on the Make a song page; each page says so and opens chat with the right ask.
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { errorLine } from "@/lib/hubReachability";
import { i18n } from "@lingui/core";
import { useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Album, type AlbumPatch } from "@maipai/ui/src/elements/album";
import { Band, type BandPatch } from "@maipai/ui/src/elements/band";
import { SongStyleCard, type SongStylePatch } from "@maipai/ui/src/elements/song-style";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { DestructiveConfirm } from "@maipai/ui/src/primitives/DestructiveConfirm";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { MusicWorkspace, SongGallery, studioAddress, stemsAddress, remixAddress } from "./MusicWorkspacePage";
import type { MusicCard } from "@/lib/musicApi";
import { MusicStudioView } from "./MusicStudioView";
import { request } from "@/lib/api";
import { bandImageSrc } from "@/apps/chat/useBandCard";
import { musicRefOf, type MusicCardKind } from "@/apps/chat/useMusicCard";
import { useMusicBlock } from "@/apps/chat/useMusicBlock";

export const STUDIO_PAGE_IDS = ["create", "make-song", "make-band", "make-album", "make-style", "creations", "edit", "studio", "stems", "remix"] as const;
export const isStudioPage = (packageId: string, pageId: string): boolean => packageId === "music" && (STUDIO_PAGE_IDS as readonly string[]).includes(pageId);

type Kind = MusicCardKind;
const COLLECTION: Record<Kind, string> = { band: "bands", album: "albums", song_style: "styles" };
const PRODUCER: Record<Kind, string> = { band: "make_band", album: "make_album", song_style: "make_song_style" };
const PAGE_OF: Record<Kind, string> = { band: "make-band", album: "make-album", song_style: "make-style" };
const ASK: () => Record<Kind, string> = () => ({
  band: i18n._({ id: "Make me a band, with a back story, a look and a first song. Ask me what sound I want if you need to.", message: "Make me a band, with a back story, a look and a first song. Ask me what sound I want if you need to." }),
  album: i18n._({ id: "Make me an album, with a cover and a first song. Ask me what sound I want if you need to.", message: "Make me an album, with a cover and a first song. Ask me what sound I want if you need to." }),
  song_style: i18n._({ id: "Save a song style for me. Ask me what sound I want if you need to.", message: "Save a song style for me. Ask me what sound I want if you need to." }),
});
const ADULT_ONLY_LINE = () => i18n._({ id: "Making a song, a band, an album or a style is for adults. Ask a grown-up to make one with you.", message: "Making a song, a band, an album or a style is for adults. Ask a grown-up to make one with you." });

const toKind = (value: string | null): Kind | null => (value === "band" || value === "album" || value === "song_style" ? value : null);

/** The create body for a first save: the kit editor's patch, shaped as the spec record. Nothing here needs a chat turn. */
export function createBody(kind: Kind, patch: BandPatch & AlbumPatch & SongStylePatch): Record<string, unknown> {
  const style = (extra: Record<string, unknown> = {}) => ({ description: (patch.sound ?? "").trim() || i18n._({ id: "original songs", message: "original songs" }), ...(patch.genres ? { genres: patch.genres.slice(0, 8) } : {}), ...extra });
  if (kind === "band") return { name: (patch.name ?? "").trim(), ...(patch.backstory ? { backstory: patch.backstory } : {}), ...(patch.genres ? { genres: patch.genres.slice(0, 8) } : {}), style: style() };
  if (kind === "album") return { title: (patch.title ?? "").trim(), ...(patch.blurb ? { blurb: patch.blurb } : {}), ...(patch.look ? { look: patch.look } : {}), track_media_ids: [], style: style() };
  return {
    title: (patch.title ?? "").trim(),
    style: style({
      ...(patch.instrumental ? { instrumental: true } : {}),
      ...(typeof patch.bpm === "number" ? { bpm: patch.bpm } : {}),
      ...(patch.key ? { key: patch.key } : {}),
      ...(typeof patch.length_s === "number" ? { length_s: patch.length_s } : {}),
    }),
  };
}

/** The address of a made thing's editor. */
export const editPath = (kind: Kind, id: string): string => `/apps/music/edit?kind=${kind}&id=${encodeURIComponent(id)}`;

function Heading({ title, line }: { title: string; line?: string }) {
  return <header className="flex flex-col gap-1 px-4 lg:px-0">
    <h2 className="text-section font-semibold tracking-tight">{title}</h2>
    {line ? <p className="text-supporting text-muted-foreground max-w-xl">{line}</p> : null}
  </header>;
}

/** The page's frame: heading, the card passed in as children, and a line under it. The kit card itself is rendered by the caller. */
function Frame({ testId, title, line, children, footer }: { testId: string; title: string; line?: string; children: ReactNode; footer: ReactNode }) {
  return <section className="flex flex-col gap-4" data-testid={testId}>
    <Heading title={title} line={line} />
    <div className="px-4 lg:px-0">{children}</div>
    {footer}
  </section>;
}

/** The chat route that makes the same thing with Home's help (pictures, songs and the words need a chat turn). */
function AskHome({ kind }: { kind: Kind }) {
  return <p className="text-muted-foreground px-4 text-sm lg:px-0">
    {i18n._({ id: "Want Home to write it and draw the pictures?", message: "Want Home to write it and draw the pictures?" })}{" "}
    <Link className="text-foreground font-medium underline underline-offset-4" to={`/chat?ask=${encodeURIComponent(ASK()[kind])}`}>{i18n._({ id: "Make it in chat", message: "Make it in chat" })}</Link>
  </p>;
}

/** A blank card in edit mode: save makes the record, then the editor opens on it. */
export function CreatePage({ kind, adult }: { kind: Kind; adult: boolean }) {
  const navigate = useNavigate();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState("");
  if (!adult) return <EmptyState icon="music" text={ADULT_ONLY_LINE()} />;
  const save = (patch: BandPatch & AlbumPatch & SongStylePatch) => {
    setProblem("");
    request<{ id: string }>(`/api/music/${COLLECTION[kind]}`, { method: "POST", body: JSON.stringify(createBody(kind, patch)) })
      .then((made) => { void queryClient.invalidateQueries({ queryKey: ["music-made"] }); push(i18n._({ id: "{kind, select, band {Saved. Your band is in My creations.} album {Saved. Your album is in My creations.} other {Saved. Your style is in My creations.}}", message: "{kind, select, band {Saved. Your band is in My creations.} album {Saved. Your album is in My creations.} other {Saved. Your style is in My creations.}}", values: { kind } })); navigate(editPath(kind, made.id)); })
      .catch((error: unknown) => setProblem(errorLine(error, i18n._({ id: "{kind, select, band {That band was not saved. Try again.} album {That album was not saved. Try again.} other {That style was not saved. Try again.}}", message: "{kind, select, band {That band was not saved. Try again.} album {That album was not saved. Try again.} other {That style was not saved. Try again.}}", values: { kind } }))));
  };
  const heading = kind === "band" ? i18n._({ id: "Make a band", message: "Make a band" }) : kind === "album" ? i18n._({ id: "Make an album", message: "Make an album" }) : i18n._({ id: "Make a song style", message: "Make a song style" });
  const line = kind === "band" ? i18n._({ id: "Name your band and say how it sounds. Add the pictures later in chat.", message: "Name your band and say how it sounds. Add the pictures later in chat." })
    : kind === "album" ? i18n._({ id: "Name the album and say how it sounds. Home adds the cover and the songs in chat.", message: "Name the album and say how it sounds. Home adds the cover and the songs in chat." })
      : i18n._({ id: "A style is a sound you can reuse. Words only, never lyrics.", message: "A style is a sound you can reuse. Words only, never lyrics." });
  return <Frame testId={`music-${PAGE_OF[kind]}`} title={heading} line={line} footer={<AskHome kind={kind} />}>
    {problem ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={problem} /> : null}
    {kind === "band" ? <Band key="new" name="" actions={[]} editable defaultEditing onEdit={save} />
      : kind === "album" ? <Album key="new" title="" actions={[]} editable defaultEditing onEdit={save} />
        : <SongStyleCard key="new" title="" sound="" actions={[]} editable defaultEditing onEdit={save} />}
  </Frame>;
}

type Made = { id: string; name?: string; title?: string; portrait_file_id?: string | null; cover_file_id?: string | null; origin?: string; style?: { genres?: string[] }; genres?: string[]; track_media_ids?: string[] };
const fileSrc = (id: string | null | undefined): string | null => (id ? `/api/files/${encodeURIComponent(id)}/thumb?w=320` : null);

function useMadeList(kind: Kind) {
  return useQuery({ queryKey: ["music-made", kind], queryFn: () => request<Made[]>(`/api/music/${COLLECTION[kind]}${kind === "song_style" ? "?scope=all" : ""}`), staleTime: 15_000 });
}

/** One tile of the library: the picture (or a quiet block of the thing's first letter), the name and a line under it. Opens the editor. */
function Tile({ kind, item }: { kind: Kind; item: Made }) {
  const name = item.name ?? item.title ?? i18n._({ id: "Untitled", message: "Untitled" });
  const picture = fileSrc(kind === "band" ? item.portrait_file_id : kind === "album" ? item.cover_file_id : null);
  const genres = (kind === "band" ? item.genres : item.style?.genres) ?? [];
  const line = kind === "album" ? i18n._({ id: "{count, plural, one {# song} other {# songs}}", message: "{count, plural, one {# song} other {# songs}}", values: { count: item.track_media_ids?.length ?? 0 } }) : genres.slice(0, 2).join(" · ") || (item.origin === "starter" ? i18n._({ id: "Starter style", message: "Starter style" }) : "");
  return <Link to={editPath(kind, item.id)} className="group flex w-36 shrink-0 flex-col gap-2 sm:w-40" data-testid="music-made-tile">
    <div className="bg-muted text-muted-foreground relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl text-4xl font-semibold shadow-sm transition-transform group-hover:scale-105">
      {picture ? <img src={picture} alt="" loading="lazy" decoding="async" className="size-full object-cover" /> : <span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>}
    </div>
    <div className="min-w-0"><p className="truncate text-sm font-medium">{name}</p>{line ? <p className="text-muted-foreground truncate text-xs">{line}</p> : null}</div>
  </Link>;
}

function Shelf({ kind, title, makeTo, adult }: { kind: Kind; title: string; makeTo: string; adult: boolean }) {
  const list = useMadeList(kind);
  const items = list.data ?? [];
  return <section aria-label={title} className="flex flex-col gap-3">
    <div className="flex items-baseline justify-between gap-3 px-4 lg:px-0">
      <h3 className="text-lg font-semibold">{title}</h3>
      {adult ? <Link to={makeTo} className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4">{i18n._({ id: "Make one", message: "Make one" })}</Link> : null}
    </div>
    <AsyncState data={list.data} error={list.isError} isFetching={list.isFetching} onRetry={() => void list.refetch()} errorMessage={i18n._({ id: "{kind, select, band {Bands could not be loaded. Check your connection and open this page again.} album {Albums could not be loaded. Check your connection and open this page again.} other {Styles could not be loaded. Check your connection and open this page again.}}", message: "{kind, select, band {Bands could not be loaded. Check your connection and open this page again.} album {Albums could not be loaded. Check your connection and open this page again.} other {Styles could not be loaded. Check your connection and open this page again.}}", values: { kind } })} loadingLabel={i18n._({ id: "{kind, select, band {Loading bands} album {Loading albums} other {Loading styles}}", message: "{kind, select, band {Loading bands} album {Loading albums} other {Loading styles}}", values: { kind } })}>
      {() => items.length === 0 ? <p className="text-muted-foreground px-4 text-sm lg:px-0">{i18n._({ id: "{kind, select, band {No bands yet.} album {No albums yet.} other {No styles yet.}}", message: "{kind, select, band {No bands yet.} album {No albums yet.} other {No styles yet.}}", values: { kind } })}</p>
        : <div className="flex gap-3 overflow-x-auto px-4 pb-2 lg:px-0">{items.map((item) => <Tile key={item.id} kind={kind} item={item} />)}</div>}
    </AsyncState>
  </section>;
}

function CreationsPage({ adult }: { adult: boolean }) {
  const navigate = useNavigate();
  return <section className="flex flex-col gap-6" data-testid="music-creations">
    <Heading title={i18n._({ id: "Library", message: "Library" })} line={i18n._({ id: "Your songs, bands, albums and song styles. Open one to play it or change it.", message: "Your songs, bands, albums and song styles. Open one to play it or change it." })} />
    {adult ? <div className="flex flex-col gap-3 px-4 lg:px-0"><h2 className="text-body font-semibold">{i18n._({ id: "Songs", message: "Songs" })}</h2><SongGallery selected={null} onOpen={(card) => navigate(`/apps/music/create?song=${encodeURIComponent(card.id)}`)} /></div> : null}
    <Shelf kind="band" title={i18n._({ id: "Bands", message: "Bands" })} makeTo="/apps/music/create" adult={adult} />
    <Shelf kind="album" title={i18n._({ id: "Albums", message: "Albums" })} makeTo="/apps/music/create" adult={adult} />
    <Shelf kind="song_style" title={i18n._({ id: "Styles", message: "Styles" })} makeTo="/apps/music/create" adult={adult} />
  </section>;
}

/** A page that asks which song first (Studio, Stems, Remix), then goes where `go` says. */
function PickSong({ adult, title, line, go }: { adult: boolean; title: string; line: string; go: (card: MusicCard) => string }) {
  const navigate = useNavigate();
  if (!adult) return <EmptyState icon="music" text={ADULT_ONLY_LINE()} />;
  return <section className="flex flex-col gap-6 px-4 lg:px-0" data-testid="music-pick-song">
    <Heading title={title} line={line} />
    <SongGallery selected={null} onOpen={(card) => navigate(go(card))} actionsFor={() => []} />
  </section>;
}

/** The kit card for a saved record, opened in edit mode. Edits, remakes and discards go to the same routes the chat card uses. */
function EditPage({ kind, id }: { kind: Kind; id: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const card = useQuery({ queryKey: ["music-card", kind, id], queryFn: () => request<{ block: { props: Record<string, unknown> } }>(`/api/music/${COLLECTION[kind]}/${encodeURIComponent(id)}/card`), staleTime: 0 });
  const block = useMemo(() => ({ kind, provenance: `${PRODUCER[kind]}:${id}:-:-`, props: card.data?.block.props ?? {} }), [kind, id, card.data]);
  const music = useMusicBlock(block);
  const onAction = music.onAction ?? (() => undefined);
  const gone = music.gone;
  if (gone) return <EmptyState icon="music" text={i18n._({ id: "{kind, select, band {That band is gone. Your songs are still in your library.} album {That album is gone. Your songs are still in your library.} other {That style is gone. Your songs are still in your library.}}", message: "{kind, select, band {That band is gone. Your songs are still in your library.} album {That album is gone. Your songs are still in your library.} other {That style is gone. Your songs are still in your library.}}", values: { kind } })} actionLabel={i18n._({ id: "My creations", message: "My creations" })} onAction={() => navigate("/apps/music/creations")} />;
  if (card.isError) return <EmptyState icon="music" text={i18n._({ id: "{kind, select, band {That band is not here. It may have been discarded.} album {That album is not here. It may have been discarded.} other {That style is not here. It may have been discarded.}}", message: "{kind, select, band {That band is not here. It may have been discarded.} album {That album is not here. It may have been discarded.} other {That style is not here. It may have been discarded.}}", values: { kind } })} actionLabel={i18n._({ id: "My creations", message: "My creations" })} onAction={() => navigate("/apps/music/creations")} />;
  if (!card.data) return <p role="status" className="text-muted-foreground px-4 text-sm lg:px-0">{i18n._({ id: "{kind, select, band {Opening your band} album {Opening your album} other {Opening your style}}", message: "{kind, select, band {Opening your band} album {Opening your album} other {Opening your style}}", values: { kind } })}</p>;
  const props = { ...(music.props ?? card.data.block.props) };
  // A new picture or cover is made by a chat turn, so these buttons open chat with the ask and the object link (one object per turn).
  const PICTURE_ASK: Record<string, string> = { remake_portrait: i18n._({ id: "Draw a new picture of this band.", message: "Draw a new picture of this band." }), remake_logo: i18n._({ id: "Draw a new logo for this band.", message: "Draw a new logo for this band." }), remake_cover: i18n._({ id: "Make a new cover for this album.", message: "Make a new cover for this album." }) };
  const act = (action: string, detail?: Record<string, unknown>) => {
    const ask = PICTURE_ASK[action];
    if (action === "discard" && !detail) { setConfirmingDiscard(true); return; }
    if (ask) navigate(`/chat?ask=${encodeURIComponent(`${ask}\n\nmaipai://music/${kind === "song_style" ? "style" : kind}/${id}`)}`);
    else { onAction("", action, detail); void queryClient.invalidateQueries({ queryKey: ["music-made"] }); }
  };
  const actions = kind === "band" ? ["make_album", "discard"] : kind === "album" ? ["play_all", "remake_cover", "discard"] : ["make_song", "discard"];
  const shared = { editable: props.editable !== false, defaultEditing: props.editable !== false };
  const footer = <p className="text-muted-foreground px-4 text-sm lg:px-0">{i18n._({ id: "Pictures are made in chat; songs are made on", message: "Pictures are made in chat; songs are made on" })} <Link className="text-foreground font-medium underline underline-offset-4" to="/apps/music/create">{i18n._({ id: "Create", message: "Create" })}</Link>. <Link className="text-foreground font-medium underline underline-offset-4" to="/apps/music/creations">{i18n._({ id: "Back to My creations", message: "Back to My creations" })}</Link></p>;
  const discard = () => { setConfirmingDiscard(false); act("discard", {}); };
  return <Frame testId="music-edit" title={i18n._({ id: "{kind, select, band {Edit your band} album {Edit your album} other {Edit your style}}", message: "{kind, select, band {Edit your band} album {Edit your album} other {Edit your style}}", values: { kind } })} line={i18n._({ id: "Every change keeps the earlier version, so nothing is lost.", message: "Every change keeps the earlier version, so nothing is lost." })} footer={footer}>
    {kind === "band" ? <Band {...(props as unknown as ComponentProps<typeof Band>)} actions={actions as never} {...shared} resolveImageSrc={bandImageSrc} onAction={(action) => act(action)} onEdit={(patch) => act("edit_band", { ...patch })} />
        : kind === "album" ? <Album {...(props as unknown as ComponentProps<typeof Album>)} actions={actions as never} {...shared} resolveImageSrc={bandImageSrc} onAction={(action) => act(action)} onPlayTrack={(mediaId) => act("play_track", { media_id: mediaId })} onEdit={(patch) => act("edit_album", { ...patch })} />
          : <SongStyleCard {...songStyleProps(props)} actions={actions as never} {...shared} onAction={(action) => act(action)} onEdit={(patch) => act("edit_song_style", { ...patch })} />}
    {confirmingDiscard ? <DestructiveConfirm message={i18n._({ id: "{kind, select, band {Delete this band?} album {Delete this album?} other {Delete this style?}}", message: "{kind, select, band {Delete this band?} album {Delete this album?} other {Delete this style?}}", values: { kind } })} detail={i18n._({ id: "Every earlier version is kept, so it can be brought back.", message: "Every earlier version is kept, so it can be brought back." })} confirmLabel={i18n._({ id: "Delete", message: "Delete" })} busyLabel={i18n._({ id: "Deleting", message: "Deleting" })} cancelLabel={i18n._({ id: "Keep it", message: "Keep it" })} onConfirm={discard} onCancel={() => setConfirmingDiscard(false)} /> : null}
  </Frame>;
}

/** The style card names its key `musicKey`; the saved card says `key` (the answer-block schema's name). */
function songStyleProps(props: Record<string, unknown>) {
  const { key, ...rest } = props;
  return { ...(rest as unknown as ComponentProps<typeof SongStyleCard>), musicKey: key as string | undefined };
}

/** The Music app's Create and library pages. `search` is the address's query string. */
export function MusicStudioPage({ pageId, search, adult }: { pageId: string; search: string; adult: boolean }) {
  if (pageId === "create") return <MusicWorkspace adult={adult} search={search} />;
  if (pageId === "make-song" || pageId === "make-band" || pageId === "make-album" || pageId === "make-style") return <Navigate to={`/apps/music/create${search}`} replace />;
  if (pageId === "studio") return new URLSearchParams(search).get("song") ? <MusicStudioView adult={adult} search={search} /> : <PickSong adult={adult} title={i18n._({ id: "Studio", message: "Studio" })} line={i18n._({ id: "Pick a song to open its tracks.", message: "Pick a song to open its tracks." })} go={(card) => studioAddress(card.id)} />;
  if (pageId === "stems") return <PickSong adult={adult} title={i18n._({ id: "Stems", message: "Stems" })} line={i18n._({ id: "Pick a song to split into vocals, drums, bass and other. The rows open in the Studio.", message: "Pick a song to split into vocals, drums, bass and other. The rows open in the Studio." })} go={(card) => stemsAddress(card.id)} />;
  if (pageId === "remix") return <PickSong adult={adult} title={i18n._({ id: "Remix and edit", message: "Remix and edit" })} line={i18n._({ id: "Pick a song, then say what to change: the style, the words, the tempo or the voice. You see the request before anything is made.", message: "Pick a song, then say what to change: the style, the words, the tempo or the voice. You see the request before anything is made." })} go={(card) => remixAddress(card.id)} />;
  if (pageId === "creations") return <CreationsPage adult={adult} />;
  const params = new URLSearchParams(search);
  const kind = toKind(params.get("kind"));
  const id = params.get("id") ?? "";
  if (!kind || !musicRefOf(kind, `${PRODUCER[kind]}:${id}:-:-`)) return <EmptyState icon="music" text={i18n._({ id: "That page needs a band, an album or a style. Open it from My creations.", message: "That page needs a band, an album or a style. Open it from My creations." })} />;
  return <EditPage key={`${kind}:${id}`} kind={kind} id={id} />;
}
