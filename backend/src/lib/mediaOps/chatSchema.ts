// The offered schemas for the picture tools, built per turn from the media operations registry, the person's saved
// subjects and the launch templates. Kept out of turnMachine/nodes/model.ts: these are structure keys for the model's
// tool call, not rules about the person's words (the rule-budget lint scans the turn-path files).
import { z } from "zod";
import { listMediaSubjects } from "@/lib/mediaSubjects";
import { listFragments, listTemplates } from "@/lib/media/templates";
import type { TurnState } from "@/lib/turnMachine/contract";

type ToolSpecLike = { id: string; description: string; args: Record<string, unknown> };
const MASK_KEYS = ["mask", "maskPng", "maskBase64", "maskPngBase64"];

export function editPictureSpec(id: string, state: TurnState | undefined): ToolSpecLike | null {
    if (!state?.editPictureAllowed) return null;
    const operations = state.editPictureOps ?? [];
    if (!operations.length) return null;
    const choices = operations.map((operation) => {
      const args = z.toJSONSchema(operation.args, { unrepresentable: "any" }) as Record<string, unknown>;
      const properties = args.properties && typeof args.properties === "object" ? { ...(args.properties as Record<string, unknown>) } : {};
      if (operation.id === "picture.change" && state.actor) {
        const subjects = listMediaSubjects(state.actor);
        properties.subjects = { type: "array", items: { type: "string", enum: subjects.map((item) => item.name) }, maxItems: 3, uniqueItems: true, description: `Optional saved subject names chosen by the person. Available to this person: ${subjects.map((item) => item.name).join(", ") || "none"}.` };
      }
      for (const key of MASK_KEYS) delete properties[key];
      const required = Array.isArray(args.required) ? args.required.filter((key) => typeof key !== "string" || !MASK_KEYS.includes(key)) : undefined;
      return {
        type: "object", required: ["op", "source", "args"],
        properties: {
          op: { type: "string", const: operation.id, description: operation.summary },
          source: { type: "string", enum: [...new Set([...(state.editPictureIds ?? []), ...(state.images ?? []).map((image) => image.id), "attached", "attached_2", "latest"])], description: "A picture id in this conversation, or exactly attached, attached_2, or latest." },
          args: { ...args, properties, ...(required ? { required } : {}), description: operation.summary },
        },
      };
    });
    return {
      id,
      description: "Use one of the available picture operations with its shown arguments. For locate, inspect the numbered boxes and pick by number only if the intended subject is clear; otherwise ask one short question.",
      args: {
        type: "object",
        properties: { op: { type: "string", enum: operations.map((operation) => operation.id), description: operations.map((operation) => `${operation.id}: ${operation.summary}`).join(" ") } },
        oneOf: choices,
      },
    };
}

export function generateImageSchema(args: Record<string, unknown>, description: string, state: TurnState): { args: Record<string, unknown>; description: string } {
    const templates = listTemplates({ actor: state.actor, kind: "picture" });
    const schema = structuredClone(args) as Record<string, any>;
    schema.properties ??= {};
    schema.required = (Array.isArray(schema.required) ? schema.required : []).filter((key: string) => key !== "prompt");
    schema.properties.template = { type: "string", enum: templates.map((row) => row.id), description: `Optional picture template id. Available to this person: ${templates.map((row) => `${row.id} (${row.title}; ${[...row.prompt.matchAll(/\{\{([a-z][a-z0-9_]*)\|([^|}]+)\|([^}]*)\}\}/g)].map((m) => `${m[1]}: ${m[2]} (example: ${m[3]})`).join(", ") || "no blanks"})`).join("; ")}` };
    schema.properties.blanks = { type: "object", additionalProperties: { type: "string" }, description: "Values for the named blanks shown in the selected template." };
    // CREATOR-13: one optional `presets` object, a key per family holding a record id (an enum of ids only, each id names its preset), so the schema stays
    // small and, being an object, is never read as free words by the grounding check.
    const presetProps: Record<string, unknown> = {};
    for (const [key, group] of [["look", "picture_look"], ["light", "relight"], ["angle", "angle"], ["format", "format"]] as const) {
      const ids = listFragments({ actor: state.actor, group }).map((row) => row.id);
      if (ids.length) presetProps[key] = { type: "string", enum: ids };
    }
    if (Object.keys(presetProps).length) schema.properties.presets = { type: "object", properties: presetProps, additionalProperties: false, description: "Optional look, light, camera angle and frame format, only if asked for." };
    const subjects = listMediaSubjects(state.actor);
    schema.properties.subjects = { type: "array", items: { type: "string", enum: subjects.map((item) => item.name) }, maxItems: 3, uniqueItems: true, description: `Optional. Name only subjects the person chose. Available to this person: ${subjects.map((item) => item.name).join(", ") || "none"}.` };
    args = schema;
    description = `${description} For a template, set its id and fill every named blank using the labels and examples in the template argument description; a free prompt is not needed. Otherwise provide prompt. The final filled prompt follows the same picture rules.`;
  return { args, description };
}
