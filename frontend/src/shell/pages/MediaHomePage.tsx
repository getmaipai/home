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
  useTabItem("Media");
  const navigate = useNavigate();
  const page = useQuery({ queryKey: ["media-home"], queryFn: api.mediaHome, retry: false });

  return (
    <MediaHubFrame packageId="home">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 p-4 lg:ps-6" data-testid="media-home">
        <h1 className="min-w-0 truncate text-2xl font-bold tracking-tight sm:text-3xl">Media</h1>
        <AsyncState
          data={page.isError ? null : page.data}
          error={page.isError}
          isFetching={page.isFetching}
          onRetry={() => page.refetch()}
          errorMessage="Could not load Media. Check your connection and try again."
          loadingLabel="Loading Media"
        >
          {(data: MediaHome) => {
            const shelves = [
              {
                heading: "Pick up where you left off",
                items: data.continue,
                aspect: "wide" as const,
                getProgress: (row: MediaHomeRow) => (row.percent === null ? undefined : row.percent / 100),
              },
              { heading: "New in your media", items: data.new, aspect: "square" as const, getProgress: undefined },
              { heading: "Recently played", items: data.recent_music, aspect: "square" as const, getProgress: undefined },
            ].filter((shelf) => shelf.items.length > 0);
            if (shelves.length === 0) {
              return <EmptyState icon="film" text="Nothing here yet. Add music, videos, shows, podcasts or books to your library and they show up here." />;
            }
            return shelves.map((shelf) => (
              <MediaShelf
                key={shelf.heading}
                heading={shelf.heading}
                items={shelf.items}
                getKey={(row) => row.id}
                getLabel={(row) => row.title}
                renderItem={(row) => <SafeImage src={row.artwork_url} alt="" kind={FALLBACK_KIND[row.app]} />}
                renderCaption={(row) => (
                  <>
                    <p>{row.title}</p>
                    {row.subtitle ? <p>{row.subtitle}</p> : null}
                  </>
                )}
                aspect={shelf.aspect}
                getProgress={shelf.getProgress}
                variant="plain"
                onSelect={(row) => navigate(row.href)}
              />
            ));
          }}
        </AsyncState>
      </div>
    </MediaHubFrame>
  );
}
