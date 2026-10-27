"use client";

// CHAT-HEADER-01: the conversation's own title and actions, in the
// shell header - beside the sidebar trigger (ui-v0.5.35's headerExtra
// slot), never a second row (the owner's own rejected pattern,
// 2026-09-21). Mounted via useHeaderExtra(ChatHeaderBar) from
// ChatPage.tsx; reads everything through chatHeaderData.tsx's
// bridge context, since this renders as Header's own child (FullLayout),
// a sibling of ChatPage's own AssistantRuntimeProvider tree, not a
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
import { Avatar, AvatarFallback, AvatarImage } from "@maipai/ui/src/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { ChatHeader } from "@maipai/ui/src/elements/chat-header";
import { getIcon } from "@maipai/ui/src/icons";

const ColumnOpenIcon = getIcon("panel-left-open");
import { useChatHeaderData } from "@/apps/chat/chatHeaderData";
import { useCompanionAvatar, useCompanionStills } from "@/apps/chat/useCompanionAvatar";

const PencilIcon = getIcon("pencil");
const TrashIcon = getIcon("trash");
const PinIcon = getIcon("pin");
const PinOffIcon = getIcon("pin-off");
const HistoryIcon = getIcon("history");
const ArchiveIcon = getIcon("archive");
const MoreIcon = getIcon("more-horizontal");

function ChatHeaderRename({ title, onRename, onDone, commitOnBlur = true }: { title: string; onRename: (title: string) => Promise<void>; onDone: () => void; commitOnBlur?: boolean }) {
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
      onBlur={commitOnBlur ? commit : undefined}
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
/** DOTS-CHAT-01: reads the companion for the kit header. Its own component so the presence hooks (runtime and router) run only when the preview switch is on. */
function WithCompanion({ companionId, fallbackName, children }: { companionId: string | null; fallbackName?: string; children: (name: string, media: ReactNode) => ReactNode }) {
  // The header draws in the shell bar, outside the chat runtime: a still and the name by query only, never a player.
  const { avatar } = useCompanionAvatar(companionId);
  const stills = useCompanionStills(companionId ? [companionId] : []);
  const name = avatar?.name ?? fallbackName ?? "MaiPai";
  return children(name, <Avatar><AvatarImage src={companionId ? stills[companionId] : undefined} alt="" /><AvatarFallback>{name.slice(0, 1)}</AvatarFallback></Avatar>);
}

type ShellsProps = { shells?: boolean; onMenu?: (() => void) | undefined; menuExpanded?: boolean; menuControls?: string; onHistory?: (() => void) | undefined; onCall?: (() => void) | undefined };

export function ChatHeaderBar({ phoneRow = false, trailing, shells = false, onMenu, menuExpanded, menuControls, onHistory, onCall }: { phoneRow?: boolean; trailing?: ReactNode } & ShellsProps = {}) {
  const data = useChatHeaderData();
  const stills = useCompanionStills(data?.companions.map(({ id }) => id) ?? []);
  const [renaming, setRenaming] = useState(false);
  const [open, setOpen] = useState(false);

  // Non-chat pages never call useSetChatHeaderData at all (they don't
  // import this file), so this is only ever null for one real reason:
  // /chat itself hasn't finished its own first render yet. Nothing
  // to show for that one frame - the shipped Search field is what a
  // person would otherwise briefly see instead, and swapping between
  // the two on every mount would be its own small defect.
  if (!data) return null;

  // An untitled conversation shows the same placeholder the thread list
  // uses (ThreadListItemPrimitive.Title's own `fallback="New Chat"`),
  // never a blank bar.
  const title = data.title || "New Chat";
  // On a phone the conversation's header sits in the shell's top bar (one bar, not a second row): the bar then draws as the phone row
  // does and starts with the history toggle.
  const inBar = data.inShellBar === true;
  if (inBar) phoneRow = true;

  const actions = (
    <>
      {trailing}
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className="text-muted-foreground" aria-label="Conversation actions"><MoreIcon className="size-[18px]" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" density="compact">
          {onHistory ? <><DropdownMenuItem onClick={onHistory}><HistoryIcon className="size-4" />Chat history</DropdownMenuItem><DropdownMenuSeparator /></> : null}
          <DropdownMenuItem onClick={() => setRenaming(true)}><PencilIcon className="size-4" />Rename</DropdownMenuItem>
          {data.pinnable ? <DropdownMenuItem onClick={() => void data.onPinChange(!data.pinned)}>{data.pinned ? <PinOffIcon className="size-4" /> : <PinIcon className="size-4" />}{data.pinned ? "Unpin" : "Pin"}</DropdownMenuItem> : null}
          <DropdownMenuItem onClick={() => void data.onArchive()}><ArchiveIcon className="size-4" />Archive</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => void data.onDelete()}><TrashIcon className="size-4" />Delete</DropdownMenuItem>
          {data.ttsAvailable ? <><DropdownMenuSeparator /><DropdownMenuCheckboxItem checked={data.autoReadReplies} onCheckedChange={data.onAutoReadRepliesChange}>Read replies aloud</DropdownMenuCheckboxItem></> : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
  const companionId = data.companionId ?? data.defaultCompanionId ?? null;
  const identityChoices = data.pinnable ? data.companions.map((companion) => ({ value: companion.id, label: companion.name, imageUrl: stills[companion.id] })) : undefined;
  if (shells || companionId) {
    return (
      <>
        <WithCompanion companionId={companionId} fallbackName={data.companions.find(({ id }) => id === companionId)?.name}>{(name, media) => <ChatHeader name={name} media={media} identityChoices={identityChoices} identityValue={companionId ?? undefined} onIdentityChange={(value) => void data.onCompanionChange(value)} onMenu={onMenu} onCall={onCall} actions={actions} menuExpanded={menuExpanded} menuControls={menuControls} />}</WithCompanion>
        <Dialog open={renaming} onOpenChange={setRenaming}>
          <DialogContent>
            <DialogHeader><DialogTitle>Rename</DialogTitle><DialogDescription>{title}</DialogDescription></DialogHeader>
            <ChatHeaderRename title={data.title} onRename={data.onRename} onDone={() => setRenaming(false)} commitOnBlur={false} />
          </DialogContent>
        </Dialog>
      </>
    );
  }
  return (
    <div data-chat-header-bar className={phoneRow ? "flex min-w-0 flex-1 items-center gap-1 overflow-hidden" : "hidden min-w-0 flex-1 items-center gap-1 overflow-hidden lg:flex"}>
      {inBar && data.onToggleSheet ? (
        <Button variant="ghost" size="icon-lg" aria-label={data.sheetOpen ? "Hide threads" : "Show threads"} aria-expanded={data.sheetOpen === true} aria-controls="next-chat-threads" onClick={data.onToggleSheet}>
          <ColumnOpenIcon className="size-4.5" />
        </Button>
      ) : null}
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
            align="start"
            className={phoneRow ? "h-12 min-w-12 flex-1 px-2 text-[15px] font-medium" : "-ms-2 h-9 min-w-0 max-w-full shrink px-2 text-[15px] font-medium relative before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-['']"}
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
            {/* The same actions, labels, icons and order as the history
                column's row menu (the kit's thread list: Rename, Pin or
                Unpin, Archive, Delete last), at its compact size. The
                row menu also has Move to project, which needs the row's
                project list and stays there. Read replies aloud is the
                header's own item, after the shared group. */}
            <DropdownMenuContent align="end" density="compact">
              <DropdownMenuItem onClick={() => setRenaming(true)}>
                <PencilIcon className="size-4" />
                Rename
              </DropdownMenuItem>
              {data.pinnable ? (
                <DropdownMenuItem onClick={() => void data.onPinChange(!data.pinned)}>
                  {data.pinned ? <PinOffIcon className="size-4" /> : <PinIcon className="size-4" />}
                  {data.pinned ? "Unpin" : "Pin"}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => void data.onArchive()}>
                <ArchiveIcon className="size-4" />
                Archive
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => void data.onDelete()}>
                <TrashIcon className="size-4" />
                Delete
              </DropdownMenuItem>
              {data.ttsAvailable ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={data.autoReadReplies}
                    onCheckedChange={data.onAutoReadRepliesChange}
                  >
                    Read replies aloud
                  </DropdownMenuCheckboxItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  );
}
