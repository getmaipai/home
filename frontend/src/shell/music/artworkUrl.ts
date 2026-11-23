// One artwork pick for every Audio surface: a shelf thumbnail wins over the item poster, and a blank
// string means no artwork at all. The mini player reads this too, so the same song never shows one
// picture in a shelf and another in the bar.
export function artworkUrlOf(item: { thumbnail?: string | null; poster?: string | null }): string | null {
  return item.thumbnail?.trim() || item.poster?.trim() || null;
}
