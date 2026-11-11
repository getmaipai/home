import { i18n } from "@lingui/core";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { MediaShelf } from "@maipai/ui/src/primitives/MediaShelf";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { SafeImage, type ImageFallbackKind } from "@maipai/ui/src/primitives/SafeImage";
import { Section } from "@maipai/ui/src/primitives/Section";
import { Item, ItemContent, ItemMedia, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { getIcon } from "@maipai/ui/src/icons";
import { api, type MediaHome, type MediaHomeRow, type PersonRosterEntry, type Roster } from "@/lib/api";

const FALLBACK: Record<MediaHomeRow["app"], ImageFallbackKind> = { videos: "video", shows: "video", music: "music", podcasts: "music", books: "file" };
const ChatIcon = getIcon("message-circle");

/** AUDIT-UI-01: a tile with no picture shows an icon for what it is: a chat bubble for a conversation (it rides the shelf under the videos app,
 * which used to give it a film strip), a film for a clip, a note for a song. */
export function tilePicture(row: MediaHomeRow, small = false) {
  return row.kind === "chat"
    ? <SafeImage src={row.artwork_url} alt="" kind="picture" tintSeed={row.title} label={small ? undefined : row.title} fallbackContent={<ChatIcon aria-hidden className={small ? "size-4 text-foreground/70" : "size-1/3 text-foreground/70"} />} />
    : <SafeImage src={row.artwork_url} alt="" kind={FALLBACK[row.app]} tintSeed={row.title} label={small ? undefined : row.title} />;
}

/** The most shortcuts Continue shows: two columns of three on a phone, one row of six on a wide screen. */
export const CONTINUE_SHORTCUTS = 6;

/** The app a /api/continue row's media kind belongs to, for the picture it shows while it has no artwork. */
const continueApp = (mediaKind: string | null): MediaHomeRow["app"] => /song|track|music|album/.test(mediaKind ?? "") ? "music" : /podcast|episode/.test(mediaKind ?? "") ? "podcasts" : /book/.test(mediaKind ?? "") ? "books" : "videos";

/** Continue: compact shortcuts (a small picture or icon, one line of title), two columns on a phone and one row on a wide screen. */
function ContinueGrid({ rows }: { rows: MediaHomeRow[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      {rows.slice(0, CONTINUE_SHORTCUTS).map((row) => (
        <Item key={`${row.app}/${row.id}`} size="sm" variant="muted" render={<Link to={row.href} />}>
          <ItemMedia variant="image">{tilePicture(row, true)}</ItemMedia>
          <ItemContent><ItemTitle><span className="line-clamp-2 break-words">{row.title}</span></ItemTitle></ItemContent>
        </Item>
      ))}
    </div>
  );
}

export function ContinueShelf() {
  const heading = i18n._({ id: "Continue", message: "Continue" });
  const query = useQuery({ queryKey: ["home-continue"], queryFn: api.continueRows, retry: false });
  if (query.isPending || query.isError) return <AsyncState data={query.data} error={query.isError} isFetching={query.isFetching} onRetry={() => void query.refetch()} errorMessage={i18n._({ id: "Could not load your recent items. Refresh Home to try again.", message: "Could not load your recent items. Refresh Home to try again." })} loadingLabel={i18n._({ id: "Loading your recent items", message: "Loading your recent items" })}>{() => null}</AsyncState>;
  const rows = (query.data.rows ?? []).map((row): MediaHomeRow => ({ id: `${row.source}/${row.id}`, app: continueApp(row.media_kind), kind: row.media_kind === null ? "chat" : row.kind, title: row.title, subtitle: row.subtitle, artwork_url: row.artwork_url, href: row.href, percent: row.percent, at: row.at }));
  return <section aria-label={heading}><Section variant="flat" heading={heading}>
    {rows.length ? <ContinueGrid rows={rows} /> : <p className="text-supporting text-muted-foreground">{i18n._({ id: "Nothing to pick up yet. Chats and things you play show up here.", message: "Nothing to pick up yet. Chats and things you play show up here." })}</p>}
  </Section></section>;
}

export function FamilyShelf({ viewer, incognito }: { viewer: Roster; incognito: boolean }) {
  const query = useQuery({ queryKey: ["home-family"], queryFn: api.people, retry: false, enabled: !incognito && viewer.role !== "guest" });
  if (incognito || viewer.role === "guest" || query.isPending) return null;
  if (query.isError) return <p role="alert" className="text-supporting text-muted-foreground">{i18n._({ id: "Could not load your family. Refresh Home to try again.", message: "Could not load your family. Refresh Home to try again." })}</p>;
  const own = (query.data ?? []).find((entry) => entry.id === viewer.id);
  if (!own) return null;
  return <section aria-label={i18n._({ id: "Your family", message: "Your family" })}><Section variant="flat" heading={i18n._({ id: "Your family", message: "Your family" })}><div className="flex flex-wrap gap-4">
    {(query.data ?? []).map((entry: PersonRosterEntry) => <Link key={entry.id} to={`/people/${entry.id}`} className="flex flex-col items-center gap-1 text-supporting"><Avatar name={entry.display_name} className="size-12" /><span>{entry.display_name}</span></Link>)}
  </div></Section></section>;
}

function MediaRows({ heading, rows }: { heading: string; rows: MediaHomeRow[] }) {
  const navigate = useNavigate();
  if (!rows.length) return null;
  return <MediaShelf heading={heading} items={rows} getKey={(row) => row.id} getLabel={(row) => row.title} renderItem={(row) => tilePicture(row)} renderCaption={(row) => row.subtitle ? <span className="truncate text-supporting text-muted-foreground">{row.subtitle}</span> : null} aspect="square" getProgress={(row) => row.percent === null ? undefined : row.percent / 100} variant="plain" headingStyle="section" tileSize="pro" bleed onSelect={(row) => navigate(row.href)} />;
}

export function HomeMedia({ kind }: { kind: "continue" | "new" | "made_at_home" }) {
  const query = useQuery({ queryKey: ["home-media"], queryFn: api.mediaHome, retry: false });
  const continuing = useQuery({ queryKey: ["home-continue"], queryFn: api.continueRows, retry: false, enabled: kind === "continue" });
  if (query.isPending || query.isError) return <AsyncState data={query.data} error={query.isError} isFetching={query.isFetching} onRetry={() => void query.refetch()} errorMessage={i18n._({ id: "Could not load your library. Refresh Home to try again.", message: "Could not load your library. Refresh Home to try again." })} loadingLabel={i18n._({ id: "Loading your library", message: "Loading your library" })}>{() => null}</AsyncState>;
  const data: MediaHome = query.data;
  const rows = kind === "continue" ? [
    ...data.continue,
    ...(continuing.data?.rows ?? []).filter((row) => row.media_kind === null).map((row) => ({
      id: row.id, app: "videos" as const, kind: "chat", title: row.title, subtitle: row.subtitle,
      artwork_url: row.artwork_url, href: row.href, percent: row.percent, at: row.at,
    })),
  ] : data[kind];
  const heading = kind === "continue" ? i18n._({ id: "Continue", message: "Continue" }) : kind === "new" ? i18n._({ id: "New in your library", message: "New in your library" }) : i18n._({ id: "Made at home", message: "Made at home" });
  if (kind === "continue") return rows.length ? <section aria-label={heading}><Section variant="flat" heading={heading}><ContinueGrid rows={rows} /></Section></section> : null;
  return <MediaRows heading={heading} rows={rows} />;
}
