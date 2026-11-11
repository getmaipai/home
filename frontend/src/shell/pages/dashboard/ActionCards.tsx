import { i18n } from "@lingui/core";
import { CardGrid } from "@maipai/ui/src/primitives/CardGrid";
import { Card } from "@maipai/ui/src/primitives/Card";
import { IconTile } from "@maipai/ui/src/primitives/IconTile";
import { useAppCatalog } from "@/shell/useAppCatalog";
import { useSurface } from "@maipai/ui/src/useSurface";
import { Link } from "react-router-dom";
import { getIcon } from "@maipai/ui/src/icons";

export interface HomeAction {
  id: string;
  label: string;
  icon: string;
  hue: string;
  to?: string;
  focus?: boolean;
}

export const HOME_ACTIONS: HomeAction[] = [
  { id: "ask", label: i18n._({ id: "Ask or plan something", message: "Ask or plan something" }), icon: "message-circle", hue: "--primary", focus: true },
  { id: "picture", label: i18n._({ id: "Make a picture", message: "Make a picture" }), icon: "image", hue: "--primary", to: "/chat" },
  { id: "video", label: i18n._({ id: "Make a video", message: "Make a video" }), icon: "clapperboard", hue: "--primary", to: "/apps/videos/create" },
  { id: "song", label: i18n._({ id: "Make a song", message: "Make a song" }), icon: "music", hue: "--primary", to: "/apps/music/create" },
  { id: "edit-picture", label: i18n._({ id: "Edit a picture", message: "Edit a picture" }), icon: "pencil", hue: "--primary", to: "/apps/pictures/edit" },
  { id: "media", label: i18n._({ id: "Find something to watch or play", message: "Find something to watch or play" }), icon: "cast", hue: "--primary", to: "/media" },
];

/** The Home action grid is a CardGrid of links using the kit's shared IconTile. */
export function ActionCards({ onFocusAsk }: { onFocusAsk: () => void }) {
  const catalog = useAppCatalog();
  const { far } = useSurface();
  const visible = HOME_ACTIONS.filter((action) => !action.to || action.to === "/media" || action.to === "/chat" || catalog.some((app) => app.to === action.to || app.to === `/apps/${action.id === "video" ? "videos" : action.id === "song" ? "music" : ""}` || (action.id === "edit-picture" && app.to === "/apps/pictures")));
  const cards = visible.map((action) => ({ action, key: action.id }));
  const AskIcon = getIcon("message-circle");

  return <CardGrid items={cards} getKey={(card) => card.key} label={i18n._({ id: "Things to do", message: "Things to do" })} density={far ? "compact" : "default"} renderItem={({ action }) => {
    const content = <div className="flex min-w-0 items-center gap-3 p-4">{action.focus ? <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted"><AskIcon aria-hidden="true" /></span> : <IconTile icon={action.icon as "image"} hue={action.hue} glow={false} />}<span className="text-body">{action.label}</span></div>;
    return <Card className="h-full" far={far}>{action.focus
      ? <button type="button" className="w-full text-left" aria-label={action.label} onClick={onFocusAsk}>{content}</button>
      : <Link to={action.to ?? "/"} className="block h-full no-underline">{content}</Link>}</Card>;
  }} />;
}
