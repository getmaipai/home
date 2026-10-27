import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { MediaShelf } from "@maipai/ui/src/primitives/MediaShelf";
import { SafeImage, type ImageFallbackKind } from "@maipai/ui/src/primitives/SafeImage";
import { api, type MediaSearch, type MediaSearchRow } from "@/lib/api";
import { MediaHubFrame } from "@/shell/MediaHubFrame";
import { useTabItem } from "@/shell/tabIdentity";

const FALLBACK_KIND: Record<MediaSearchRow["app"], ImageFallbackKind> = {
  videos: "video", shows: "video", music: "music", podcasts: "music", books: "file",
};

export function MediaSearchPage() {
  useTabItem("Media");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const page = useQuery({ queryKey: ["media-search", q], queryFn: () => api.mediaSearch(q), retry: false, enabled: q.trim().length > 0 });

  return (
    <MediaHubFrame packageId="search">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 p-4 lg:ps-6" data-testid="media-search">
        {q.trim().length === 0 ? <EmptyState icon="search" text="Search for a title across your media apps." /> : (
          <AsyncState data={page.isError ? null : page.data} error={page.isError} isFetching={page.isFetching} onRetry={() => page.refetch()}
            errorMessage="Could not search Media. Check your connection and try again." loadingLabel="Searching Media">
            {(data: MediaSearch) => data.groups.length === 0
              ? <EmptyState icon="search" text={`No matches for "${q}". Try another word.`} />
              : data.groups.map((group) => (
                <MediaShelf key={group.app} heading={group.heading} items={group.rows} getKey={(row) => row.id} getLabel={(row) => row.title}
                  renderItem={(row) => <SafeImage src={row.artwork_url} alt="" kind={FALLBACK_KIND[row.app]} />}
                  renderCaption={(row) => <><p>{row.title}</p>{row.subtitle ? <p>{row.subtitle}</p> : null}</>}
                  aspect="square" variant="plain" onSelect={(row) => navigate(row.href)} />
              ))}
          </AsyncState>
        )}
      </div>
    </MediaHubFrame>
  );
}
