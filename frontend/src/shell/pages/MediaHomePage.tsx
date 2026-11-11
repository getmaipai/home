import { i18n } from "@lingui/core";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { MediaShelf } from "@maipai/ui/src/primitives/MediaShelf";
import { SafeImage, type ImageFallbackKind } from "@maipai/ui/src/primitives/SafeImage";
import { api, type MediaHome, type MediaHomeRow } from "@/lib/api";
import { MediaHubFrame } from "@/shell/MediaHubFrame";
import { useTabItem } from "@/shell/tabIdentity";

/** The fallback tile a row without artwork gets, by the app that owns it. */
const FALLBACK_KIND: Record<MediaHomeRow["app"], ImageFallbackKind> = {
  videos: "video",
  shows: "video",
  music: "music",
  podcasts: "music",
  books: "file",
};

/** Task 11 of the media hub: the Media home page. The person's shelves from `GET /api/media/home`, drawn in the hub's
 * own column beside its section sidebar; each tile opens its app's play page. */
export function MediaHomePage() {
  useTabItem(i18n._({ id: "Media", message: "Media" }));
  const navigate = useNavigate();
  const page = useQuery({ queryKey: ["media-home"], queryFn: api.mediaHome, retry: false });

  return (
    <MediaHubFrame packageId="home">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 p-4 lg:ps-6" data-testid="media-home">
        <AsyncState
          data={page.isError ? null : page.data}
          error={page.isError}
          isFetching={page.isFetching}
          onRetry={() => page.refetch()}
          errorMessage={i18n._({ id: "Could not load Media. Check your connection and try again.", message: "Could not load Media. Check your connection and try again." })}
          loadingLabel={i18n._({ id: "Loading Media", message: "Loading Media" })}
        >
          {(data: MediaHome) => {
            const shelves = [
              { heading: i18n._({ id: "Made at home", message: "Made at home" }), items: data.made_at_home, aspect: "square" as const, getProgress: undefined },
              {
                heading: i18n._({ id: "Pick up where you left off", message: "Pick up where you left off" }),
                items: data.continue,
                aspect: "square" as const,
                getProgress: (row: MediaHomeRow) => (row.percent === null ? undefined : row.percent / 100),
              },
              { heading: i18n._({ id: "New in your media", message: "New in your media" }), items: data.new, aspect: "square" as const, getProgress: undefined },
              { heading: i18n._({ id: "Recently played", message: "Recently played" }), items: data.recent_music, aspect: "square" as const, getProgress: undefined },
            ].filter((shelf) => shelf.items.length > 0);
            if (shelves.length === 0 && data.made_at_home.length === 0) {
              return <EmptyState icon="film" text={i18n._({ id: "Nothing here yet. Add music, videos, shows, podcasts or books to your library and they show up here.", message: "Nothing here yet. Add music, videos, shows, podcasts or books to your library and they show up here." })} />;
            }
            return shelves.map((shelf) => (
              <MediaShelf
                key={shelf.heading}
                heading={shelf.heading}
                items={shelf.items}
                getKey={(row) => row.id}
                getLabel={(row) => row.title}
                renderItem={(row) => <SafeImage src={row.artwork_url} alt="" kind={FALLBACK_KIND[row.app]} tintSeed={row.title} label={row.title} />}
                renderCaption={(row) => row.subtitle ? <span className="truncate text-supporting text-muted-foreground">{row.subtitle}</span> : null}
                aspect={shelf.aspect}
                getProgress={shelf.getProgress}
                variant="plain"
                headingStyle="section"
                tileSize="pro"
                bleed
                onSelect={(row) => navigate(row.href)}
              />
            ));
          }}
        </AsyncState>
      </div>
    </MediaHubFrame>
  );
}
