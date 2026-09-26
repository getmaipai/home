"use client";

// CHAT-HEADER-01: the conversation's own title and actions, in the
// shell header - beside the sidebar trigger (ui-v0.5.35's headerExtra
// slot), never a second row (the owner's own rejected pattern,
// 2026-09-21). Mounted via useHeaderExtra(ChatHeaderBar) from
// NextChatPage.tsx; reads everything through chatHeaderData.tsx's
// bridge context, since this renders as Header's own child (FullLayout),
// a sibling of NextChatPage's own AssistantRuntimeProvider tree, not a
// descendant of it - see that file's own header comment for why a data
// context, not the runtime itself, crosses that gap.
//
// Composed only from shipped pieces: the kit's DropdownMenu primitives
// (`ui/dropdown-menu`) and Input (`ui/input`), the same inline-editable-
// title behavior thread-list.aui.tsx's own ThreadListItemRename already
// establishes (its own aui.threadListItem.rename() call, mirrored here
// since that Element is coupled to one list row's own props, not
// reusable standalone).
//
// CHAT-FIND-0923-03: the menu held Rename / Start temporary chat /
// Share / Delete - Jesse's own finding, live: this menu is this
// conversation's own actions, the same set the thread row's own
// three-dots menu shows (Rename / Archive / Delete, the shipped
// Element's fixed set - not Home's to add to or reorder), and
// temporary-chat has nothing to do with an EXISTING conversation's
// actions at all (it starts a NEW one). Temporary-chat's one real home
// is CHAT-LIST-01's own button beside New Thread, which already did
// the same job without going through this context. Share stays out
// too, not because it doesn't belong on a conversation's own actions
// in principle, but because a disabled placeholder is worse than no
// entry (SHARE-CONV-01 adds a real one once share itself exists);
// Archive isn't added either - the row's own Archive throws today by
// deliberate design (chatThreadListAdapter.ts: "the shared record has
// no archive state"), and this menu won't carry a second broken copy
// of it (CONV-ARCHIVE-01 gives both menus a real Archive together, one
// definition, once the record itself supports it). `onStartTemporary`/
// `temporaryAllowed`/`shareAllowed` are gone from `ChatHeaderData`
// itself (chatHeaderData.tsx) along with this - this menu was their
// only consumer.
//
// CHAT-HEADER-03: the title used to cap at a fixed max-w-64 (256px)
// regardless of how much room the header actually had - the template's
// own left/right header groups (commons Header.tsx) had no flex-grow/
// shrink participation of their own, so a flex row with two non-
// growing children just leaves empty space between them rather than
// letting either claim it. Mirrors the template's own flex-sizing
// convention down the whole chain instead: Header.tsx's left group
// (`flex-auto min-w-0`, `ui-v0.5.38`; `flex-nowrap` below the `sm`
// breakpoint, `ui-v0.5.39` - a review found `flex-wrap` alone forced
// a long title to wrap the whole row at 390px instead of truncating
// on its own line, both fixes documented in that file's own comments),
// this component's own root div (`flex-1`), and the title button
// itself (`flex-1`, replacing `max-w-64`) - the title now grows to
// whatever the header has left after the fixed sidebar trigger and
// the fixed right-side icons, truncating only once it must.
//
// CHAT-HEADER-02: the app icon (the exact `getIcon("message-circle")`
// SidebarContent already uses for "Chat") is the new fixed-width
// sibling the CHAT-HEADER-03 comment above named as the thing to
// re-check for the title's own shrink-0/flex-1 gap. Re-checked at
// both captured widths (1440 and 390, a 60-character title): still no
// real bug - this row's own hypothetical size is dominated by the
// icon and chevron's small fixed widths, well under either viewport's
// available space even with the icon added, so it stays in the
// "grow" branch the CHAT-HEADER-03 comment already described. The
// gap itself is unchanged (still latent, still worth a real fix if a
// much busier header slot is ever built here) - not re-litigated in
// this comment a second time, see git history for the original.
import { useEffect, useRef, useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { hitArea } from "@maipai/ui/src/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@maipai/ui/src/ui/dropdown-menu";
import { getIcon } from "@maipai/ui/src/icons";
import { useChatHeaderData } from "@/apps/chat/chatHeaderData";

const PencilIcon = getIcon("pencil");
const TrashIcon = getIcon("trash");
const ChevronDownIcon = getIcon("chevron-down");
// The exact icon SidebarContent (commons sidebaritems.ts) already
// uses for "Chat" - nextPageHeaderTitle.tsx's own header comment has
// the full reasoning for why every /next page's header icon mirrors
// the sidebar's own choice; chat mirrors it here directly since it
// never mounts that shared component at all.
const ChatIcon = getIcon("message-circle");

function ChatHeaderRename({ title, onRename, onDone }: { title: string; onRename: (title: string) => Promise<void>; onDone: () => void }) {
  const [value, setValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const commit = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    const next = value.trim();
    if (!next || next === title) {
      onDone();
      return;
    }
    onRename(next).then(onDone, () => {
      settledRef.current = false;
      inputRef.current?.focus();
    });
  };

  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onDone();
  };

  return (
    <Input
      ref={inputRef}
      aria-label="Rename conversation"
      value={value}
      className="h-8 min-w-0 flex-1 text-base"
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
    />
  );
}

export function ChatHeaderBar() {
  const data = useChatHeaderData();
  const [renaming, setRenaming] = useState(false);
  const [open, setOpen] = useState(false);

  // Non-chat pages never call useSetChatHeaderData at all (they don't
  // import this file), so this is only ever null for one real reason:
  // /next/chat itself hasn't finished its own first render yet. Nothing
  // to show for that one frame - the shipped Search field is what a
  // person would otherwise briefly see instead, and swapping between
  // the two on every mount would be its own small defect.
  if (!data) return null;

  // An untitled conversation shows the same placeholder the thread list
  // uses (ThreadListItemPrimitive.Title's own `fallback="New Chat"`),
  // never a blank bar.
  const title = data.title || "New Chat";

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <ChatIcon className="text-muted-foreground size-4 shrink-0" />
      <Button
        type="button"
        variant={data.incognito ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={data.incognito}
        onClick={() => data.onIncognitoChange(!data.incognito)}
      >
        Incognito {data.incognito ? "On" : "Off"}
      </Button>
      {renaming ? (
        <ChatHeaderRename title={data.title} onRename={data.onRename} onDone={() => setRenaming(false)} />
      ) : (
        <>
          {/* CHAT-FIND-0923-05: the kit's own "default" Button size is a
              deliberate h-12 (48px, docs/UI.md's hard touch-target
              floor) - correct for a real interactive control, but it
              grew this row taller than the template's own header
              controls (Light-Dark.tsx: `h-10 w-10`, 40px, the same
              convention the app-sidebar's own logo row already sits at
              - 57px, not this row's own 65px, the gap Jesse found live).
              `h-10` plus `hitArea(1)` (the same technique `icon-lg`
              already uses) keeps the 48px hit area a real click needs
              while the visual line returns to 40px, matching the
              template's own convention rather than carving out a
              special case for this one row. */}
          <Button
            type="button"
            variant="ghost"
            className={`h-10 min-w-0 flex-1 justify-start truncate px-2 text-base font-medium ${hitArea(1)}`}
            onClick={() => setRenaming(true)}
          >
            {title}
          </Button>
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
              {/* A review caught this: `icon-lg` carries its own
                  `hitArea(1)` (a 4px overhang each side), and so does
                  the title button above - back-to-back on this row's
                  own `gap-1` (4px), the two overhangs cover the exact
                  same 4px strip between them, and this button, later in
                  DOM order, wins every click that lands there instead
                  of the title. `ms-1` (4px) closes the row's own gap to
                  the buttons' own 8px, the width both overhangs
                  together need to stop touching at all. */}
              <Button type="button" variant="ghost" size="icon-lg" className="ms-1" aria-label="Conversation actions">
                <ChevronDownIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => setRenaming(true)}>
                <PencilIcon className="size-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => void data.onDelete()}>
                <TrashIcon className="size-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  );
}
