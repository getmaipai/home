import { z } from "zod";

// Mirrors spec/ui/schema.json field-for-field (docs/plans/session-b-ui.md
// step 5's own catalog/schema agreement test, catalog.test.ts, checks the
// two never drift apart). Zod here, not the JSON Schema itself, because
// nobody constructs a UiNode object graph in TypeScript at runtime the
// way spec/schemas/*.schema.json's record types are constructed - a page
// is authored as JSON and only ever READ, so this exists purely to give
// the interpreter (SchemaPage.tsx) real types and a runtime parse it can
// trust, not to replace ajv's own JSON Schema validation (spec/tests/ts/
// ui-schema.test.ts, the conformance suite pages/*.json run through
// before this ever sees them). spec/ui/README.md has the full reasoning
// for keeping both.
export const BindingSchema = z.object({
  source: z.enum(["route", "host"]),
  path: z.string().min(1),
  stream: z.boolean().default(false),
});
export type Binding = z.infer<typeof BindingSchema>;

// z.lazy for the two genuinely recursive shapes (Action nests one Action
// inside confirm.on_confirm; UiNode nests itself in page.body/section.
// children/split_view/detail_pane.body) - the same reason schema.json's
// own $ref: "#" is recursive, and the same reason (spec/ui/README.md)
// json-schema-to-zod codegen doesn't work here: hand-written, not
// generated.
export const ActionSchema: z.ZodType<Action> = z.lazy(() =>
  z
    .union([
      z.object({ navigate: z.object({ to: z.string() }) }),
      z.object({
        call: z.object({
          target: z.string(),
          method: z.enum(["POST", "PATCH", "DELETE"]).default("POST"),
          args: z.record(z.string(), z.unknown()).optional(),
        }),
      }),
      z.object({ play: z.object({ media_id: z.string() }) }),
      z.object({ confirm: z.object({ prompt: z.string(), on_confirm: ActionSchema }) }),
      z.object({ ask: z.object({ prompt: z.string(), expects: z.string() }) }),
    ])
    .refine((a) => Object.keys(a).length === 1, "exactly one action kind"),
);
export type Action =
  | { navigate: { to: string } }
  | { call: { target: string; method?: "POST" | "PATCH" | "DELETE"; args?: Record<string, unknown> } }
  | { play: { media_id: string } }
  | { confirm: { prompt: string; on_confirm: Action } }
  | { ask: { prompt: string; expects: string } };

export const BatchActionSchema = z.object({
  label: z.string(),
  scope: z.enum(["selected", "all"]),
  variant: z.enum(["default", "destructive"]).default("default"),
  action: ActionSchema,
});
export type BatchAction = z.infer<typeof BatchActionSchema>;

export const EmptyStateNodeSchema = z.object({
  type: z.literal("empty_state"),
  icon: z.string(),
  text: z.string(),
  action: ActionSchema.optional(),
});
export type EmptyStateNode = z.infer<typeof EmptyStateNodeSchema>;

export const ProgressNodeSchema = z.object({
  type: z.literal("progress"),
  mode: z.enum(["spinner", "determinate"]),
  bind: BindingSchema.optional(),
});
export type ProgressNode = z.infer<typeof ProgressNodeSchema>;

export const FormNodeSchema = z.object({
  type: z.literal("form"),
  fields: z
    .array(
      z.object({
        name: z.string(),
        selector: z.enum(["number", "select", "text", "boolean", "duration", "time", "entity", "area", "person", "media"]),
        placeholder: z.string().optional(),
      }),
    )
    .min(1),
  on_submit: ActionSchema,
});
export type FormNode = z.infer<typeof FormNodeSchema>;

export const MessageThreadNodeSchema = z.object({ type: z.literal("message_thread") });
export type MessageThreadNode = z.infer<typeof MessageThreadNodeSchema>;

export const SettingsEditorNodeSchema = z.object({ type: z.literal("settings_editor") });
export type SettingsEditorNode = z.infer<typeof SettingsEditorNodeSchema>;

export const ListNodeSchema = z.object({
  type: z.literal("list"),
  bind: BindingSchema,
  item_key_field: z.string(),
  item_label_field: z.string(),
  item_subtitle_field: z.string().optional(),
  item_badge_field: z.string().optional(),
  item_badge_label: z.string().optional(),
  row_action: z
    .object({
      icon: z.string(),
      label: z.string(),
      action: ActionSchema,
    })
    .optional(),
  batch: z
    .object({
      select_label: z.string().default("Select"),
      actions: z.array(BatchActionSchema).min(1),
    })
    .optional(),
  empty_state: EmptyStateNodeSchema.optional(),
});
export type ListNode = z.infer<typeof ListNodeSchema>;

export const CardGridNodeSchema = z.object({
  type: z.literal("card_grid"),
  bind: BindingSchema,
  item_key_field: z.string(),
  item_label_field: z.string(),
  on_select: ActionSchema.optional(),
  empty_state: EmptyStateNodeSchema.optional(),
});
export type CardGridNode = z.infer<typeof CardGridNodeSchema>;

export const MediaShelfNodeSchema = z.object({
  type: z.literal("media_shelf"),
  bind: BindingSchema,
  item_key_field: z.string(),
  item_label_field: z.string(),
  item_media_field: z.string(),
  aspect: z.enum(["wide", "square", "poster"]).default("wide"),
  on_select: ActionSchema.optional(),
  empty_state: EmptyStateNodeSchema.optional(),
});
export type MediaShelfNode = z.infer<typeof MediaShelfNodeSchema>;

export const DetailPaneNodeSchema: z.ZodType<DetailPaneNode> = z.lazy(() =>
  z.object({
    type: z.literal("detail_pane"),
    title: z.string(),
    subtitle: z.string().optional(),
    body: z.array(UiNodeSchema).min(1),
  }),
);
export interface DetailPaneNode {
  type: "detail_pane";
  title: string;
  subtitle?: string;
  body: UiNode[];
}

export const SplitViewNodeSchema: z.ZodType<SplitViewNode> = z.lazy(() =>
  z.object({
    type: z.literal("split_view"),
    list: z.union([ListNodeSchema, CardGridNodeSchema]),
    detail: DetailPaneNodeSchema,
  }),
);
export interface SplitViewNode {
  type: "split_view";
  list: ListNode | CardGridNode;
  detail: DetailPaneNode;
}

export const SectionNodeSchema: z.ZodType<SectionNode> = z.lazy(() =>
  z.object({
    type: z.literal("section"),
    heading: z.string().optional(),
    condition: z.string().optional(),
    children: z.array(UiNodeSchema).min(1),
  }),
);
export interface SectionNode {
  type: "section";
  heading?: string;
  condition?: string;
  children: UiNode[];
}

export const PageNodeSchema: z.ZodType<PageNode> = z.lazy(() =>
  z.object({
    type: z.literal("page"),
    id: z.string().min(1),
    title: z.string().min(1),
    body: z.array(UiNodeSchema).min(1),
  }),
);
export interface PageNode {
  type: "page";
  id: string;
  title: string;
  body: UiNode[];
}

export type UiNode =
  | PageNode
  | SectionNode
  | MessageThreadNode
  | SettingsEditorNode
  | FormNode
  | EmptyStateNode
  | ProgressNode
  | ListNode
  | CardGridNode
  | MediaShelfNode
  | DetailPaneNode
  | SplitViewNode;

export const UiNodeSchema: z.ZodType<UiNode> = z.lazy(() =>
  z.union([
    PageNodeSchema,
    SectionNodeSchema,
    MessageThreadNodeSchema,
    SettingsEditorNodeSchema,
    FormNodeSchema,
    EmptyStateNodeSchema,
    ProgressNodeSchema,
    ListNodeSchema,
    CardGridNodeSchema,
    MediaShelfNodeSchema,
    DetailPaneNodeSchema,
    SplitViewNodeSchema,
  ]),
);

/** Every node `type` the schema declares - the catalog.test.ts agreement
 * test walks this list and checks the catalog has a renderer for each. */
export const NODE_TYPES = [
  "page",
  "section",
  "message_thread",
  "settings_editor",
  "form",
  "empty_state",
  "progress",
  "list",
  "card_grid",
  "media_shelf",
  "detail_pane",
  "split_view",
] as const;
