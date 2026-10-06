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
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@maipai/ui/src/ui/dropdown-menu";
import { getIcon } from "@maipai/ui/src/icons";
import { useChatHeaderData } from "@/apps/chat/chatHeaderData";

const PencilIcon = getIcon("pencil");
const TrashIcon = getIcon("trash");
const MoreIcon = getIcon("more-horizontal");

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

/** RAIL-01 (owner's layout, 2026-10-06): the conversation header holds
 * only this conversation's title and actions. The title (one click
 * renames) sits on the left; the conversation's options menu and
 * `trailing` (the agent/task activity toggle's slot, when there is one)
 * sit on the right. */
export function ChatHeaderBar({ phoneRow = false, trailing }: { phoneRow?: boolean; trailing?: ReactNode } = {}) {
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
    <div data-chat-header-bar className={phoneRow ? "flex min-w-0 flex-1 items-center gap-1 overflow-hidden" : "hidden min-w-0 flex-1 items-center gap-1 overflow-hidden lg:flex"}>
      {renaming ? (
        <ChatHeaderRename title={data.title} onRename={data.onRename} onDone={() => setRenaming(false)} />
      ) : (
        <>
          {/* Keep the title button itself at the kit's 48px touch-target
              floor. A pseudo-element hit-area pad overlaps its neighbor
              here and axe does not count it as a sufficiently sized,
              separate target. */}
          <Button
            type="button"
            variant="ghost"
            className={phoneRow ? "h-12 min-w-12 flex-1 justify-start px-2 text-[15px] font-medium" : "-ms-2 h-9 min-w-0 max-w-full shrink justify-start px-2 text-[15px] font-medium relative before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-['']"}
            onClick={() => setRenaming(true)}
          >
            <span className="min-w-0 truncate">{title}</span>
          </Button>
          {phoneRow ? null : <span className="flex-1" aria-hidden />}
          {trailing}
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
              {/* Keep an 8px visual gap between the two independent
                  48px targets. */}
              <Button type="button" variant="ghost" size={phoneRow ? "icon-lg" : "icon"} className="text-muted-foreground" aria-label="Conversation actions">
                <MoreIcon className="size-[18px]" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setRenaming(true)}>
                <PencilIcon className="size-4" />
                Rename
              </DropdownMenuItem>
              {data.ttsAvailable ? (
                <DropdownMenuCheckboxItem
                  checked={data.autoReadReplies}
                  onCheckedChange={data.onAutoReadRepliesChange}
                >
                  Read replies aloud
                </DropdownMenuCheckboxItem>
              ) : null}
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
