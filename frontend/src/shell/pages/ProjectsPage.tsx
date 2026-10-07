import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ProjectSettingsDialog, type ProjectSettingsValue } from "@maipai/ui/src/elements/project-settings";
import { EmptyState, EmptyStateGreeting } from "@maipai/ui/src/elements/empty-state";
import { formatRelative } from "@maipai/ui/src/relativeTime";
import { Page } from "@maipai/ui/src/primitives/Page";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@maipai/ui/src/ui/table";
import { ProjectMark } from "@maipai/ui/src/elements/project-mark";
import { getIcon } from "@maipai/ui/src/icons";
import { api, type ChatFolderView, type Roster } from "@/lib/api";
import { useIncognitoContext } from "@/shell/incognitoContext";
import { useTabItem } from "@/shell/tabIdentity";

export const ProjectsIcon = getIcon("folder");
const SearchIcon = getIcon("search");
const PinIcon = getIcon("pin");
const PlusIcon = getIcon("plus");
const EditIcon = getIcon("pencil");

const projectsQueryKey = (personId: string) => ["chat-projects", personId, "all", "updated"] as const;

type DialogState = { kind: "create" } | { kind: "edit"; project: ChatFolderView };
const emptyValue: ProjectSettingsValue = {
  name: "",
  icon: "folder",
  color: "neutral",
  description: "",
  instructions: "",
  memory_mode: "project_only",
};

/** The app's project index. The hub's access field controls every action;
 * the page only renders the kit table, ProjectMark, and settings Element. */
export function ProjectsPage({ person }: { person: Roster }) {
  const { on: incognito } = useIncognitoContext();
  useTabItem("Projects");
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const queryKey = projectsQueryKey(person.id);
  const query = useQuery({
    queryKey,
    queryFn: () => api.chatFolders(undefined, { scope: "all", sort: "updated" }),
    enabled: !incognito,
  });
  const projects = useMemo(() => Array.isArray(query.data) ? query.data : [], [query.data]);
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return projects;
    return projects.filter((project) => `${project.name} ${project.description}`.toLocaleLowerCase().includes(term));
  }, [projects, search]);
  const canCreate = !incognito && person.role !== "child";
  const editingProject = dialog?.kind === "edit" ? dialog.project : null;
  const dialogValue = editingProject ? {
    name: editingProject.name,
    icon: editingProject.icon,
    color: editingProject.color,
    description: editingProject.description,
    instructions: editingProject.instructions,
    memory_mode: editingProject.memory_mode,
  } : emptyValue;

  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const saveSettings = async (patch: Partial<ProjectSettingsValue>) => {
    if (dialog?.kind === "create") {
      try {
        await api.createChatProject({
          name: patch.name ?? emptyValue.name,
          icon: patch.icon ?? emptyValue.icon,
          color: patch.color ?? emptyValue.color,
          description: patch.description ?? emptyValue.description,
          instructions: patch.instructions ?? emptyValue.instructions,
        });
        await refresh();
      } catch (error) {
        toast.error("Could not make that project. Try again.");
        throw error;
      }
      return;
    }
    if (!editingProject) return;
    try {
      await api.updateChatFolder(editingProject.id, patch);
      await refresh();
    } catch (error) {
      toast.error("Could not save that project. Try again.");
      throw error;
    }
  };
  const deleteProject = editingProject?.access === "manage" ? async () => {
    try {
      await api.deleteChatFolder(editingProject.id);
      await refresh();
    } catch (error) {
      toast.error("Could not delete that project. Try again.");
      throw error;
    }
  } : undefined;

  if (incognito) return <Navigate to="/chat" replace />;

  return (
    <Page title="Projects">
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2" />
            <Input
              aria-label="Search projects"
              placeholder="Search projects"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {canCreate ? (
            <Button onClick={() => setDialog({ kind: "create" })}>
              <PlusIcon className="size-4" />
              Create
            </Button>
          ) : null}
        </div>

        {query.isError ? (
          <div role="alert" className="flex items-center justify-between gap-3">
            <p>Could not load projects. Try again.</p>
            <Button variant="outline" onClick={() => void query.refetch()}>Retry</Button>
          </div>
        ) : query.isLoading ? (
          <p role="status">Loading projects…</p>
        ) : filtered.length === 0 ? (
          <EmptyState>
            <EmptyStateGreeting>{projects.length === 0 ? "No projects yet" : "No matching projects"}</EmptyStateGreeting>
            {projects.length === 0 ? <p className="text-muted-foreground text-center">Projects keep related chats together.</p> : null}
            {projects.length === 0 && canCreate ? <Button onClick={() => setDialog({ kind: "create" })}>Create project</Button> : null}
          </EmptyState>
        ) : (
          <div className="min-w-0 flex-1 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead><span className="sr-only">Project actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((project) => {
                const canEdit = project.access === "manage" || project.access === "edit";
                const canPin = project.access === "manage";
                return (
                  <TableRow key={project.id} data-slot="projects-list-row">
                    <TableCell>
                      <Link to={`/chat/projects/${encodeURIComponent(project.id)}`} className="flex min-w-0 items-center gap-3">
                        <ProjectMark icon={project.icon} color={project.color} size="md" />
                        <span className="truncate">{project.name}</span>
                      </Link>
                    </TableCell>
                    <TableCell><span className="text-muted-foreground">{formatRelative(project.last_activity_at)}</span></TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {canPin ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`${project.pinned ? "Unpin" : "Pin"} ${project.name}`}
                            aria-pressed={project.pinned}
                            onClick={async () => {
                              try {
                                await api.updateChatFolder(project.id, { pinned: !project.pinned });
                                await refresh();
                              } catch {
                                toast.error("Could not update that project. Try again.");
                              }
                            }}
                          >
                            <PinIcon className="size-4" />
                          </Button>
                        ) : null}
                        {canEdit ? (
                          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${project.name}`} onClick={() => setDialog({ kind: "edit", project })}>
                            <EditIcon className="size-4" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
        )}
      </div>

      {dialog ? (
        <ProjectSettingsDialog
          open
          onOpenChange={(open) => { if (!open) setDialog(null); }}
          value={dialogValue}
          onSave={saveSettings}
          onDelete={deleteProject}
          memoryModes={[]}
          readOnly={dialog.kind === "edit" && dialog.project.access !== "manage" && dialog.project.access !== "edit"}
          labels={{ instructionsHelp: "These instructions shape answers in this project.", confirmDelete: "Its chats stay." }}
        />
      ) : null}
    </Page>
  );
}
