import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { PageHeaderTitle } from "@/shell/pageHeaderTitle";
import { useLocation, useNavigate } from "react-router-dom";
import { SectionSidebar, type SectionSidebarItem } from "@maipai/ui/src/primitives/SectionSidebar";
import { useAppRows } from "@/shell/useAppCatalog";
import { mediaNav } from "@/shell/mediaNav";
import { enterMediaHub } from "@/shell/mediaHubSession";
import { useHeaderExtra } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/HeaderExtraContext";


/** MEDIA-HUB-05: the media hub's left column, beside the page content: the media apps the person may open as the kit's one section
 * sidebar. The app rows come from the same shared catalog the app pages read (`useAppRows` via `mediaNav`), in the hub's own order. */
export function MediaHubFrame({ packageId, children }: { packageId: string; children: ReactNode }) {
  useHeaderExtra(PageHeaderTitle);
  const rows = useAppRows();
  const navigate = useNavigate();
  const location = useLocation();
  const urlQuery = new URLSearchParams(location.search).get("q") ?? "";
  const [draft, setDraft] = useState(urlQuery);
  useEffect(() => setDraft(urlQuery), [urlQuery]);
  const open = (to: string) => (event: MouseEvent) => {
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      enterMediaHub();
      navigate(to);
    }
  };
  const items: SectionSidebarItem[] = [
    { id: "home", label: "Home", icon: "home", href: "/media", active: packageId === "home", onClick: open("/media") },
    ...mediaNav(rows).map((app) => ({
      id: app.id,
      label: app.label,
      icon: app.icon,
      href: app.to,
      active: app.id === packageId,
      onClick: open(app.to),
    })),
  ];
  const submitSearch = () => {
    const q = draft.trim();
    if (!q) return;
    enterMediaHub();
    navigate(`/media/search?q=${encodeURIComponent(q)}`);
  };
  return (
    <div className="flex min-h-0 flex-1" data-workspace-fill="" data-slot="media-hub-frame" data-testid="media-hub-frame">
      <SectionSidebar standalone density="compact" search={{ value: draft, onChange: setDraft, label: "Search Media", onSubmit: submitSearch }} groups={[{ id: "media-apps", items }]} />
      {children}
    </div>
  );
}
