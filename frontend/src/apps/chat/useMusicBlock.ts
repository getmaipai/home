// AUDIT-DUP-FE-01: a music card has two hooks that are always used as a pair (the band's pictures and buttons: useBandCard; the album, style and
// band-edit side: useMusicCard). This is the one join: the live props, the one button handler and whether the record is gone.
import { useBandCard } from "@/apps/chat/useBandCard";
import { joinBandAndStudio, useMusicCard } from "@/apps/chat/useMusicCard";

export type MusicBlock = { kind: string; provenance?: string; props: unknown };
export type MusicBlockAction = (blockId: string, action: string, detail?: Record<string, unknown>) => void;

/** For a band, album or song style block: its live props (null for any other block), the joined button handler and whether the record is gone. */
export function useMusicBlock(block: MusicBlock): { props: Record<string, unknown> | null; onAction: MusicBlockAction | null; gone: boolean } {
  const band = useBandCard(block);
  const studio = useMusicCard(block);
  return { props: studio.props ?? band.props, onAction: joinBandAndStudio(band.onAction, studio.onAction), gone: band.gone || studio.gone };
}
