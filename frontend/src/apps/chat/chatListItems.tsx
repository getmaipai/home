import { useMemo, useState, type FC } from "react";
import { ThreadListItemPrimitive, ThreadListPrimitive, useAuiState } from "@assistant-ui/react";
import { getIcon } from "@maipai/ui/src/icons";
import { Button } from "@maipai/ui/src/elements/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/elements/ui/collapsible";
import { Skeleton } from "@maipai/ui/src/elements/ui/skeleton";
import { ThreadListItem } from "@maipai/ui/src/elements/thread-list.aui";
import { groupChatList } from "@/apps/chat/chatListGroups";

const ChevronRightIcon = getIcon("chevron-right");
const RestoreIcon = getIcon("rotate-ccw");
const TrashIcon = getIcon("trash");

/** The chat list body, in place of the kit's `ThreadListItems`. The kit's version fixes three things
 * Home needs different: its date groups end at "Earlier" (no "Previous 7 days"), it has no archived
 * view or Restore, and it filters on the title alone. Everything else is the kit's own: the item row,
 * its Rename / Archive / Delete menu, the search box and the New chat button stay as shipped, and
 * `ThreadListItem` is rendered here unchanged. */
export const ChatListItems: FC<{
  search?: string;
  /** Remote ids of chats the hub matched on what was said in them (the message-text index). */
  contentMatchIds?: ReadonlySet<string> | null;
}> = ({ search = "", contentMatchIds = null }) => {
  const isLoading = useAuiState((s) => s.threads.isLoading);
  const threadIds = useAuiState((s) => s.threads.threadIds);
  const archivedThreadIds = useAuiState((s) => s.threads.archivedThreadIds);
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const query = search.trim();

  const view = useMemo(() => {
    const byId = new Map(threadItems.map((item) => [item.id, item]));
    const needle = query.toLowerCase();
    const matches = (id: string) => {
      const item = byId.get(id);
      if (!needle) return true;
      return (item?.title || "New Chat").toLowerCase().includes(needle) || (item?.remoteId !== undefined && !!contentMatchIds?.has(item.remoteId));
    };
    const regular = threadIds.map((id, index) => ({ index, id, lastMessageAt: byId.get(id)?.lastMessageAt, pinned: byId.get(id)?.custom?.pinned === true })).filter((entry) => matches(entry.id));
    const pinned = regular.filter((entry) => entry.pinned);
    const archived = archivedThreadIds.map((id, index) => ({ index, id })).filter((entry) => matches(entry.id));
    return { regular, archived, pinned, groups: groupChatList(regular.filter((entry) => !entry.pinned), new Date()) };
  }, [threadItems, threadIds, archivedThreadIds, query, contentMatchIds]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-0.5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} role="status" aria-label="Loading chats" className="flex h-8 items-center px-2.5">
            <Skeleton className="h-3.5 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (view.regular.length === 0 && view.archived.length === 0) {
    return query ? (
      <div data-slot="aui_thread-list-empty" className="text-muted-foreground px-2.5 py-4 text-sm">
        No chats match “{query}”
      </div>
    ) : (
      <div data-slot="aui_thread-list-empty" className="px-2.5 py-6 text-center">
        <p className="text-sm font-medium">No chats yet</p>
        <p className="text-muted-foreground mt-1 text-sm">Start a new chat and it will show up here.</p>
      </div>
    );
  }

  return (
    <div data-slot="aui_chat-list-items" className="flex flex-col gap-0.5">
      {view.pinned.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <div data-slot="aui_thread-list-group-label" className="text-muted-foreground px-2.5 pt-3 pb-1 text-sm font-medium">
            Pinned
          </div>
          {view.pinned.map((entry) => (
            <ThreadListPrimitive.ItemByIndex key={entry.id} index={entry.index} components={{ ThreadListItem }} />
          ))}
        </div>
      )}
      {view.groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <div data-slot="aui_thread-list-group-label" className="text-muted-foreground px-2.5 pt-3 pb-1 text-sm font-medium">
            {group.label}
          </div>
          {group.items.map((entry) => (
            <ThreadListPrimitive.ItemByIndex key={entry.id} index={entry.index} components={{ ThreadListItem }} />
          ))}
        </div>
      ))}
      {view.archived.length > 0 && (
        <Collapsible open={archiveOpen || query !== ""} onOpenChange={setArchiveOpen} className="mt-2">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="text-muted-foreground hover:bg-muted h-8 w-full justify-start gap-1.5 rounded-md px-2.5 text-sm font-medium">
              <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 transition-transform [[data-state=open]>&]:rotate-90" />
              Archived ({view.archived.length})
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-0.5">
            {view.archived.map((entry) => (
              <ThreadListPrimitive.ItemByIndex key={entry.id} index={entry.index} archived components={{ ThreadListItem: ArchivedChatItem }} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
};

/** An archived row: open it, Restore it, or Delete it. The kit's row offers Archive, which is the
 * wrong action here, so this composes the same primitives and tokens with the two actions that fit. */
const ArchivedChatItem: FC = () => (
  <ThreadListItemPrimitive.Root
    data-slot="aui_thread-list-item"
    className="group hover:bg-muted focus-within:bg-muted data-active:bg-muted relative flex h-8 items-center rounded-md transition-colors"
  >
    <ThreadListItemPrimitive.Trigger
      data-slot="aui_thread-list-item-trigger"
      className="focus-visible:ring-ring/50 flex h-full min-w-0 flex-1 items-center rounded-md px-2.5 text-start text-sm opacity-70 outline-none group-hover:pe-16 group-focus-within:pe-16 focus-visible:ring-1"
    >
      <span data-slot="aui_thread-list-item-title" className="min-w-0 flex-1 truncate">
        <ThreadListItemPrimitive.Title fallback="New Chat" />
      </span>
    </ThreadListItemPrimitive.Trigger>
    <div className="absolute end-1.5 top-1/2 flex -translate-y-1/2 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
      <ThreadListItemPrimitive.Unarchive asChild>
        <Button variant="ghost" size="icon" aria-label="Restore" title="Restore" className="size-6 p-0">
          <RestoreIcon className="size-3.5" />
        </Button>
      </ThreadListItemPrimitive.Unarchive>
      <ThreadListItemPrimitive.Delete asChild>
        <Button variant="ghost" size="icon" aria-label="Delete" title="Delete" className="text-destructive size-6 p-0">
          <TrashIcon className="size-3.5" />
        </Button>
      </ThreadListItemPrimitive.Delete>
    </div>
  </ThreadListItemPrimitive.Root>
);
