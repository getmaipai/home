import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Page } from "@/kit/primitives/Page";
import { Section } from "@/kit/primitives/Section";
import { List } from "@/kit/primitives/List";
import { AsyncState } from "@/kit/primitives/AsyncState";
import { Avatar } from "@/kit/primitives/Avatar";
import { Input } from "@/kit/ui/input";
import { Select } from "@/kit/primitives/Select";
import { Button } from "@/kit/ui/button";
import { Checkbox } from "@/kit/ui/checkbox";
import { BatchBar, SelectModeToggle } from "@/kit/primitives/BatchBar";
import { api, ApiError, type PersonRosterEntry, type Role, type Roster } from "@/lib/api";
import {
  ROLE_LABELS,
  canManagePeople,
  canDeletePerson,
  canManagePerson,
  creatableRoles,
  requiresSecret,
} from "@/apps/people/roles";

interface PeoplePageProps {
  person: Roster;
}

// 4.2's household roster. Edit and delete landed 2026-09-05 (the backend
// routes did not exist before that, which is why this page only listed
// and added).
//
// Deleting a person is the most destructive thing in the product: it
// erases their memories, their conversations, their settings and their
// recordings for real (backend/src/lib/personLifecycle.ts). So it gets a
// confirmation that names them and says what goes, never a bare button,
// and the batch version names the count.
export function PeoplePage({ person }: PeoplePageProps) {
  const queryClient = useQueryClient();
  const rosterQuery = useQuery<PersonRosterEntry[]>({
    queryKey: ["people"],
    queryFn: () => api.people(),
  });
  const roster = rosterQuery.data;
  function invalidateRoster() {
    return queryClient.invalidateQueries({ queryKey: ["people"] });
  }

  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role>("adult");
  const [secret, setSecret] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<Role>("adult");

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState<"batch" | string | null>(null);
  const [busy, setBusy] = useState(false);

  const actorRole = person.role as Role;
  const canManage = canManagePeople(actorRole);
  const roleOptions = canManage ? creatableRoles(actorRole) : [];

  const deletable = (roster ?? []).filter((p) =>
    canDeletePerson(actorRole, person.id, { id: p.id, role: p.role as Role }),
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function leaveSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
    setConfirmingDelete(null);
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await api.createPerson({
        displayName,
        role,
        secret: requiresSecret(role) ? secret : undefined,
      });
      setDisplayName("");
      setSecret("");
      await invalidateRoster();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not add that person.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveEdit(id: string) {
    setBusy(true);
    setActionError(null);
    try {
      const target = (roster ?? []).find((p) => p.id === id);
      await api.updatePerson(id, {
        displayName: editName,
        // Only sent when it actually changed: the backend refuses a role
        // change from anyone but the owner, and sending an unchanged role
        // would turn a rename by an admin into a 403.
        role: target && editRole !== target.role ? editRole : undefined,
      });
      setEditingId(null);
      await invalidateRoster();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not save those changes.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteOne(id: string) {
    setBusy(true);
    setActionError(null);
    try {
      await api.deletePerson(id);
      setConfirmingDelete(null);
      await invalidateRoster();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not remove that person.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSelected() {
    setBusy(true);
    setActionError(null);
    try {
      const { outcomes } = await api.deletePeople([...selected]);
      // Partial success is reported, never swallowed (docs/UI.md > Batch
      // actions): four of five removed and one refused has to say which
      // and why, or a parent is left guessing what happened.
      const refused = outcomes.filter((o) => !o.deleted);
      if (refused.length > 0) {
        const names = refused.map((o) => (roster ?? []).find((p) => p.id === o.id)?.display_name ?? "someone");
        setActionError(`${names.join(", ")} could not be removed: ${refused[0]?.reason ?? "not allowed"}`);
      }
      leaveSelectMode();
      await invalidateRoster();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not remove those people.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="People">
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
        {actionError ? <p className="text-base text-[var(--destructive)]">{actionError}</p> : null}

        <AsyncState
          data={roster}
          error={rosterQuery.isError}
          isFetching={rosterQuery.isFetching}
          onRetry={() => rosterQuery.refetch()}
          errorMessage="Could not load the household."
          loadingLabel="Loading household"
        >
          {(loadedRoster) => (
          <Section heading="Household">
            {canManage && deletable.length > 0 ? (
              selectMode ? (
                <BatchBar count={selected.size} onExit={leaveSelectMode}>
                  <Button
                    variant="destructive"
                    disabled={selected.size === 0}
                    onClick={() => setConfirmingDelete("batch")}
                  >
                    Remove selected
                  </Button>
                </BatchBar>
              ) : (
                <SelectModeToggle label="Select people" onClick={() => setSelectMode(true)} />
              )
            ) : null}

            {confirmingDelete === "batch" ? (
              <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-[var(--destructive)] p-3">
                <p className="text-base font-medium">
                  Remove {selected.size} {selected.size === 1 ? "person" : "people"} from your household?
                </p>
                <p className="text-base text-[var(--muted-foreground)]">
                  Everything MaiPai remembers about them, every conversation they had, their settings and any voice
                  they recorded will be deleted. This cannot be undone.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="destructive" onClick={handleDeleteSelected} disabled={busy}>
                    {busy ? "Removing…" : `Yes, remove ${selected.size}`}
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirmingDelete(null)}>
                    Keep them
                  </Button>
                </div>
              </div>
            ) : null}

            <List
              items={loadedRoster}
              getKey={(p) => p.id}
              label="Household"
              renderItem={(p) => {
                if (editingId === p.id) {
                  return (
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 py-1">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        aria-label={`Name for ${p.display_name}`}
                        className="max-w-48"
                      />
                      {actorRole === "owner" && p.id !== person.id ? (
                        <Select
                          value={editRole}
                          onValueChange={(v) => setEditRole(v as Role)}
                          options={creatableRoles("owner")}
                          getLabel={(v) => ROLE_LABELS[v as Role]}
                          aria-label={`Role for ${p.display_name}`}
                        />
                      ) : null}
                    </div>
                  );
                }
                if (confirmingDelete === p.id) {
                  return (
                    <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
                      <p className="text-base font-medium">Remove {p.display_name} from your household?</p>
                      <p className="text-base text-[var(--muted-foreground)]">
                        Everything MaiPai remembers about {p.display_name}, every conversation they had, their
                        settings and any voice they recorded will be deleted. This cannot be undone.
                      </p>
                    </div>
                  );
                }
                return (
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {selectMode && canDeletePerson(actorRole, person.id, { id: p.id, role: p.role as Role }) ? (
                      // The box stays its designed 16px; `kit/ui/checkbox.tsx`
                      // already carries its own 48px hit area (docs/UI.md's
                      // floor - the fix a code review (2026-09-05) applied
                      // here before Checkbox existed, now the kit's own), so
                      // no wrapping div is needed to reach it (a second code
                      // review, same night, caught one left behind here).
                      <Checkbox
                        checked={selected.has(p.id)}
                        onCheckedChange={() => toggle(p.id)}
                        aria-label={`Select ${p.display_name}`}
                        className="shrink-0"
                      />
                    ) : null}
                    <Avatar name={p.display_name} className="h-10 w-10 shrink-0" />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-base">{p.display_name}</span>
                      <span className="text-sm text-[var(--muted-foreground)]">{ROLE_LABELS[p.role]}</span>
                    </div>
                  </div>
                );
              }}
              renderAction={(p) => {
                if (editingId === p.id) {
                  return (
                    <div className="flex gap-2">
                      <Button onClick={() => handleSaveEdit(p.id)} disabled={busy}>
                        Save
                      </Button>
                      <Button variant="ghost" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  );
                }
                if (confirmingDelete === p.id) {
                  return (
                    <div className="flex gap-2">
                      <Button variant="destructive" onClick={() => handleDeleteOne(p.id)} disabled={busy}>
                        {busy ? "Removing…" : "Yes, remove"}
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirmingDelete(null)}>
                        Keep them
                      </Button>
                    </div>
                  );
                }
                if (selectMode) return null;
                const mayEdit = canManagePerson(actorRole, person.id, { id: p.id, role: p.role as Role });
                const mayDelete = canDeletePerson(actorRole, person.id, { id: p.id, role: p.role as Role });
                if (!mayEdit && !mayDelete) return null;
                return (
                  <div className="flex gap-1">
                    {mayEdit ? (
                      <Button
                        variant="ghost"
                        aria-label={`Edit ${p.display_name}`}
                        onClick={() => {
                          setEditingId(p.id);
                          setEditName(p.display_name);
                          setEditRole(p.role as Role);
                        }}
                      >
                        Edit
                      </Button>
                    ) : null}
                    {mayDelete ? (
                      <Button
                        variant="ghost"
                        aria-label={`Remove ${p.display_name}`}
                        onClick={() => setConfirmingDelete(p.id)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                );
              }}
            />
          </Section>
          )}
        </AsyncState>

        {canManage ? (
          <Section heading="Add someone">
            <form onSubmit={handleAdd} className="flex max-w-sm flex-col gap-3">
              <Input
                placeholder="Name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={submitting}
                required
              />
              <Select
                value={role}
                onValueChange={(v) => setRole(v as Role)}
                options={roleOptions}
                getLabel={(v) => ROLE_LABELS[v as Role]}
                disabled={submitting}
                aria-label="Role"
              />
              {requiresSecret(role) ? (
                <Input
                  type="password"
                  placeholder="PIN or password (required for this role)"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  disabled={submitting}
                  required
                />
              ) : null}
              {formError ? <p className="text-base text-[var(--destructive)]">{formError}</p> : null}
              <Button type="submit" disabled={submitting}>
                {submitting ? "Adding…" : "Add to household"}
              </Button>
            </form>
          </Section>
        ) : null}
      </div>
    </Page>
  );
}
