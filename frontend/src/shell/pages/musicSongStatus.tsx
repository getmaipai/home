// The song status row (ACTIVITY-PAGE-01) and the line under a song: one definition for the Create home, the gallery and the song list.
import { i18n } from "@lingui/core";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { getIcon } from "@maipai/ui/src/icons";
import { musicApi, type MusicCard } from "@/lib/musicApi";

const active = (card: MusicCard): boolean => card.state === "queued" || card.state === "running";

/** What a tile says under the title: how far along it is, or its sound. */
export function songLine(card: MusicCard): string {
  if (active(card)) return card.position ? i18n._({ id: "Waiting, number {position} in line", message: "Waiting, number {position} in line", values: { position: card.position } }) : `${card.stage_label || i18n._({ id: "Making your song", message: "Making your song" })}${card.progress > 0 ? ` ${Math.round(card.progress * 100)}%` : ""}`;
  if (card.state === "failed") return card.error_line ?? i18n._({ id: "This song could not be made. Open it to try again.", message: "This song could not be made. Open it to try again." });
  if (card.state === "cancelled") return i18n._({ id: "Stopped", message: "Stopped" });
  return card.description ?? "";
}

/** ACTIVITY-PAGE-01 (PRO-LOOK-01 sections 20 and 21): a song being made, waiting or not finished is the kit status card, fed by the same job record
 * as the tile it replaces: WAITING with its place in line, MAKING NOW with the ring and what it is doing (or how long it usually takes), COULD NOT
 * FINISH with the reason and Try again. The record has no preview, so the ring card is the form. */
export function songStatusCard({ card, onOpen }: { card: MusicCard; onOpen: () => void }) {
  const stopped = card.state === "cancelled";
  const failed = card.state === "failed" || stopped;
  const waiting = card.state === "queued";
  const askedAt = Number(card.started_at);
  // A song that has sat at 0% for three minutes is offered a Stop, so a stuck one never needs anyone to dig.
  const stalled = !failed && card.progress === 0 && Number.isFinite(askedAt) && Date.now() - (askedAt < 1e12 ? askedAt * 1000 : askedAt) > 180_000;
  const percent = Math.round(card.progress * 100);
  const minutes = card.eta_seconds ? Math.max(1, Math.round(card.eta_seconds / 60)) : null;
  const usually = minutes
    ? i18n._({ id: "About {minutes, plural, one {# minute} other {# minutes}} left.", message: "About {minutes, plural, one {# minute} other {# minutes}} left.", values: { minutes } })
    : i18n._({ id: "Usually about 2 minutes.", message: "Usually about 2 minutes." });
  const line = stopped ? i18n._({ id: "Stopped. Try again to make it.", message: "Stopped. Try again to make it." }) : failed ? songLine(card) : stalled ? i18n._({ id: "Still waiting to start. You can stop it and try again.", message: "Still waiting to start. You can stop it and try again." }) : waiting ? songLine(card) : [card.stage_label || i18n._({ id: "Making your song", message: "Making your song" }), percent > 0 ? "" : usually].filter(Boolean).join(" ");
  const Icon = getIcon(failed ? "alert-triangle" : waiting ? "clock" : "loader");
  return <li key={card.id} className="w-full"><StatusCard
    kind={failed ? "problem" : waiting ? "waiting" : "progress"}
    stateWord={stopped ? i18n._({ id: "Stopped", message: "Stopped" }) : failed ? i18n._({ id: "Could not finish", message: "Could not finish" }) : waiting ? i18n._({ id: "Waiting", message: "Waiting" }) : i18n._({ id: "Making now", message: "Making now" })}
    title={card.title ?? i18n._({ id: "Making your song", message: "Making your song" })}
    line={line}
    icon={<Icon aria-hidden className="size-5" />}
    progress={!failed && !waiting && percent > 0 ? percent : undefined}
    accent="create"
    {...(stalled ? { secondary: { label: i18n._({ id: "Stop", message: "Stop" }), onSelect: () => { void musicApi.stop(card.id).catch(() => {}); } } } : {})}
    action={{ label: failed ? i18n._({ id: "Try again", message: "Try again" }) : i18n._({ id: "Open", message: "Open" }), onSelect: onOpen, tone: failed ? "primary" : "quiet" }}
  /></li>;
}
