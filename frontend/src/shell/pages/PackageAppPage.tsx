import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@maipai/ui/src/dashboard/components/ui/tabs";
import { getIcon } from "@maipai/ui/src/icons";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { SchemaPage } from "@maipai/ui/src/schema/SchemaPage";
import { PageNodeSchema } from "@maipai/ui/src/schema/types";
import { ApiError, api, type Roster } from "@/lib/api";
import { NotFoundPage } from "@/shell/pages/NotFoundPage";
import { usePinnedApps } from "@/shell/usePinnedApps";
import { useAppRows } from "@/shell/useAppCatalog";
import { useTabItem } from "@/shell/tabIdentity";

/** APP-KIND-04: one route, `apps/*`, for every installed package app. `/apps/<package>` opens its `index` page and
 * `/apps/<package>/<page>` another of its pages. The page is a spec `page` document the hub serves
 * (`GET /api/plugins/:id/pages/:pageId`), drawn by the kit's SchemaPage inside the package scope: it can read only
 * its own package and navigate only inside its own app. Home holds no per-package code. An unknown, hidden,
 * disabled or uninstalled app or page is the same "not found" page. */
export function PackageAppPage({ person }: { person: Roster }) {
  const splat = useParams()["*"] ?? "";
  const [packageId = "", pageSegment = ""] = splat.split("/").filter(Boolean);
  const pageId = pageSegment || "index";
  const rows = useAppRows();
  const app = rows?.find((row) => row.package === packageId);
  useTabItem(app?.label ?? "Apps");

  const page = useQuery({
    queryKey: ["app-page", packageId, pageId],
    // A document the interpreter cannot parse is an error state with a retry, never a crashed page.
    queryFn: async () => {
      const doc = await api.appPage(packageId, pageId);
      if (!PageNodeSchema.safeParse(doc).success) throw new Error("This app's page is not valid.");
      return doc;
    },
    enabled: packageId !== "",
    retry: false,
  });

  if (packageId === "" || (page.error instanceof ApiError && page.error.status === 404)) return <NotFoundPage />;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="package-app" data-package={packageId}>
      <h1 className="sr-only">{app?.label ?? "App"}</h1>
      {app ? <AppToolbar person={person} to={app.to} label={app.label} settingsArea={app.settings_area?.id} sections={app.sections} current={pageId} /> : null}
      <AsyncState
        data={page.isError ? null : page.data}
        error={page.isError}
        isFetching={page.isFetching}
        onRetry={() => page.refetch()}
        errorMessage="Could not open this app. Check your connection and try again."
        loadingLabel="Opening the app"
      >
        {(doc) => <SchemaPage key={`${packageId}/${pageId}`} page={doc} packageId={packageId} hideTitle />}
      </AsyncState>
    </div>
  );
}

/** The app's own sections as tabs (when it has any) and the pin control. Pins are per person and private. */
function AppToolbar({ person, to, label, settingsArea, sections, current }: { person: Roster; to: string; label: string; settingsArea?: string; sections: Array<{ page: string; label: string }>; current: string }) {
  const navigate = useNavigate();
  const { isPinned, togglePin, isLoading, isSaving } = usePinnedApps(person.id);
  const pinned = isPinned(to);
  const StarIcon = getIcon("star");
  const GearIcon = getIcon("settings");
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {sections.length > 0 ? (
        <Tabs value={current} onValueChange={(value) => navigate(value === "index" ? to : `${to}/${String(value)}`)}>
          <TabsList variant="line" aria-label="Sections">
            <TabsTrigger value="index">Overview</TabsTrigger>
            {sections.map((section) => (
              <TabsTrigger key={section.page} value={section.page}>{section.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : <span />}
      <div className="flex items-center gap-1">
      {settingsArea ? (
        <Button variant="ghost" size="sm" render={<Link to={`/settings/${settingsArea}`} aria-label={`${label} settings`} />}>
          <GearIcon aria-hidden="true" />
          Settings
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        disabled={isLoading || isSaving}
        aria-pressed={pinned}
        onClick={() => togglePin(to)}
      >
        <StarIcon aria-hidden="true" fill={pinned ? "currentColor" : "none"} />
        {pinned ? "Remove from favorites" : "Add to favorites"}
      </Button>
      </div>
    </div>
  );
}
