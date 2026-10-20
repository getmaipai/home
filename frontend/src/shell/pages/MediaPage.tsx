import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/kit/dashboard/components/ui/tabs";
import { useTabItem } from "@/shell/tabIdentity";
import { useAppCatalog } from "@/shell/useAppCatalog";

const MEDIA_TABS = [
  { label: "Videos", packages: ["videos"], value: "videos" },
  { label: "Shows and Films", packages: ["shows", "films"], value: "shows-films" },
  { label: "Music", packages: ["music"], value: "music" },
  { label: "Podcasts", packages: ["podcasts"], value: "podcasts" },
  { label: "Books", packages: ["books"], value: "books" },
] as const;

/** Combined entry point for the installed media packages; each tab opens its existing package route. */
export function MediaPage() {
  useTabItem("Media");
  const navigate = useNavigate();
  const catalog = useAppCatalog();
  const available = useMemo(() => new Set(catalog.filter((app) => app.to.startsWith("/apps/")).map((app) => app.to.slice("/apps/".length).split("/")[0])), [catalog]);
  const tabs = MEDIA_TABS.flatMap((tab) => {
    const app = tab.packages.find((id) => available.has(id));
    return app ? [{ ...tab, to: `/apps/${app}` }] : [];
  });

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">Media</h1>
      {tabs.length ? (
        <Tabs value={tabs[0]!.value} onValueChange={(value) => { const tab = tabs.find((entry) => entry.value === value); if (tab) navigate(tab.to); }}>
          <TabsList variant="pill" aria-label="Media apps">
            {tabs.map((tab) => <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      ) : <p>No media apps are available for this profile.</p>}
    </main>
  );
}
