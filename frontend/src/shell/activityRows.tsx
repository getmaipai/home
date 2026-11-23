import { i18n } from "@lingui/core";
import { getIcon, iconNames } from "@maipai/ui/src/icons";
import { type StatusCardKind } from "@maipai/ui/src/elements/status-card";
import { type ActivityItemView } from "@/lib/api";
import { type FeedItem } from "@/shell/activityFeed";

/** Only a finished card can be cleared; a waiting or making one is still running. A notice is always clearable. */
export const isFinished = (item: FeedItem): boolean => item.source === "notice" || item.state === "done" || item.state === "failed" || item.state === "attention";

export const ACTIVITY_CARD_KIND: Record<ActivityItemView["state"], StatusCardKind> = { waiting: "waiting", making: "progress", done: "done", attention: "attention", failed: "problem" };

export const stateWord = (state: ActivityItemView["state"]): string => ({
  waiting: i18n._({ id: "Waiting", message: "Waiting" }),
  making: i18n._({ id: "Making now", message: "Making now" }),
  done: i18n._({ id: "Done", message: "Done" }),
  attention: i18n._({ id: "Needs a look", message: "Needs a look" }),
  failed: i18n._({ id: "Could not finish", message: "Could not finish" }),
})[state];

export const actionLabel = (item: FeedItem): string => {
  if (item.source === "notice") return i18n._({ id: "Open", message: "Open" });
  return ({
    waiting: i18n._({ id: "Open", message: "Open" }),
    making: i18n._({ id: "Open", message: "Open" }),
    done: i18n._({ id: "Open", message: "Open" }),
    attention: i18n._({ id: "Review", message: "Review" }),
    failed: i18n._({ id: "Try again", message: "Try again" }),
  })[item.state];
};

export const sourceName = (source: FeedItem["source"]): string => ({
  picture: i18n._({ id: "Pictures", message: "Pictures" }),
  video: i18n._({ id: "Videos", message: "Videos" }),
  song: i18n._({ id: "Music", message: "Music" }),
  job: i18n._({ id: "Home", message: "Home" }),
  notice: i18n._({ id: "Home", message: "Home" }),
})[source];

/** The one muted line: the hub's own words, then how long it usually takes while a figure is not known yet; a finished job names where it was made, a notice says nothing more. */
export function lineOf(item: FeedItem): string {
  const usually = item.state === "making" && item.percent === null && item.typicalMinutes
    ? i18n._({ id: "Usually about {minutes, plural, one {# minute} other {# minutes}}.", message: "Usually about {minutes, plural, one {# minute} other {# minutes}}.", values: { minutes: item.typicalMinutes } })
    : "";
  if (item.source === "notice") return item.line ?? "";
  if (item.state === "done" && !item.line) return i18n._({ id: "Made in {app}.", message: "Made in {app}.", values: { app: sourceName(item.source) } });
  return [item.line, usually].filter(Boolean).join(" ");
}

export const leadIcon = (state: ActivityItemView["state"]) => {
  const Icon = getIcon(state === "done" ? "check" : state === "failed" || state === "attention" ? "alert-triangle" : state === "waiting" ? "clock" : "loader");
  return <Icon aria-hidden className="size-5" />;
};

// ACTIVITY-MERGE-01: what a row is about shows as its lead icon, so a picture, a video, a song and a message read apart at a glance.
// A name the kit does not ship falls back to the state icon.
const SOURCE_ICON: Record<FeedItem["source"], string | null> = { picture: "image", video: "video", song: "music", notice: "bell", job: null };

export const feedIcon = (item: FeedItem) => {
  const name = SOURCE_ICON[item.source];
  const Icon = name && (iconNames as readonly string[]).includes(name) ? getIcon(name) : null;
  return Icon ? <Icon aria-hidden className="size-5" /> : leadIcon(item.state);
};
