import { i18n } from "@lingui/core";
import { formatTime } from "@/lib/format";

/** AWAY-LINK-01: how the robot is connected, in plain words, from the body's check-in. */
export type LinkCheckin = {
  online: boolean;
  lastSeen?: string | null;
  link_path?: "home" | "away" | "other" | null;
  link_state?: string | null;
  link_attempt?: number | null;
};

/** "Connected at home", "Connected away from home (through your laptop)", "Offline since 14:10", or null when nothing is known. */
export function linkLine(checkin: LinkCheckin | null | undefined, lastSeenAt?: string | null): string | null {
  if (!checkin) return null;
  if (!checkin.online) {
    const when = checkin.lastSeen ?? lastSeenAt ?? null;
    return when ? i18n._({ id: "Offline since {time}", message: "Offline since {time}", values: { time: formatTime(when) } }) : i18n._({ id: "Offline", message: "Offline" });
  }
  if (checkin.link_path === "away") return i18n._({ id: "Connected away from home (through your laptop)", message: "Connected away from home (through your laptop)" });
  if (checkin.link_path === "home") return i18n._({ id: "Connected at home", message: "Connected at home" });
  if (checkin.link_path === "other") return i18n._({ id: "Connected over the internet", message: "Connected over the internet" });
  return null;
}

/** What the robot itself says about its link to the hub, only when it is not simply up. */
export function linkStateLine(state: string | null | undefined, attempt?: number | null): string | null {
  switch (state) {
    case "ws_retry":
    case "ws_reconnect":
    case "ws_down":
      return attempt ? i18n._({ id: "The robot is reconnecting to the hub (try {attempt})", message: "The robot is reconnecting to the hub (try {attempt})", values: { attempt } }) : i18n._({ id: "The robot is reconnecting to the hub", message: "The robot is reconnecting to the hub" });
    case "ws_fallback":
      return i18n._({ id: "The robot is trying the laptop relay", message: "The robot is trying the laptop relay" });
    case "ws_home_back":
      return i18n._({ id: "The robot is back on the home network", message: "The robot is back on the home network" });
    case "ws_refused":
      return i18n._({ id: "The hub refused the robot: it needs to be approved or paired again", message: "The hub refused the robot: it needs to be approved or paired again" });
    case "ws_silent":
      return i18n._({ id: "The robot is connected but silent", message: "The robot is connected but silent" });
    default:
      return null;
  }
}
