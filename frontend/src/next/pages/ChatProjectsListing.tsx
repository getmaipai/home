import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MoreHorizontalIcon, PencilIcon, PinIcon, PinOffIcon, PlusIcon, SearchIcon } from "lucide-react";
import { Button } from "@maipai/ui/src/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@maipai/ui/src/ui/dropdown-menu";
import { RelativeTime } from "@maipai/ui/src/ui/relative-time";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@maipai/ui/src/ui/table";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@maipai/ui/src/dashboard/components/ui/input-group";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@maipai/ui/src/dashboard/components/ui/empty";
import { ProjectMark } from "@maipai/ui/src/elements/project-mark";
import { api, type ChatFolderView, type Roster } from "@/lib/api";
import { chatFoldersQueryKey } from "@/apps/chat/chatProjects";
import { openProjectSettings } from "@/apps/chat/chatProjectSettingsStore";

// PROJECTS-UI-03 (CHAT-PROJECT-01): ChatGPT's Projects listing inside the chat
// area (the rail and the history column stay, S1 and S2): a title, a search
// box and Create, then a table of Name (icon and name) and Updated with a
// menu, Pin and Edit per row, pinned projects first. A child sees the list
// and opens projects; a parent makes and edits them. Kit parts only.

export const projectsListingQueryKey = (personId: string, q: string, archived: boolean) => [...chatFoldersQueryKey(personId), "listing", q, archived] as const;

export function ChatProjectsListing({ person }: { person: Roster }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const canManage = person.role !== "child";
  const query = search.trim();
  const projects = useQuery({
    queryKey: projectsListingQueryKey(person.id, query, archived),
    queryFn: () => api.chatFolders(undefined, { q: query || undefined, archived, scope: "all", sort: "updated" }),
  });
  const change = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { pinned?: boolean; archived?: boolean } }) => api.updateChatFolder(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatFoldersQueryKey(person.id) }),
    onError: () => toast.error("Could not change that project. Try again."),
  });
  const rows = projects.data ?? [];
  const open = (folder: ChatFolderView) => navigate(`/chat/projects/${encodeURIComponent(folder.id)}`);
  // Pin, edit and archive are the owner's (or a parent's, for a child's).
  const manages = (folder: ChatFolderView) => canManage && folder.access === "manage";

  return (
    <div data-slot="chat-projects-listing" className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{archived ? "Archived projects" : "Projects"}</h1>
        <div className="flex items-center gap-2">
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon aria-hidden className="size-4" />
            </InputGroupAddon>
            <InputGroupInput type="search" aria-label="Search projects" placeholder="Search projects" value={search} onChange={(event) => setSearch(event.target.value)} />
          </InputGroup>
          <Button variant="ghost" onClick={() => setArchived((value) => !value)}>
            {archived ? "Back to projects" : "Archived"}
          </Button>
          {canManage && !archived ? (
            <Button onClick={() => openProjectSettings({ kind: "new" })}>
              <PlusIcon aria-hidden className="size-4" />
              Create
            </Button>
          ) : null}
        </div>
      </div>
      {projects.isError ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Could not load your projects</EmptyTitle>
            <EmptyDescription>Reload the page to try again.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : projects.isSuccess && rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{query ? "No projects match" : archived ? "No archived projects" : "No projects yet"}</EmptyTitle>
            <EmptyDescription>{query ? "Try a different word." : archived ? "Projects you archive wait here." : canManage ? "Make one to keep related chats together." : "A parent can make one for you."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table aria-label="Projects">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((folder) => (
              <TableRow key={folder.id} data-slot="chat-projects-row">
                <TableCell>
                  <button type="button" className="flex min-w-0 items-center gap-3 text-start" onClick={() => open(folder)}>
                    <ProjectMark icon={folder.icon} color={folder.color} size="md" />
                    <span className="truncate">{folder.name}</span>
                  </button>
                </TableCell>
                <TableCell>
                  <RelativeTime at={folder.last_activity_at} />
                </TableCell>
                <TableCell>
                  {manages(folder) ? (
                    <div className="flex items-center justify-end gap-1">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Options for ${folder.name}`}>
                            <MoreHorizontalIcon aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => openProjectSettings({ kind: "edit", id: folder.id })}>Edit project</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => change.mutate({ id: folder.id, patch: { archived: !archived } })}>{archived ? "Unarchive" : "Archive"}</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={folder.pinned ? `Unpin ${folder.name}` : `Pin ${folder.name}`}
                        aria-pressed={Boolean(folder.pinned)}
                        onClick={() => change.mutate({ id: folder.id, patch: { pinned: !folder.pinned } })}
                      >
                        {folder.pinned ? <PinOffIcon aria-hidden /> : <PinIcon aria-hidden />}
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${folder.name}`} onClick={() => openProjectSettings({ kind: "edit", id: folder.id })}>
                        <PencilIcon aria-hidden />
                      </Button>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
