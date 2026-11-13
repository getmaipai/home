import { i18n } from "@lingui/core";
import { useNavigate } from "react-router-dom";
import { Billboard } from "@maipai/ui/src/primitives/Billboard";
import { api, type MediaHomeRow } from "@/lib/api";

export type HomeHeroChoice =
  | { kind: "made"; id: string; title: string; art?: string; mediaKind: "picture" | "video" | "music"; href: string }
  | { kind: "companion"; title: string; art?: string; href?: string }
  | null;

export function chooseHomeHero(made: MediaHomeRow[] | undefined, companion: { id?: string; name: string; portrait?: string | null } | null | undefined, child = false): HomeHeroChoice {
  if (!child && made?.[0]) {
    const row = made[0];
    return { kind: "made", id: row.id, title: row.title, art: row.artwork_url ?? undefined, mediaKind: row.app === "audio" || row.app === "podcasts" ? "music" : row.app === "videos" || row.app === "shows" ? "video" : "picture", href: row.href };
  }
  return companion ? { kind: "companion", title: companion.name, art: companion.portrait ? api.companionPortrait(companion.portrait) : undefined, href: companion.id ? `/companions/${encodeURIComponent(companion.id)}` : undefined } : null;
}

export function HomeHero({ choice }: { choice: HomeHeroChoice }) {
  const navigate = useNavigate();
  if (!choice) return null;
  return <Billboard label={choice.kind === "made" ? i18n._({ id: "Made at home", message: "Made at home" }) : i18n._({ id: "Your companion", message: "Your companion" })} size="banner" autoplay={false} slides={[{ id: choice.kind === "made" ? choice.id : "companion", art: choice.art, kind: choice.kind === "made" ? choice.mediaKind : "person", eyebrow: choice.kind === "made" ? i18n._({ id: "Made at home", message: "Made at home" }) : i18n._({ id: "Your companion", message: "Your companion" }), title: choice.title, primary: { label: i18n._({ id: "Open", message: "Open" }), icon: "arrow-up-right", onSelect: () => { if (choice.kind === "made") navigate(choice.href); else if (choice.href) navigate(choice.href); } } }]} />;
}
