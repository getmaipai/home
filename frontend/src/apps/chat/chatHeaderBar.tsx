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
      className="h-8 max-w-64 text-base"
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
    <div className="flex min-w-0 items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        className="min-w-0 max-w-64 justify-start truncate px-2 text-base font-medium"
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
