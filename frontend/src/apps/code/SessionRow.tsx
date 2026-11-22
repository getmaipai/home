// CODE-UX-01: one row of the sessions column, with Chat's row menu (Rename, Pin, Archive, Delete), an unread dot and a "Needs you" state. The menu is the
// kit's dropdown; the labels, the order and the inline rename follow Chat's thread list. The row's marker rule is `rowMarker` in codeList.ts.
import { i18n } from "@lingui/core";
import { useEffect, useRef, useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@maipai/ui/src/dashboard/components/ui/dropdown-menu";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { getIcon } from "@maipai/ui/src/icons";
import { cn } from "@maipai/ui/src/utils";
import type { CodeSession } from "./codeApi";
import { rowMarker } from "./codeList";
import { stateWord } from "./codeTranscript";
import type { useSessionActions } from "./sessionActions";

const MoreIcon = getIcon("more-horizontal");
const PinIcon = getIcon("pin");
const PinOffIcon = getIcon("pin-off");
const PencilIcon = getIcon("pencil");
const ArchiveIcon = getIcon("archive");
const TrashIcon = getIcon("trash");
const AlertIcon = getIcon("circle-alert");

/** The leading marker: a dot for new activity, a pulse while the agent works, a ring for a stop, an alert for a session that needs you. A quiet row has none. */
function Marker({ session, currentId }: { session: CodeSession; currentId: string | undefined }) {
  const marker = rowMarker(session, currentId);
  if (marker === "needs_you") return <AlertIcon role="img" aria-label={stateWord("needs_you")} data-slot="code-row-marker" data-marker="needs_you" className="size-4 shrink-0" style={{ color: "var(--status-attention-ink)" }} />;
  if (marker === "unread") return <span role="img" aria-label={i18n._({ id: "New activity", message: "New activity" })} data-slot="code-row-marker" data-marker="unread" className="size-2 shrink-0 rounded-full bg-primary" />;
  if (marker === "working") return <span role="img" aria-label={stateWord(session.state)} data-slot="code-row-marker" data-marker="working" className="size-2 shrink-0 animate-pulse rounded-full motion-reduce:animate-none" style={{ background: "var(--status-progress-ink)" }} />;
  if (marker === "failed") return <span role="img" aria-label={stateWord("failed")} data-slot="code-row-marker" data-marker="failed" className="size-2 shrink-0 rounded-full" style={{ background: "var(--tint-problem-border)" }} />;
  return null;
}

export function SessionRow({ session, currentId, actions, onOpen, mobile = false }: { session: CodeSession; currentId: string | undefined; actions: ReturnType<typeof useSessionActions>; onOpen: (id: string) => void; mobile?: boolean }) {
  const active = session.id === currentId;
  const pinned = Boolean(session.pinned_at);
  const archived = Boolean(session.archived_at);
  const unread = rowMarker(session, currentId) === "unread";
  // A session that is working or waiting for you is not archived (the hub refuses it too): the item is off, not hidden.
  const mayArchive = archived || !["queued", "starting", "working", "needs_you"].includes(session.state);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(session.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const settled = useRef(false);
  const restoreFocus = useRef(false);
  useEffect(() => { if (renaming) { inputRef.current?.focus(); inputRef.current?.select(); } else if (restoreFocus.current) { restoreFocus.current = false; triggerRef.current?.focus(); } }, [renaming]);
  const startRename = () => { settled.current = false; setName(session.title); setRenaming(true); };
  // Enter saves, Escape cancels, leaving the field saves (the keys Chat's rename uses). An empty or unchanged name closes without a call; a refused one keeps the field open.
  const finish = (focus: boolean) => { restoreFocus.current = focus; setRenaming(false); };
  const commit = (focus: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const next = name.trim();
    if (!next || next === session.title) { finish(focus); return; }
    void actions.rename(session.id, next).then((ok) => { if (ok) finish(focus); else { settled.current = false; inputRef.current?.focus(); } });
  };
  return <div data-slot="code-session-row" data-active={active ? "" : undefined} data-unread={unread ? "" : undefined} data-archived={archived ? "" : undefined}
    className={cn("group relative flex items-center gap-1 rounded-lg pe-1 transition-colors hover:bg-muted has-focus-visible:bg-muted has-aria-expanded:bg-muted data-active:bg-muted", mobile ? "min-h-12" : "h-9 min-h-9")}>
    {renaming
      ? <Input ref={inputRef} data-slot="code-session-rename" aria-label={i18n._({ id: "Rename session", message: "Rename session" })} value={name} maxLength={120}
        onChange={(event) => setName(event.target.value)} onBlur={() => commit(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); commit(true); } else if (event.key === "Escape") { event.preventDefault(); if (!settled.current) { settled.current = true; finish(true); } }
        }} />
      : <a href={`/apps/code/${session.id}`} aria-current={active ? "page" : undefined} data-slot="code-session-link" title={session.title}
        onClick={(event) => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) { event.preventDefault(); onOpen(session.id); } }}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-start text-row outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
        <span data-slot="code-row-marker-slot" className="flex size-4 shrink-0 items-center justify-center"><Marker session={session} currentId={currentId} /></span>
        {pinned ? <PinIcon aria-hidden data-slot="code-row-pinned" className="size-3 shrink-0 text-muted-foreground" /> : null}
        <span className={cn("min-w-0 flex-1 truncate", unread && "font-semibold")}>{session.title}</span>
        {mobile && session.state === "needs_you" ? <span data-slot="code-row-needs-you" className="shrink-0 text-supporting" style={{ color: "var(--status-attention-ink)" }}>{stateWord("needs_you")}</span> : null}
        {unread ? <span className="sr-only">{i18n._({ id: "New activity", message: "New activity" })}</span> : null}
      </a>}
    <span data-slot="code-session-more-wrap" className={cn("shrink-0", !mobile && "opacity-0 focus-within:opacity-100 group-hover:opacity-100 group-data-active:opacity-100 has-aria-expanded:opacity-100")}>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button ref={triggerRef} variant="ghost" size="icon-xs" data-slot="code-session-more" aria-label={i18n._({ id: "More options for {title}", message: "More options for {title}", values: { title: session.title } })} />}>
          <MoreIcon aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side={mobile ? "bottom" : "right"} sideOffset={6}>
          <DropdownMenuItem onClick={startRename}><PencilIcon aria-hidden className="size-4" />{i18n._({ id: "Rename", message: "Rename" })}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void actions.pin(session.id, !pinned)}>
            {pinned ? <PinOffIcon aria-hidden className="size-4" /> : <PinIcon aria-hidden className="size-4" />}{pinned ? i18n._({ id: "Unpin", message: "Unpin" }) : i18n._({ id: "Pin", message: "Pin" })}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!mayArchive} onClick={() => void actions.archive(session.id, !archived)}><ArchiveIcon aria-hidden className="size-4" />{archived ? i18n._({ id: "Unarchive", message: "Unarchive" }) : i18n._({ id: "Archive", message: "Archive" })}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => void actions.remove(session)}><TrashIcon aria-hidden className="size-4" />{i18n._({ id: "Delete", message: "Delete" })}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  </div>;
}
