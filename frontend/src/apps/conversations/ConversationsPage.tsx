import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Page } from "@/kit/primitives/Page";
import { List } from "@/kit/primitives/List";
import { AsyncState } from "@/kit/primitives/AsyncState";
import { Checkbox } from "@/kit/ui/checkbox";
import { Input } from "@/kit/ui/input";
import { Button } from "@/kit/ui/button";
import { Select } from "@/kit/primitives/Select";
import { BatchBar, SelectModeToggle } from "@/kit/primitives/BatchBar";
import { DestructiveConfirm } from "@/kit/primitives/DestructiveConfirm";
import { api, ApiError, isOwnerOrAdminRole, type ConversationSummary, type PersonRosterEntry, type Roster } from "@/lib/api";
import { cn, FOCUS_RING } from "@/kit/utils";

interface ConversationsPageProps {
  person: Roster;
}

function whenText(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "no messages yet";
}

const ME = "me";

// Session E step 5: "the list with rename, delete, batch delete,
// clear-all" over GET /api/conversations (backend/src/lib/
// conversationHistory.ts's listConversations(), landed session A step 3
// alongside rename/delete/batch-delete/clear - real routes this page is
// the first frontend consumer of at all). Hand-written, the same call
// PeoplePage.tsx already made for a structurally identical need: a
// title is renamed inline (a text input, not a schema `row_action`,
// which has no field for one), and only some rows are ever deletable
// (here: none, once viewing someone else's - see the person picker
// below), the same per-row conditionality the generic `list` node can't
// express.
export function ConversationsPage({ person }: ConversationsPageProps) {
  const queryClient = useQueryClient();
  const canViewOthers = isOwnerOrAdminRole(person.role);

  // Plan 4.14's parental view: "a parent may see a child's conversations
  // ... nothing of an adult's." The backend's own access check
  // (lib/access.ts's canAccessPerson, reused by every conversation
  // route) already enforces exactly the adult half for real - picking
  // anyone but a child here returns an empty list, not an error, so
  // there is nothing extra to gate client-side. What it does NOT yet
  // enforce is the plan's middle tier (a teen: summary and safety flags,
  // not the full transcript) - `canAccessPerson` has no teen case at
  // all today, so a teen picked here reads as empty too, the same as an
  // adult. Left for whoever extends that check or adds a summary-only
  // response shape (docs/BACKLOG.md's "parental view" item), not
  // invented here without a real contract to build it against.
  const [viewing, setViewing] = useState<string>(ME);
  const viewingSelf = viewing === ME;

  const peopleQuery = useQuery<PersonRosterEntry[]>({
    queryKey: ["people"],
    queryFn: () => api.people(),
    enabled: canViewOthers,
  });

  const listQuery = useQuery<ConversationSummary[]>({
    queryKey: ["conversations-list", viewingSelf ? null : viewing],
    queryFn: () => api.conversationList(viewingSelf ? undefined : viewing),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState<"batch" | "clear" | string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function invalidateList() {
    return queryClient.invalidateQueries({ queryKey: ["conversations-list"] });
  }

  function leaveSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
    setConfirmingDelete(null);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleRename(id: string) {
    setBusy(true);
    setActionError(null);
    try {
      await api.renameConversation(id, editTitle.trim() || null);
      setEditingId(null);
      await invalidateList();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not rename that conversation.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteOne(id: string) {
    setBusy(true);
    setActionError(null);
    try {
      await api.deleteConversation(id);
      setConfirmingDelete(null);
      await invalidateList();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not delete that conversation.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSelected() {
    setBusy(true);
    setActionError(null);
    try {
      await api.batchDeleteConversations([...selected]);
      leaveSelectMode();
      await invalidateList();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not delete those conversations.");
    } finally {
      setBusy(false);
    }
  }

  async function handleClearAll() {
    setBusy(true);
    setActionError(null);
    try {
      await api.clearConversations();
      setConfirmingDelete(null);
      await invalidateList();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not clear your conversations.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Conversations">
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a keyboard-scrollable region, not a widget (DetailPane.tsx's own precedent). */}
      <div tabIndex={0} className={cn("flex flex-1 flex-col gap-4 overflow-y-auto p-4", FOCUS_RING)}>
        {canViewOthers && peopleQuery.data && peopleQuery.data.length > 1 ? (
          <Select
            value={viewing}
            onValueChange={(v) => {
              setViewing(v);
              leaveSelectMode();
            }}
            options={[ME, ...peopleQuery.data.filter((p) => p.id !== person.id).map((p) => p.id)]}
            getLabel={(v) => (v === ME ? "Me" : (peopleQuery.data?.find((p) => p.id === v)?.display_name ?? v))}
            aria-label="Viewing whose conversations"
          />
        ) : null}

        {actionError ? <p className="text-base text-destructive">{actionError}</p> : null}

        {viewingSelf ? (
          <div className="flex flex-wrap items-center gap-2">
            {selectMode ? (
              <BatchBar count={selected.size} onExit={leaveSelectMode}>
                <Button variant="destructive" disabled={selected.size === 0} onClick={() => setConfirmingDelete("batch")}>
                  Delete selected
                </Button>
              </BatchBar>
            ) : (
              <SelectModeToggle label="Select conversations" onClick={() => setSelectMode(true)} />
            )}
            {!selectMode ? (
              <Button variant="ghost" onClick={() => setConfirmingDelete("clear")}>
                Clear all
              </Button>
            ) : null}
          </div>
        ) : null}

        {confirmingDelete === "batch" ? (
          <DestructiveConfirm
            message={`Delete ${selected.size} ${selected.size === 1 ? "conversation" : "conversations"}? This cannot be undone.`}
            confirmLabel={`Yes, delete ${selected.size}`}
            busyLabel="Deleting…"
            busy={busy}
            onConfirm={handleDeleteSelected}
            onCancel={() => setConfirmingDelete(null)}
            cancelLabel="Keep them"
          />
        ) : null}

        {confirmingDelete === "clear" ? (
          <DestructiveConfirm
            message="Delete every one of your conversations? This cannot be undone."
            confirmLabel="Yes, clear all"
            busyLabel="Clearing…"
            busy={busy}
            onConfirm={handleClearAll}
            onCancel={() => setConfirmingDelete(null)}
            cancelLabel="Keep them"
          />
        ) : null}

        <AsyncState
          data={listQuery.data}
          error={listQuery.isError}
          isFetching={listQuery.isFetching}
          onRetry={() => listQuery.refetch()}
          errorMessage={listQuery.error instanceof ApiError ? listQuery.error.message : "Could not load conversations."}
          isEmpty={(rows) => rows.length === 0}
          emptyIcon="message-circle"
          emptyText={viewingSelf ? "No conversations yet." : "Nothing to show here."}
          loadingLabel="Loading conversations"
        >
          {(conversations) => (
            <List
              items={conversations}
              getKey={(c) => c.id}
              label="Conversations"
              renderItem={(c) => {
                if (editingId === c.id) {
                  return (
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      aria-label="Conversation title"
                      className="max-w-64"
                    />
                  );
                }
                if (confirmingDelete === c.id) {
                  return <p className="text-base font-medium">Delete this conversation? This cannot be undone.</p>;
                }
                return (
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {selectMode ? (
                      <Checkbox
                        checked={selected.has(c.id)}
                        onCheckedChange={() => toggle(c.id)}
                        aria-label={`Select ${c.title ?? "untitled conversation"}`}
                        className="shrink-0"
                      />
                    ) : null}
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-base">{c.title ?? "Untitled conversation"}</span>
                      <span className="text-sm text-muted-foreground">
                        {c.turn_count} {c.turn_count === 1 ? "message" : "messages"} · {whenText(c.last_turn_at)}
                      </span>
                    </div>
                  </div>
                );
              }}
              renderAction={
                viewingSelf
                  ? (c) => {
                      if (editingId === c.id) {
                        return (
                          <div className="flex gap-2">
                            <Button onClick={() => handleRename(c.id)} disabled={busy}>
                              Save
                            </Button>
                            <Button variant="ghost" onClick={() => setEditingId(null)}>
                              Cancel
                            </Button>
                          </div>
                        );
                      }
                      if (confirmingDelete === c.id) {
                        return (
                          <div className="flex gap-2">
                            <Button variant="destructive" onClick={() => handleDeleteOne(c.id)} disabled={busy}>
                              {busy ? "Deleting…" : "Yes, delete"}
                            </Button>
                            <Button variant="ghost" onClick={() => setConfirmingDelete(null)}>
                              Keep it
                            </Button>
                          </div>
                        );
                      }
                      if (selectMode) return null;
                      return (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            aria-label={`Rename ${c.title ?? "untitled conversation"}`}
                            onClick={() => {
                              setEditingId(c.id);
                              setEditTitle(c.title ?? "");
                            }}
                          >
                            Rename
                          </Button>
                          <Button
                            variant="ghost"
                            aria-label={`Delete ${c.title ?? "untitled conversation"}`}
                            onClick={() => setConfirmingDelete(c.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      );
                    }
                  : undefined
              }
            />
          )}
        </AsyncState>
      </div>
    </Page>
  );
}
