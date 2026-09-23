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
// reusable standalone). Never ThreadListPrimitive.New here specifically -
// this renders outside the runtime tree (see chatHeaderData.tsx's own
// header comment), and that primitive needs an AuiProvider ancestor;
// data.onStartTemporary (chatHeaderData.tsx) already does the real
// thread switch, from inside the tree that has one.
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
// Known gap for CHAT-HEADER-02 (planned: an app icon in this same
// slot): the title Button's own `flex-1` sets flex-shrink:1 via the
// `flex` shorthand, but the kit's shared `buttonVariants` base class
// also carries an unconditional `shrink-0` that tailwind-merge does
// not dedupe against `flex-1` (different utility groups) and that
// wins the cascade - confirmed with a real computed-style check
// (2026-09-23 review). Today this never triggers a real bug: the
// title's own flex-basis is 0%, so this nested row is always in the
// "grow" branch, never the "shrink" branch, regardless of shrink:0.
// If a further fixed-width sibling ever makes this row's own available
// space genuinely too tight for the chevron's own minimum width, this
// title's flex-shrink:0 would leave the chevron with nowhere to go -
// CHAT-HEADER-02 needs to re-check this when it adds that sibling,
// not assumed fixed by this comment alone.
import { useEffect, useRef, useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
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
const ExternalLinkIcon = getIcon("external-link");
const ChevronDownIcon = getIcon("chevron-down");

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

  if (renaming) {
    return <ChatHeaderRename title={data.title} onRename={data.onRename} onDone={() => setRenaming(false)} />;
  }

  // An untitled conversation shows the same placeholder the thread list
  // uses (ThreadListItemPrimitive.Title's own `fallback="New Chat"`),
  // never a blank bar.
  const title = data.title || "New Chat";

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        className="min-w-0 flex-1 justify-start truncate px-2 text-base font-medium"
        onClick={() => setRenaming(true)}
      >
        {title}
      </Button>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label="Conversation actions">
            <ChevronDownIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            <PencilIcon className="size-4" />
            Rename
          </DropdownMenuItem>
          {data.temporaryAllowed && <DropdownMenuItem onClick={data.onStartTemporary}>Start temporary chat</DropdownMenuItem>}
          {data.shareAllowed && (
            <DropdownMenuItem disabled>
              <ExternalLinkIcon className="size-4" />
              Share
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => void data.onDelete()}>
            <TrashIcon className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
