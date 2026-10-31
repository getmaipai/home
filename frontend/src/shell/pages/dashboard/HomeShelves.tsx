import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { MediaShelf } from "@maipai/ui/src/primitives/MediaShelf";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { SafeImage, type ImageFallbackKind } from "@maipai/ui/src/primitives/SafeImage";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { api, type MediaHome, type MediaHomeRow, type PersonRosterEntry, type Roster } from "@/lib/api";

const FALLBACK: Record<MediaHomeRow["app"], ImageFallbackKind> = { videos: "video", shows: "video", music: "music", podcasts: "music", books: "file" };

export function ContinueShelf() {
  const query = useQuery({ queryKey: ["home-continue"], queryFn: api.continueRows, retry: false });
  if (query.isPending || query.isError) return <AsyncState data={query.data} error={query.isError} isFetching={query.isFetching} onRetry={() => void query.refetch()} errorMessage="Could not load your recent items. Refresh Home to try again." loadingLabel="Loading your recent items">{() => null}</AsyncState>;
  const rows = query.data.rows ?? [];
  if (!rows.length) return null;
  return <section aria-label="Pick up where you left off"><Card size="sm"><CardHeader><CardTitle>Pick up where you left off</CardTitle></CardHeader><CardContent><ItemGroup>
    {rows.map((row) => <Item key={`${row.source}/${row.id}`} size="sm" render={<Link to={row.href} />}><ItemContent><ItemTitle>{row.title}</ItemTitle>{row.subtitle ? <ItemDescription>{row.subtitle}</ItemDescription> : null}</ItemContent></Item>)}
  </ItemGroup></CardContent></Card></section>;
}

export function FamilyShelf({ viewer, incognito }: { viewer: Roster; incognito: boolean }) {
  const query = useQuery({ queryKey: ["home-family"], queryFn: api.people, retry: false, enabled: !incognito && viewer.role !== "guest" });
  if (incognito || viewer.role === "guest" || query.isPending) return null;
  if (query.isError) return <p role="alert" className="text-sm text-muted-foreground">Could not load your family. Refresh Home to try again.</p>;
  const own = (query.data ?? []).find((entry) => entry.id === viewer.id);
  if (!own) return null;
  return <section aria-label="Your family"><Card size="sm"><CardHeader><CardTitle>Your family</CardTitle></CardHeader><CardContent><div className="flex flex-wrap gap-4">
    {(query.data ?? []).map((entry: PersonRosterEntry) => <Link key={entry.id} to={`/people/${entry.id}`} className="flex flex-col items-center gap-1 text-sm"><Avatar name={entry.display_name} className="size-12" /><span>{entry.display_name}</span></Link>)}
  </div></CardContent></Card></section>;
}

function MediaRows({ heading, rows }: { heading: string; rows: MediaHomeRow[] }) {
  const navigate = useNavigate();
  if (!rows.length) return null;
  return <MediaShelf heading={heading} items={rows} getKey={(row) => row.id} getLabel={(row) => row.title} renderItem={(row) => <SafeImage src={row.artwork_url} alt="" kind={FALLBACK[row.app]} />} renderCaption={(row) => <span className="flex min-w-0 flex-col"><span className="truncate text-sm font-semibold">{row.title}</span>{row.subtitle ? <span className="truncate text-sm text-muted-foreground">{row.subtitle}</span> : null}</span>} aspect="wide" getProgress={(row) => row.percent === null ? undefined : row.percent / 100} variant="card" onSelect={(row) => navigate(row.href)} />;
}

export function HomeMedia({ kind }: { kind: "continue" | "new" | "made_at_home" }) {
  const query = useQuery({ queryKey: ["home-media"], queryFn: api.mediaHome, retry: false });
  const continuing = useQuery({ queryKey: ["home-continue"], queryFn: api.continueRows, retry: false, enabled: kind === "continue" });
  if (query.isPending || query.isError) return <AsyncState data={query.data} error={query.isError} isFetching={query.isFetching} onRetry={() => void query.refetch()} errorMessage="Could not load your library. Refresh Home to try again." loadingLabel="Loading your library">{() => null}</AsyncState>;
  const data: MediaHome = query.data;
  const rows = kind === "continue" ? [
    ...data.continue,
    ...(continuing.data?.rows ?? []).filter((row) => row.media_kind === null).map((row) => ({
      id: row.id, app: "videos" as const, kind: "chat", title: row.title, subtitle: row.subtitle,
      artwork_url: row.artwork_url, href: row.href, percent: row.percent, at: row.at,
    })),
  ] : data[kind];
  const heading = kind === "continue" ? "Continue" : kind === "new" ? "New in your library" : "Made at home";
  return <MediaRows heading={heading} rows={rows} />;
}
