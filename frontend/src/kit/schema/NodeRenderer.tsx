import { createContext, useContext, useState } from "react";
import { Section } from "@/kit/primitives/Section";
import { List } from "@/kit/primitives/List";
import { CardGrid } from "@/kit/primitives/CardGrid";
import { MediaShelf } from "@/kit/primitives/MediaShelf";
import { DetailPane } from "@/kit/primitives/DetailPane";
import { SplitView } from "@/kit/primitives/SplitView";
import { EmptyState } from "@/kit/primitives/EmptyState";
import { Progress } from "@/kit/primitives/Progress";
import { AsyncState } from "@/kit/primitives/AsyncState";
import { BatchBar, SelectModeToggle } from "@/kit/primitives/BatchBar";
import { Button } from "@/kit/ui/button";
import { Input } from "@/kit/ui/input";
import { Checkbox } from "@/kit/ui/checkbox";
import { getIcon } from "@/kit/icons";
import { useBinding } from "@/kit/schema/binding";
import { useDispatchAction } from "@/kit/schema/actions";
import { ConfirmDialog } from "@/kit/schema/ConfirmDialog";
import { evaluateCondition } from "@/kit/schema/condition";
import { fillTemplate, readField } from "@/kit/schema/fieldPath";
import type {
  UiNode,
  SectionNode,
  ListNode,
  CardGridNode,
  MediaShelfNode,
  DetailPaneNode,
  SplitViewNode,
  FormNode,
  EmptyStateNode,
  ProgressNode,
} from "@/kit/schema/types";

type Row = Record<string, unknown>;

// A list's bound rows, filtered before anything else sees them - not
// part of the declarative page shape (spec/ui/schema.json has no
// concept of this), but a real per-instance need: the chat "memory
// updated" chip's deep link (chatMemoryChip.tsx, step 4) filters
// Memory's list to specific ids via a ?ids= query param, which is
// exactly the kind of runtime, route-specific concern a JSON page
// describing STRUCTURE shouldn't need to know about. The thin-mount
// page component (MemoryPage.tsx) is the only real provider; absent a
// provider, every row passes through unchanged.
export const RowFilterContext = createContext<(row: Row) => boolean>(() => true);

function EmptyStateNodeView({ node }: { node: EmptyStateNode }) {
  const { dispatch } = useDispatchAction();
  return (
    <EmptyState
      icon={node.icon}
      text={node.text}
      actionLabel={node.action ? actionLabel(node.action) : undefined}
      onAction={node.action ? () => dispatch(node.action!) : undefined}
    />
  );
}

// A page-authored action has no fixed "label" property of its own
// (spec/ui/schema.json's action def is deliberately just the five kinds
// and their own arguments) - EmptyState's own primitive wants a button
// label, so this derives a plain one from whichever kind was declared.
// Nothing built this session actually reaches this path (Memory's own
// empty_state has no action), kept only for schema completeness.
function actionLabel(action: EmptyStateNode["action"]): string {
  if (!action) return "";
  if ("navigate" in action) return "Go";
  if ("call" in action) return "Continue";
  if ("confirm" in action) return "Continue";
  if ("ask" in action) return "Continue";
  return "Play";
}

function ProgressNodeView({ node }: { node: ProgressNode }) {
  return <Progress mode={node.mode} />;
}

function SectionNodeView({ node, state }: { node: SectionNode; state: Row }) {
  // evaluateCondition throws on an unsupported operator (a code review,
  // 2026-09-05, made that loud on purpose - see condition.ts) - but this
  // runs inside render, with no ErrorBoundary anywhere in the app, so an
  // uncaught throw here would unmount the WHOLE page over one section's
  // bad condition string. Caught here so the mistake is still loud (the
  // console error), but contained to just this section staying hidden.
  let visible: boolean;
  try {
    visible = evaluateCondition(node.condition, state);
  } catch (e) {
    console.error(`kit/schema: section "${node.heading}" hidden - ${e instanceof Error ? e.message : e}`);
    visible = false;
  }
  if (!visible) return null;
  return (
    <Section heading={node.heading}>
      {node.children.map((child, i) => (
        <NodeRenderer key={i} node={child} state={state} />
      ))}
    </Section>
  );
}

function ListNodeView({ node }: { node: ListNode }) {
  const query = useBinding<Row[]>(node.bind);
  const rowFilter = useContext(RowFilterContext);
  const filteredRows = query.data?.filter(rowFilter);
  const hasRows = (filteredRows?.length ?? 0) > 0;
  const { dispatch, pendingConfirm, lastError } = useDispatchAction();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function keyOf(row: Row): string {
    return String(readField(row, node.item_key_field));
  }
  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  const RowActionIcon = node.row_action ? getIcon(node.row_action.icon) : null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ConfirmDialog pendingConfirm={pendingConfirm} />
      {lastError ? <p className="text-base text-destructive">{lastError}</p> : null}
      {node.batch && hasRows ? (
        selectMode ? (
          <BatchBar count={selected.size} onExit={exitSelectMode}>
            {node.batch.actions.map((batchAction, i) => (
              <Button
                key={i}
                variant={batchAction.variant === "destructive" ? "destructive" : "secondary"}
                disabled={batchAction.scope === "selected" && selected.size === 0}
                onClick={() => {
                  const rows = filteredRows ?? [];
                  const items =
                    batchAction.scope === "all" ? rows : rows.filter((row) => selected.has(keyOf(row)));
                  // exitSelectMode as onSettled, not called synchronously
                  // here: a code review (2026-09-05) found the selection
                  // being cleared the instant this action was dispatched,
                  // including a confirm-wrapped one - the confirm dialog
                  // then asked its question over a list that had already
                  // silently dropped out of select mode, and cancelling
                  // lost the selection for nothing. Now it only clears
                  // once the action actually runs; a scope:"all" action
                  // never had a selection to lose in the first place, so
                  // it keeps not bothering.
                  dispatch(batchAction.action, items, batchAction.scope !== "all" ? exitSelectMode : undefined);
                }}
              >
                {batchAction.label}
              </Button>
            ))}
          </BatchBar>
        ) : (
          <SelectModeToggle label={node.batch.select_label ?? "Select"} onClick={() => setSelectMode(true)} />
        )
      ) : null}

      <AsyncState
        data={filteredRows}
        error={query.isError}
        isFetching={query.isFetching}
        onRetry={() => query.refetch()}
        errorMessage="Could not load this list."
        isEmpty={(rows) => rows.length === 0}
        emptyIcon={node.empty_state?.icon ?? "inbox"}
        emptyText={node.empty_state?.text ?? "Nothing here yet."}
      >
        {(rows) => (
          <List
            items={rows}
            getKey={keyOf}
            label={node.item_label_field}
            isSelected={selectMode ? (row) => selected.has(keyOf(row)) : undefined}
            renderItem={(row) => (
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {selectMode ? (
                  <Checkbox
                    checked={selected.has(keyOf(row))}
                    onCheckedChange={() => toggle(keyOf(row))}
                    aria-label={`Select ${String(readField(row, node.item_label_field))}`}
                    className="shrink-0"
                  />
                ) : null}
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-base">{String(readField(row, node.item_label_field))}</span>
                  {node.item_subtitle_field ? (
                    <span className="text-sm text-muted-foreground">
                      {fillTemplate(node.item_subtitle_field, row)}
                      {node.item_badge_field && readField(row, node.item_badge_field) ? ` · ${node.item_badge_label ?? ""}` : ""}
                    </span>
                  ) : null}
                </div>
              </div>
            )}
            renderAction={
              node.row_action && !selectMode
                ? (row) => (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={fillTemplate(node.row_action!.label, row)}
                      onClick={() => dispatch(node.row_action!.action, [row])}
                    >
                      {RowActionIcon ? <RowActionIcon className="h-5 w-5" aria-hidden /> : null}
                    </Button>
                  )
                : undefined
            }
          />
        )}
      </AsyncState>
    </div>
  );
}

function CardGridNodeView({ node }: { node: CardGridNode }) {
  const query = useBinding<Row[]>(node.bind);
  const { dispatch } = useDispatchAction();
  function keyOf(row: Row): string {
    return String(readField(row, node.item_key_field));
  }
  return (
    <AsyncState
      data={query.data}
      error={query.isError}
      isFetching={query.isFetching}
      onRetry={() => query.refetch()}
      errorMessage="Could not load this grid."
      isEmpty={(rows) => rows.length === 0}
      emptyIcon={node.empty_state?.icon ?? "inbox"}
      emptyText={node.empty_state?.text ?? "Nothing here yet."}
    >
      {(rows) => (
        <CardGrid
          items={rows}
          getKey={keyOf}
          onSelect={node.on_select ? (row) => dispatch(node.on_select!, [row]) : undefined}
          getLabel={(row) => String(readField(row, node.item_label_field))}
          renderItem={(row) => <span className="text-base">{String(readField(row, node.item_label_field))}</span>}
        />
      )}
    </AsyncState>
  );
}

function MediaShelfNodeView({ node }: { node: MediaShelfNode }) {
  const query = useBinding<Row[]>(node.bind);
  const { dispatch } = useDispatchAction();
  function keyOf(row: Row): string {
    return String(readField(row, node.item_key_field));
  }
  return (
    <AsyncState
      data={query.data}
      error={query.isError}
      isFetching={query.isFetching}
      onRetry={() => query.refetch()}
      errorMessage="Could not load this shelf."
      isEmpty={(rows) => rows.length === 0}
      emptyIcon={node.empty_state?.icon ?? "inbox"}
      emptyText={node.empty_state?.text ?? "Nothing here yet."}
    >
      {(rows) => (
        <MediaShelf
          items={rows}
          getKey={keyOf}
          aspect={node.aspect}
          onSelect={node.on_select ? (row) => dispatch(node.on_select!, [row]) : undefined}
          getLabel={(row) => String(readField(row, node.item_label_field))}
          renderCaption={(row) => <span className="text-sm">{String(readField(row, node.item_label_field))}</span>}
          renderItem={(row) => {
            const src = String(readField(row, node.item_media_field) ?? "");
            return src ? <img src={src} alt="" className="h-full w-full object-cover" /> : null;
          }}
        />
      )}
    </AsyncState>
  );
}

function DetailPaneNodeView({ node, state }: { node: DetailPaneNode; state: Row }) {
  return (
    <DetailPane title={node.title} subtitle={node.subtitle}>
      {node.body.map((child, i) => (
        <NodeRenderer key={i} node={child} state={state} />
      ))}
    </DetailPane>
  );
}

function SplitViewNodeView({ node, state }: { node: SplitViewNode; state: Row }) {
  return (
    <SplitView
      list={<NodeRenderer node={node.list} state={state} />}
      detail={<NodeRenderer node={node.detail} state={state} />}
    />
  );
}

// No page this session builds uses a `form` node (Chat's own composer is
// now assistant-ui's, step 4; Memory needs no create-form) - kept minimal
// and honest about it: "select"/"duration"/"time"/"entity"/"area"/
// "person"/"media" have no real widget built yet (step 7 is where
// SettingField, the other place these same selector names come from,
// gains several of them) and fall back to a plain text input rather than
// pretending to support something unbuilt.
function FormNodeView({ node }: { node: FormNode }) {
  const { dispatch } = useDispatchAction();
  const [values, setValues] = useState<Row>({});
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className="flex max-w-sm flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitting(true);
        dispatch(node.on_submit, [values]);
        setSubmitting(false);
      }}
    >
      {node.fields.map((field) => {
        if (field.selector === "boolean") {
          return (
            <label key={field.name} className="flex items-center gap-2 text-base">
              <Checkbox
                checked={Boolean(values[field.name])}
                onCheckedChange={(checked) => setValues((v) => ({ ...v, [field.name]: checked }))}
              />
              {field.placeholder ?? field.name}
            </label>
          );
        }
        return (
          <Input
            key={field.name}
            type={field.selector === "number" ? "number" : "text"}
            placeholder={field.placeholder ?? field.name}
            value={String(values[field.name] ?? "")}
            onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
            disabled={submitting}
          />
        );
      })}
      <Button type="submit" disabled={submitting}>
        {submitting ? "Working…" : "Submit"}
      </Button>
    </form>
  );
}

/** Mount points for a pattern component that owns a whole, framework-
 * driven subsystem in React (assistant-ui's runtime for Chat, the
 * settings registry's own renderer for Settings) rather than anything
 * a generic bind/action interpreter renders. `spec/ui/pages/chat.json`
 * and a future settings.json are conformance fixtures ajv validates
 * (spec/tests/ts/ui-schema.test.ts) but this interpreter never actually
 * receives at runtime - ChatPage.tsx and SettingsPage.tsx mount their
 * own real components directly, keyed off the route rather than a
 * SchemaPage render (docs/dev.md's A2UI entry has the full reasoning).
 * These two views exist only so the catalog/schema agreement test
 * (catalog.test.ts) has something real to check against every declared
 * node type, not because either is reachable through NodeRenderer in
 * the running app. */
function ExternallyMountedNodeView({ label }: { label: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      {label} mounts its own page component directly (see NodeRenderer.tsx's own comment).
    </p>
  );
}

export function NodeRenderer({ node, state = {} }: { node: UiNode; state?: Row }): React.ReactElement | null {
  switch (node.type) {
    case "page":
      return (
        <>
          {node.body.map((child, i) => (
            <NodeRenderer key={i} node={child} state={state} />
          ))}
        </>
      );
    case "section":
      return <SectionNodeView node={node} state={state} />;
    case "list":
      return <ListNodeView node={node} />;
    case "card_grid":
      return <CardGridNodeView node={node} />;
    case "media_shelf":
      return <MediaShelfNodeView node={node} />;
    case "detail_pane":
      return <DetailPaneNodeView node={node} state={state} />;
    case "split_view":
      return <SplitViewNodeView node={node} state={state} />;
    case "form":
      return <FormNodeView node={node} />;
    case "empty_state":
      return <EmptyStateNodeView node={node} />;
    case "progress":
      return <ProgressNodeView node={node} />;
    case "message_thread":
      return <ExternallyMountedNodeView label="message_thread" />;
    case "settings_editor":
      return <ExternallyMountedNodeView label="settings_editor" />;
  }
}
