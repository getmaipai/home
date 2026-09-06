// Step 8: "lists, reminders and timers" (docs/plans/session-d-packages-
// and-store.md) - the frozen D-to-E contract (docs/plans/wave-2.md, "D
// to E: the store, widgets, lists"). lib/lists.ts holds the rules; this
// is only the HTTP boundary, the same split routes/entities.ts already
// takes over lib/entities.ts. "The running timer" (E's own UI) has no
// route of its own here: GET /api/scheduler/jobs (routes/scheduler.ts)
// already lists a person's own pending jobs, `reminders.fire`/
// `timers.fire` among them.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { listLists, getList, createList, updateList, deleteList, addItem, editItem, removeItem, clearList } from "@/lib/lists";
import { List } from "@maipai/spec/gen/ts/list.js";

export const listsRoutes = apiRouter();

const KIND = z.enum(["shopping", "todo", "custom"]);
const SCOPE = z.enum(["household", "person"]);

function statusFor(status: number): 400 | 404 {
  return status === 404 ? 404 : 400;
}

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Lists"],
  summary: "Every list I can see - the household's own, plus my own person-scoped ones",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.array(List) } }, description: "Found." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
listsRoutes.openapi(listRoute, (c) => {
  const actor = c.get("person");
  return c.json(listLists(actor), 200);
});

const getRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Lists"],
  summary: "One list",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "list-a1b2c3") },
  responses: {
    200: { content: { "application/json": { schema: List } }, description: "Found." },
    ...errorResponses({ 401: "Not signed in", 404: "No such list" }),
  },
});
listsRoutes.openapi(getRoute, (c) => {
  const actor = c.get("person");
  const result = getList(actor, c.req.valid("param").id);
  if (!result.ok) return c.json({ error: result.error }, 404);
  return c.json(result.value, 200);
});

const createRoute_ = createRoute({
  method: "post",
  path: "/",
  tags: ["Lists"],
  summary: "Create a list - shopping/todo find-or-create their own standing one via chat instead; this is for a custom list, or an explicit household/person one",
  middleware: [requireAuth] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            kind: KIND,
            title: z.string().min(1).max(120).optional(),
            scope: SCOPE.optional(),
            person: z.string().nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { content: { "application/json": { schema: List } }, description: "Created." },
    ...errorResponses({ 400: "Invalid list", 401: "Not signed in" }),
  },
});
listsRoutes.openapi(createRoute_, (c) => {
  const actor = c.get("person");
  const result = createList(actor, c.req.valid("json"));
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json(result.value, 201);
});

const patchRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Lists"],
  summary: "Rename a list",
  middleware: [requireAuth] as const,
  request: {
    params: idParamSchema("id", "list-a1b2c3"),
    body: { content: { "application/json": { schema: z.object({ title: z.string().min(1).max(120).optional() }) } } },
  },
  responses: {
    200: { content: { "application/json": { schema: List } }, description: "Updated." },
    ...errorResponses({ 400: "Invalid edit", 401: "Not signed in", 404: "No such list" }),
  },
});
listsRoutes.openapi(patchRoute, (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const result = updateList(actor, id, c.req.valid("json"));
  if (!result.ok) return c.json({ error: result.error }, statusFor(result.status));
  return c.json(result.value, 200);
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Lists"],
  summary: "Remove a list",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "list-a1b2c3") },
  responses: {
    200: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Removed." },
    ...errorResponses({ 401: "Not signed in", 404: "No such list" }),
  },
});
listsRoutes.openapi(deleteRoute, (c) => {
  const actor = c.get("person");
  const result = deleteList(actor, c.req.valid("param").id);
  if (!result.ok) return c.json({ error: result.error }, 404);
  return c.json(result.value, 200);
});

const addItemRoute = createRoute({
  method: "post",
  path: "/{id}/items",
  tags: ["Lists"],
  summary: "Add an item to a list",
  middleware: [requireAuth] as const,
  request: {
    params: idParamSchema("id", "list-a1b2c3"),
    body: {
      content: {
        "application/json": {
          schema: z.object({ text: z.string().min(1).max(500), due_at: z.string().nullable().optional() }),
        },
      },
    },
  },
  responses: {
    200: { content: { "application/json": { schema: List } }, description: "Added." },
    ...errorResponses({ 400: "Invalid item", 401: "Not signed in", 404: "No such list" }),
  },
});
listsRoutes.openapi(addItemRoute, (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const result = addItem(actor, id, c.req.valid("json"));
  if (!result.ok) return c.json({ error: result.error }, statusFor(result.status));
  return c.json(result.value, 200);
});

const editItemRoute = createRoute({
  method: "patch",
  path: "/{id}/items/{itemId}",
  tags: ["Lists"],
  summary: "Edit an item - text, done, or due date",
  middleware: [requireAuth] as const,
  request: {
    params: z.object({ id: z.string().openapi({ example: "list-a1b2c3" }), itemId: z.string().openapi({ example: "item-a1b2c3" }) }),
    body: {
      content: {
        "application/json": {
          schema: z.object({ text: z.string().min(1).max(500).optional(), done: z.boolean().optional(), due_at: z.string().nullable().optional() }),
        },
      },
    },
  },
  responses: {
    200: { content: { "application/json": { schema: List } }, description: "Updated." },
    ...errorResponses({ 400: "Invalid edit", 401: "Not signed in", 404: "No such list or item" }),
  },
});
listsRoutes.openapi(editItemRoute, (c) => {
  const actor = c.get("person");
  const { id, itemId } = c.req.valid("param");
  const result = editItem(actor, id, itemId, c.req.valid("json"));
  if (!result.ok) return c.json({ error: result.error }, statusFor(result.status));
  return c.json(result.value, 200);
});

const removeItemRoute = createRoute({
  method: "delete",
  path: "/{id}/items/{itemId}",
  tags: ["Lists"],
  summary: "Remove one item",
  middleware: [requireAuth] as const,
  request: {
    params: z.object({ id: z.string().openapi({ example: "list-a1b2c3" }), itemId: z.string().openapi({ example: "item-a1b2c3" }) }),
  },
  responses: {
    200: { content: { "application/json": { schema: List } }, description: "Removed." },
    ...errorResponses({ 401: "Not signed in", 404: "No such list or item" }),
  },
});
listsRoutes.openapi(removeItemRoute, (c) => {
  const actor = c.get("person");
  const { id, itemId } = c.req.valid("param");
  const result = removeItem(actor, id, itemId);
  if (!result.ok) return c.json({ error: result.error }, 404);
  return c.json(result.value, 200);
});

const clearRoute = createRoute({
  method: "post",
  path: "/{id}/clear",
  tags: ["Lists"],
  summary: "Remove every item, keeping the list itself - the batch clear-all affordance",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "list-a1b2c3") },
  responses: {
    200: { content: { "application/json": { schema: List } }, description: "Cleared." },
    ...errorResponses({ 401: "Not signed in", 404: "No such list" }),
  },
});
listsRoutes.openapi(clearRoute, (c) => {
  const actor = c.get("person");
  const result = clearList(actor, c.req.valid("param").id);
  if (!result.ok) return c.json({ error: result.error }, 404);
  return c.json(result.value, 200);
});
