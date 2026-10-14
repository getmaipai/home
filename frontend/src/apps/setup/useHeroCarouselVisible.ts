import { useMemo } from "react";

export function useHeroCarouselVisible({
  surface,
  starterReady,
  fullModelDownloading,
}: {
  surface: "hello" | "full-model-download" | "other";
  starterReady: boolean;
  fullModelDownloading: boolean;
}): boolean {
  return useMemo(
    () => (surface === "hello" && !starterReady) || (surface === "full-model-download" && fullModelDownloading),
    [surface, starterReady, fullModelDownloading],
  );
}
