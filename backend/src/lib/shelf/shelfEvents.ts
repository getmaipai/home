// Closed event registry: no activity text, address, title, person or record identifier can be supplied.
const EVENTS = {
  purpose_conflict: "A News feed address is already used by Podcasts. Remove it from the News shelf box or use a different address.",
  sync_failed: "News feed settings could not be synced. Check the News shelf settings and try again; due podcasts will still be checked.",
  topics_failed: "News stories could not be sorted into topics this time. They keep their feed's own topic, and the next check will try again.",
  podcast_keep_failed: "Podcast keep rules could not finish. Check storage and the internet connection; the next check will try again.",
} as const;
export function reportShelfEvent(event: keyof typeof EVENTS): void {
  console.warn(JSON.stringify({ component: "shelf", event, message: EVENTS[event] }));
}
