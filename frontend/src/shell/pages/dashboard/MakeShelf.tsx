import { i18n } from "@lingui/core";
import { useNavigate } from "react-router-dom";
import { MediaShelf } from "@maipai/ui/src/primitives/MediaShelf";
import { SafeImage } from "@maipai/ui/src/primitives/SafeImage";
import { useAppCatalog } from "@/shell/useAppCatalog";
import type { Roster } from "@/lib/api";

type MakeItem = { id: string; title: string; art: string; image: string; href: string };
export const MAKE_TILES: MakeItem[] = [
  { id: "ask", image: "/make-art/ask.svg", title: i18n._({ id: "Ask or plan", message: "Ask or plan" }), art: "picture", href: "/chat?ask=Help%20me%20plan%20something" },
  { id: "picture", image: "/make-art/picture.svg", title: i18n._({ id: "Make a picture", message: "Make a picture" }), art: "picture", href: "/chat?ask=Make%20a%20picture" },
  { id: "video", image: "/make-art/video.svg", title: i18n._({ id: "Make a video", message: "Make a video" }), art: "video", href: "/apps/video/create?prompt=Make%20a%20short%20video" },
  { id: "song", image: "/make-art/song.svg", title: i18n._({ id: "Make a song", message: "Make a song" }), art: "music", href: "/apps/audio/create?prompt=Make%20a%20song" },
  { id: "watch", image: "/make-art/watch.svg", title: i18n._({ id: "Find a show", message: "Find a show" }), art: "video", href: "/media" },
  { id: "news", image: "/make-art/news.svg", title: i18n._({ id: "Read the news", message: "Read the news" }), art: "file", href: "/apps/news" },
];

export function visibleMakeTiles(role: Roster["role"], catalog: readonly { to: string }[]) {
  const child = role === "child";
  return MAKE_TILES.filter((tile) => {
    if (child && ["picture", "video", "song", "news"].includes(tile.id)) return false;
    if (tile.id === "video") return catalog.some((app) => app.to === "/apps/video");
    if (tile.id === "song") return catalog.some((app) => app.to === "/apps/audio");
    if (tile.id === "news") return catalog.some((app) => app.to === "/apps/news");
    return true;
  });
}

export function MakeShelf({ role }: { role: Roster["role"] }) {
  const navigate = useNavigate();
  const catalog = useAppCatalog();
  const items = visibleMakeTiles(role, catalog);
  return <MediaShelf heading={i18n._({ id: "Make", message: "Make" })} items={items} getKey={(item) => item.id} getLabel={(item) => item.title} renderItem={(item) => <SafeImage src={item.image} alt="" kind={item.art as "picture"} className="size-full object-cover" />} aspect="poster" variant="plain" headingStyle="section" tileSize="pro" bleed onSelect={(item) => navigate(item.href)} />;
}
