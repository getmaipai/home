import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { List } from "@/kit/primitives/List";
import { AsyncState } from "@/kit/primitives/AsyncState";
import { Select } from "@/kit/primitives/Select";
import { DestructiveConfirm } from "@/kit/primitives/DestructiveConfirm";
import { BatchBar, SelectModeToggle } from "@/kit/primitives/BatchBar";
import { useSelectMode } from "@/kit/hooks/useSelectMode";
import { Checkbox } from "@/kit/ui/checkbox";
import { Button } from "@/kit/ui/button";
import { Input } from "@/kit/ui/input";
import { getIcon } from "@/kit/icons";
import { api, ApiError, type Entity, type Relationship, type PersonRosterEntry, type Role } from "@/lib/api";
import { relationshipLinesFor, relationshipOptionsBetween } from "@/apps/memory/relationshipLabels";
import { meetsMinRole } from "@/apps/people/roles";

const XIcon = getIcon("x");

const KIND_ORDER = ["person", "pet", "place", "organization", "thing"] as const;
type Kind = (typeof KIND_ORDER)[number];
const KIND_GROUP_LABEL: Record<Kind, string> = {
  person: "People",
  pet: "Pets",
  place: "Places",
  organization: "Organizations",
  thing: "Things",
};
const KIND_OPTION_LABEL: Record<Kind, string> = {
  person: "Person",
  pet: "Pet",
  place: "Place",
  organization: "Organization",
  thing: "Thing",
};
const PLACE_KIND_LABEL: Record<"map" | "area", string> = { map: "A place (a home, a school)", area: "A room inside a place" };

// A sentinel, not a real household member id - Select.tsx (kit/primitives)
// always needs `value` to be one of `options`, and "relate to no one" has
// to be a real selectable option rather than an absent one. Not "" - a
// code review caught Radix's own Select treating an empty string value
// as "unset" (shouldShowPlaceholder), which shows nothing at all in the
// closed trigger instead of this sentinel's own label.
const NO_RELATION = "none";

function subtitleFor(e: Entity): string {
  return `${KIND_OPTION_LABEL[e.kind as Kind] ?? e.kind}${e.scope === "person" ? " · Just you" : ""}`;
}

/** Everything else about how an existing household member becomes the
 * `to`/`from` side of a stated relationship: entities and people are
 * different records (entities.ts's own header - an Entity is NOT an
 * account), and nothing auto-creates a person-kind entity for a real
 * household member. The first time anyone relates something to Sage,
 * this creates Sage's own entity (household-scoped, `account_person_id`
 * set) once; every relationship stated after that reuses it. */
function findPersonEntity(entities: readonly Entity[], personId: string): Entity | undefined {
  return entities.find((e) => e.kind === "person" && e.account_person_id === personId);
}

interface EntityRelationshipLine {
  relationship: Relationship;
  text: string;
}

/** One entity row: name (or its inline edit form), scope, and its own
 * relationships in plain words - each with its own remove, an
 * "Unconfirmed" mark for one the judge inferred and nobody has stated
 * (spec/schemas/relationship.schema.json: never spoken as fact until
 * then), and, for an adult only, a Confirm control beside that mark
 * (lane 12 item 2; getmaipai/home BACKLOG "Confirming an inferred
 * entity or relationship": step 3a's `PATCH .../confirm` route,
 * hidden rather than disabled for a child - the route itself would
 * 403 them, but a button a child can tap into a wall is worse than no
 * button). getmaipai/home#119 adds the identical mark and control to
 * the entity's own name line (source: inferred, not just an inferred
 * relationship about it) - same adult-only, hidden-not-disabled rule,
 * PATCH /api/entities/:id { confirm: true }. */
function EntityRow({
  entity,
  lines,
  editing,
  editValue,
  onStartEdit,
  onEditChange,
  onSaveEdit,
  onCancelEdit,
  savingEdit,
  onRemoveRelationship,
  removingRelationshipId,
  canConfirm,
  onConfirmRelationship,
  confirmingRelationshipId,
  onConfirmEntity,
  confirmingEntityId,
}: {
  entity: Entity;
  lines: EntityRelationshipLine[];
  editing: boolean;
  editValue: string;
  onStartEdit: () => void;
  onEditChange: (v: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  savingEdit: boolean;
  onRemoveRelationship: (id: string) => void;
  removingRelationshipId: string | null;
  canConfirm: boolean;
  onConfirmRelationship: (id: string) => void;
  confirmingRelationshipId: string | null;
  onConfirmEntity: (id: string) => void;
  confirmingEntityId: string | null;
}) {
  if (editing) {
    return (
      <form
        className="flex min-w-0 flex-1 items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSaveEdit();
        }}
      >
        <Input value={editValue} onChange={(e) => onEditChange(e.target.value)} disabled={savingEdit} aria-label={`Rename ${entity.name}`} />
        <Button type="submit" size="sm" disabled={savingEdit || editValue.trim() === ""}>
          {savingEdit ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancelEdit} disabled={savingEdit}>
          Cancel
        </Button>
      </form>
    );
  }

  // home#119, the entity half of the relationship line's own unconfirmed
  // mark just below: an entity the judge inferred and nobody has stated
  // (source: inferred, confirmed_by_person_id still null) is never spoken
  // as fact until a household adult confirms it, same rule and same
  // hidden-for-a-child posture as the relationship control.
  const entityUnconfirmed = entity.source === "inferred" && !entity.confirmed_by_person_id;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex min-w-0 flex-col">
        <div className="flex min-w-0 items-center gap-2">
          {/* min-w-0 flex-1: a flex item's default min-width is its own
          content width, which defeats `truncate` the moment it shares a
          row with a sibling (the badge/button below) - a review caught a
          long name pushing those off-row instead of ellipsizing. */}
          <span className="min-w-0 flex-1 truncate text-base">{entity.name}</span>
          {entityUnconfirmed ? (
            // Deliberate type-floor exception (docs/UI.md, lane 7 item 3,
            // 2026-09-13): the identical compact badge the relationship
            // line's own "Unconfirmed" mark already gets the exception
            // for, just below - a badge, not a line of body text.
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs">Unconfirmed</span>
          ) : null}
          {entityUnconfirmed && canConfirm ? (
            <Button
              variant="ghost"
              size="xs"
              className="shrink-0"
              disabled={confirmingEntityId === entity.id}
              onClick={() => onConfirmEntity(entity.id)}
            >
              {confirmingEntityId === entity.id ? "Confirming…" : "Confirm"}
            </Button>
          ) : null}
        </div>
        <span className="text-sm text-muted-foreground">{subtitleFor(entity)}</span>
      </div>
      {lines.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {lines.map(({ relationship, text }) => {
            const unconfirmed = relationship.source === "inferred" && !relationship.confirmed_by_person_id;
            return (
              <li key={relationship.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="truncate">
                  {text}
                  {unconfirmed ? (
                    // Deliberate type-floor exception (docs/UI.md, lane 7
                    // item 3, 2026-09-13): a compact rounded-full badge, the
                    // same category chatMemoryChip.tsx's own chip already
                    // gets an exception for, not a line of body text.
                    <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs">Unconfirmed</span>
                  ) : null}
                </span>
                {unconfirmed && canConfirm ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="shrink-0"
                    disabled={confirmingRelationshipId === relationship.id}
                    onClick={() => onConfirmRelationship(relationship.id)}
                  >
                    {confirmingRelationshipId === relationship.id ? "Confirming…" : "Confirm"}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0"
                  aria-label={`Remove "${text}"`}
                  disabled={removingRelationshipId === relationship.id}
                  onClick={() => onRemoveRelationship(relationship.id)}
                >
                  <XIcon className="size-3.5" aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <Button variant="link" size="xs" className="h-auto w-fit p-0 text-muted-foreground" onClick={onStartEdit}>
        Edit name
      </Button>
    </div>
  );
}

/** The optional "relate to a household member" half of the create form:
 * a person picker plus a relationship-type picker filtered to whatever
 * the vocabulary actually allows between the new entity's own kind and
 * `person` (relationshipLabels.ts's relationshipOptionsBetween) - never
 * a free-text type, the same closed-vocabulary discipline the backend
 * itself enforces. */
function RelateToPicker({
  newKind,
  people,
  personId,
  onPersonChange,
  typeId,
  onTypeChange,
}: {
  newKind: Kind;
  people: PersonRosterEntry[];
  personId: string;
  onPersonChange: (id: string) => void;
  typeId: string;
  onTypeChange: (id: string) => void;
}) {
  const options = useMemo(() => relationshipOptionsBetween(newKind, "person"), [newKind]);
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  return (
    <div className="flex flex-col gap-2">
      <Select
        value={personId}
        onValueChange={onPersonChange}
        options={[NO_RELATION, ...people.map((p) => p.id)]}
        getLabel={(v) => (v === NO_RELATION ? "Not related to anyone" : (peopleById.get(v)?.display_name ?? v))}
        aria-label="Related to"
      />
      {personId !== NO_RELATION && options.length > 0 ? (
        <Select
          value={typeId || options[0]!.id}
          onValueChange={onTypeChange}
          options={options.map((o) => o.id)}
          getLabel={(v) => options.find((o) => o.id === v)?.label ?? v}
          aria-label="How they're related"
        />
      ) : null}
    </div>
  );
}

export function PeopleAndThings({ actorRole }: { actorRole: Role }) {
  const queryClient = useQueryClient();
  const entitiesQuery = useQuery<Entity[]>({ queryKey: ["entities"], queryFn: () => api.entities() });
  const relationshipsQuery = useQuery<Relationship[]>({ queryKey: ["relationships"], queryFn: () => api.relationships() });
  const peopleQuery = useQuery<PersonRosterEntry[]>({ queryKey: ["people"], queryFn: () => api.people() });

  const entities = useMemo(() => entitiesQuery.data ?? [], [entitiesQuery.data]);
  const relationships = relationshipsQuery.data ?? [];
  const people = peopleQuery.data ?? [];
  const entityById = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);

  const selectMode = useSelectMode(entities.map((e) => e.id));
  const [confirmingDelete, setConfirmingDelete] = useState<{ kind: "one"; id: string; name: string } | { kind: "batch" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [removingRelationshipId, setRemovingRelationshipId] = useState<string | null>(null);
  const [confirmingRelationshipId, setConfirmingRelationshipId] = useState<string | null>(null);
  const [confirmingEntityId, setConfirmingEntityId] = useState<string | null>(null);

  // Backend's own CONFIRMING_ROLES (backend/src/lib/entities.ts): owner,
  // admin, adult - never teen or child. meetsMinRole against "adult"
  // reads the identical set off the one role ladder rather than a second
  // hand-copied list (roles.ts's own acknowledged-duplication pattern:
  // worst case here is a hidden button, the server re-checks regardless).
  const canConfirm = meetsMinRole(actorRole, "adult");

  // One object, not three separate hooks (a code review's own finding,
  // the same "confirmingDelete is already a discriminated union" shape
  // just below) - id/value/saving can never drift out of sync with each
  // other since there's only ever one to update.
  const [editing, setEditing] = useState<{ id: string; value: string; saving: boolean } | null>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<Kind>("person");
  const [newPlaceKind, setNewPlaceKind] = useState<"map" | "area">("map");
  const [relatePersonId, setRelatePersonId] = useState(NO_RELATION);
  const [relateTypeId, setRelateTypeId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creatingBusy, setCreatingBusy] = useState(false);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["entities"] }),
      queryClient.invalidateQueries({ queryKey: ["relationships"] }),
    ]);
  }

  function leaveSelectMode() {
    selectMode.exit();
    setConfirmingDelete(null);
  }

  async function deleteEntities(ids: string[]) {
    setBusy(true);
    setActionError(null);
    try {
      // No bulk delete route exists for entities (unlike memories/people) -
      // one call per id, still one confirmation and one partial-success
      // report, per the org's own batch-actions rule (docs/UI.md: "the
      // kit owns the pattern... per-item results when some are refused").
      const results = await Promise.allSettled(ids.map((id) => api.deleteEntity(id)));
      const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      if (refused.length > 0) {
        // A code review caught this naming only the FIRST rejection's
        // reason as if it explained every failure - two different
        // causes (say a 403 and a timeout) used to read as one shared
        // one. Distinct reasons, not one assumed for all.
        const reasons = [...new Set(refused.map((r) => (r.reason instanceof ApiError ? r.reason.message : "not allowed")))];
        setActionError(`${refused.length} of ${ids.length} could not be removed: ${reasons.join("; ")}`);
      }
      leaveSelectMode();
      setConfirmingDelete(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removeRelationship(id: string) {
    setRemovingRelationshipId(id);
    setActionError(null);
    try {
      await api.deleteRelationship(id);
      await refresh();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not remove that relationship.");
    } finally {
      setRemovingRelationshipId(null);
    }
  }

  async function confirmRelationship(id: string) {
    setConfirmingRelationshipId(id);
    setActionError(null);
    try {
      await api.confirmRelationship(id);
      await refresh();
    } catch (err) {
      // A 409 (already confirmed, or not actually inferred) or a 403
      // (not an adult - shouldn't be reachable with the button hidden,
      // but the server is the real gate) leaves the mark in place and
      // says why, the same shape every other action error in this file
      // already uses.
      setActionError(err instanceof ApiError ? err.message : "Could not confirm that.");
    } finally {
      setConfirmingRelationshipId(null);
    }
  }

  async function confirmEntity(id: string) {
    setConfirmingEntityId(id);
    setActionError(null);
    try {
      await api.confirmEntity(id);
      await refresh();
    } catch (err) {
      // Same shape as confirmRelationship() above: a 409 (already
      // confirmed, or not actually inferred) or a 403 (not an adult -
      // shouldn't be reachable with the button hidden, but the server is
      // the real gate) leaves the mark in place and says why.
      setActionError(err instanceof ApiError ? err.message : "Could not confirm that.");
    } finally {
      setConfirmingEntityId(null);
    }
  }

  function startEdit(e: Entity) {
    setEditing({ id: e.id, value: e.name, saving: false });
  }

  async function saveEdit() {
    if (!editing) return;
    const { id, value } = editing;
    setEditing((prev) => (prev ? { ...prev, saving: true } : prev));
    setActionError(null);
    try {
      await api.updateEntity(id, { name: value.trim() });
      setEditing(null);
      await refresh();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not save that name.");
      setEditing((prev) => (prev ? { ...prev, saving: false } : prev));
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreatingBusy(true);
    setCreateError(null);
    // A code review caught the form closing unconditionally after this
    // ran - `createError`'s own <p> only renders while `creating` is
    // true, so setting the error and then closing the form in the same
    // tick meant a real partial failure (the entity saved, its
    // relationship didn't) was never actually visible to anyone.
    let relationshipFailed = false;
    try {
      const created = await api.createEntity({
        kind: newKind,
        name: newName.trim(),
        place_kind: newKind === "place" ? newPlaceKind : undefined,
        scope: "household",
      });

      if (relatePersonId !== NO_RELATION) {
        const options = relationshipOptionsBetween(newKind, "person");
        const chosen = options.find((o) => o.id === relateTypeId) ?? options[0];
        if (chosen) {
          try {
            let personEntity = findPersonEntity(entities, relatePersonId);
            if (!personEntity) {
              const person = people.find((p) => p.id === relatePersonId);
              personEntity = await api.createEntity({
                kind: "person",
                name: person?.display_name ?? "Household member",
                scope: "household",
                account_person_id: relatePersonId,
              });
            }
            await api.createRelationship({
              type: chosen.id,
              from_id: chosen.directionNewIsFrom ? created.id : personEntity.id,
              to_id: chosen.directionNewIsFrom ? personEntity.id : created.id,
              scope: "household",
            });
          } catch (err) {
            relationshipFailed = true;
            setCreateError(
              `${created.name} was added, but the relationship couldn't be saved: ${err instanceof ApiError ? err.message : "try adding it separately."}`,
            );
          }
        }
      }

      await refresh();
      if (!relationshipFailed) {
        setNewName("");
        setRelatePersonId(NO_RELATION);
        setRelateTypeId("");
        setCreating(false);
      } else {
        // The entity itself is real now (refreshed into the list above)
        // - clearing just the name keeps a resubmit from creating a
        // second, duplicate entity while the error stays on screen.
        setNewName("");
      }
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not add that.");
    } finally {
      setCreatingBusy(false);
    }
  }

  const grouped = KIND_ORDER.map((kind) => ({ kind, items: entities.filter((e) => e.kind === kind) })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-4">
      {actionError ? <p className="text-base text-destructive">{actionError}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        {selectMode.active ? (
          <BatchBar count={selectMode.count} onExit={leaveSelectMode}>
            <Button variant="destructive" disabled={selectMode.count === 0} onClick={() => setConfirmingDelete({ kind: "batch" })}>
              Remove selected
            </Button>
          </BatchBar>
        ) : (
          <>
            <SelectModeToggle label="Select" onClick={selectMode.enter} />
            <Button variant="secondary" onClick={() => setCreating((v) => !v)}>
              {creating ? "Cancel" : "Add"}
            </Button>
          </>
        )}
      </div>

      {creating ? (
        <form onSubmit={handleCreate} className="flex max-w-sm flex-col gap-3 rounded-lg border border-border p-3">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" disabled={creatingBusy} required />
          <Select
            value={newKind}
            onValueChange={(v) => {
              setNewKind(v as Kind);
              // A code review caught this: the type picker's own options
              // are filtered by kind (relationshipOptionsBetween), so a
              // type id chosen under the OLD kind can silently not exist
              // in the new list - reset rather than let handleCreate's
              // own `options.find(...) ?? options[0]` fall back to
              // something the picker never actually showed as selected.
              setRelateTypeId("");
            }}
            options={[...KIND_ORDER]}
            getLabel={(v) => KIND_OPTION_LABEL[v as Kind]}
            aria-label="Kind"
          />
          {newKind === "place" ? (
            <Select
              value={newPlaceKind}
              onValueChange={(v) => setNewPlaceKind(v as "map" | "area")}
              options={["map", "area"]}
              getLabel={(v) => PLACE_KIND_LABEL[v as "map" | "area"]}
              aria-label="What kind of place"
            />
          ) : null}
          {people.length > 0 ? (
            <RelateToPicker
              newKind={newKind}
              people={people}
              personId={relatePersonId}
              onPersonChange={setRelatePersonId}
              typeId={relateTypeId}
              onTypeChange={setRelateTypeId}
            />
          ) : null}
          {createError ? <p className="text-base text-destructive">{createError}</p> : null}
          <Button type="submit" disabled={creatingBusy || newName.trim() === ""} className="w-fit">
            {creatingBusy ? "Adding…" : "Add"}
          </Button>
        </form>
      ) : null}

      {confirmingDelete?.kind === "one" ? (
        <DestructiveConfirm
          message={`Remove ${confirmingDelete.name}?`}
          detail="This cannot be undone."
          confirmLabel="Yes, remove"
          busyLabel="Removing…"
          busy={busy}
          onConfirm={() => deleteEntities([confirmingDelete.id])}
          onCancel={() => setConfirmingDelete(null)}
        />
      ) : null}

      {confirmingDelete?.kind === "batch" ? (
        <DestructiveConfirm
          message={`Remove ${selectMode.count} ${selectMode.count === 1 ? "entry" : "entries"}? This cannot be undone.`}
          confirmLabel={`Yes, remove ${selectMode.count}`}
          busyLabel="Removing…"
          busy={busy}
          onConfirm={() => deleteEntities([...selectMode.selected])}
          onCancel={() => setConfirmingDelete(null)}
          cancelLabel="Keep them"
        />
      ) : null}

      <AsyncState
        data={entitiesQuery.data}
        error={entitiesQuery.isError}
        isFetching={entitiesQuery.isFetching}
        onRetry={() => entitiesQuery.refetch()}
        errorMessage="Could not load what MaiPai knows about."
        isEmpty={() => entities.length === 0}
        emptyIcon="users"
        emptyText="Nothing added yet."
        loadingLabel="Loading people and things"
      >
        {() => (
          <div className="flex flex-col gap-4">
            {grouped.map(({ kind, items }) => (
              <div key={kind} className="flex flex-col gap-1">
                <h3 className="text-sm font-medium text-muted-foreground">{KIND_GROUP_LABEL[kind]}</h3>
                <List
                  items={items}
                  getKey={(e) => e.id}
                  label={KIND_GROUP_LABEL[kind]}
                  renderItem={(e) => (
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      {selectMode.active ? (
                        <Checkbox checked={selectMode.isSelected(e.id)} onCheckedChange={() => selectMode.toggle(e.id)} aria-label={`Select ${e.name}`} className="shrink-0" />
                      ) : null}
                      <EntityRow
                        entity={e}
                        lines={relationshipLinesFor(e, relationships, entityById)}
                        editing={editing?.id === e.id}
                        editValue={editing?.id === e.id ? editing.value : ""}
                        onStartEdit={() => startEdit(e)}
                        onEditChange={(v) => setEditing((prev) => (prev ? { ...prev, value: v } : prev))}
                        onSaveEdit={saveEdit}
                        onCancelEdit={() => setEditing(null)}
                        savingEdit={editing?.id === e.id ? editing.saving : false}
                        onRemoveRelationship={removeRelationship}
                        removingRelationshipId={removingRelationshipId}
                        canConfirm={canConfirm}
                        onConfirmRelationship={confirmRelationship}
                        confirmingRelationshipId={confirmingRelationshipId}
                        onConfirmEntity={confirmEntity}
                        confirmingEntityId={confirmingEntityId}
                      />
                    </div>
                  )}
                  renderAction={
                    selectMode.active
                      ? undefined
                      : (e) => (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmingDelete({ kind: "one", id: e.id, name: e.name })}
                          >
                            Remove
                          </Button>
                        )
                  }
                />
              </div>
            ))}
          </div>
        )}
      </AsyncState>
    </div>
  );
}
