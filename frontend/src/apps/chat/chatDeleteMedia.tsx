import { i18n } from "@lingui/core";
// Deleting a chat that made pictures or videos asks whether they go too. The thread-list adapter is not a React tree, so it
// awaits askDeleteMedia(), and the one dialog in ChatPage answers it.
import { useEffect, useState } from "react";

export type DeleteMediaChoice = "keep" | "delete" | "cancel";
export interface MediaCount { images: number; videos: number }
type Ask = { count: MediaCount; resolve: (choice: DeleteMediaChoice) => void };
let show: ((ask: Ask) => void) | null = null;

/** Resolves "keep" at once when no dialog is mounted, so a delete never hangs. */
export function askDeleteMedia(count: MediaCount): Promise<DeleteMediaChoice> {
  return new Promise((resolve) => { if (show) show({ count, resolve }); else resolve("keep"); });
}

export function describeMedia({ images, videos }: MediaCount): string {
  const pictures = images ? i18n._({ id: "{count, plural, one {# picture} other {# pictures}}", message: "{count, plural, one {# picture} other {# pictures}}", values: { count: images } }) : "";
  const clips = videos ? i18n._({ id: "{count, plural, one {# video} other {# videos}}", message: "{count, plural, one {# video} other {# videos}}", values: { count: videos } }) : "";
  return pictures && clips ? i18n._({ id: "{pictures} and {videos}", message: "{pictures} and {videos}", values: { pictures, videos: clips } }) : pictures || clips;
}

export function useDeleteMediaAsk() {
  const [ask, setAsk] = useState<Ask | null>(null);
  useEffect(() => { show = setAsk; return () => { show = null; }; }, []);
  const answer = (choice: DeleteMediaChoice) => { ask?.resolve(choice); setAsk(null); };
  return { ask, answer };
}
