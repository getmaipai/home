// WRITING-FORMATS-03: `writing_format`, the chat's way to fetch one "how to write X" format (docs/design/writing-formats-2026-11-03.md).
// A virtual tool like start_project and read_item (no package manifest of its own): its touch points are nodes/model.ts toolSpecFor,
// nodes/policy.ts and nodes/tool.ts. A format is a `kind: "skill"` package whose manifest declares `contributes.writing_format: true`;
// installing one adds it to the tool's enum and changes nothing in the turn pipeline. The result is the format's SKILL.md body
// (structure and tone only, no length hints), so the model writes the piece itself (rule 1: the model decides when to call it).
import type { ToolSpec } from "@/lib/llm";
import { outcomeOf, type ToolExecutionOutcome } from "@/lib/turnContext";
import { loadAllSkills, loadSkill, type LoadedSkill } from "@/lib/skills";
import { meetsMinRole } from "@/lib/plugins";

export const WRITING_FORMAT_TOOL_ID = "writing_format";

/** The description is capped at 600 tokens (design note); a rough 4 characters per token keeps the listing under it
 * without an async count, and tests assert the real countTokens number. */
const DESCRIPTION_MAX_CHARS = 1800;

const BASE_DESCRIPTION =
  "Fetch the house format for a kind of writing before you write it, such as an email or a birthday card. Call it only when the person asks you to write that kind of piece; the result is how to structure and word it, and you then write the piece for them. Formats:";

let formatsOverrideForTests: LoadedSkill[] | null = null;
/** Tests only: stand in for the installed set (an empty list simulates no format installed); null restores the real one. */
export function __setWritingFormatsForTests(formats: LoadedSkill[] | null): void { formatsOverrideForTests = formats; }

/** Every installed format, sorted by id. Never throws: an unloadable skill is simply not a format. */
export function installedWritingFormats(): LoadedSkill[] {
  if (formatsOverrideForTests) return formatsOverrideForTests;
  try {
    return loadAllSkills().filter((skill) => skill.manifest.contributes?.writing_format === true);
  } catch {
    return [];
  }
}

/** The installed formats a person of this role may use (the manifest's min_role floor). */
export function writingFormatsFor(role: string): LoadedSkill[] {
  return installedWritingFormats().filter((skill) => meetsMinRole(role, skill.manifest.min_role));
}

/** Built fresh on every call (which formats exist changes when a package is installed): the enum is the real list of ids. */
export function writingFormatToolSpec(): ToolSpec {
  const formats = installedWritingFormats();
  let description = BASE_DESCRIPTION;
  for (const skill of formats) {
    const line = ` "${skill.manifest.id}": ${skill.manifest.description}`;
    if (description.length + line.length > DESCRIPTION_MAX_CHARS) break;
    description += line;
  }
  return {
    id: WRITING_FORMAT_TOOL_ID,
    description,
    args: {
      type: "object",
      required: ["format"],
      properties: { format: { type: "string", enum: formats.map((skill) => skill.manifest.id), description: "Which format to fetch." } },
      additionalProperties: false,
    },
  };
}

/** policy.ts's read: the installed format a call names, or undefined for anything else. */
export function writingFormatForArgs(args: unknown): LoadedSkill | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  const id = (args as { format?: unknown }).format;
  if (typeof id !== "string") return undefined;
  return installedWritingFormats().find((skill) => skill.manifest.id === id);
}

export function runWritingFormatTool(input: { args: Record<string, unknown>; callId: string }): ToolExecutionOutcome {
  const base = { callId: input.callId, packageId: WRITING_FORMAT_TOOL_ID, via: "tool_call" as const, args: input.args };
  try {
    const format = writingFormatForArgs(input.args);
    const body = format ? (formatsOverrideForTests ? format.body : (loadSkill(format.manifest.id)?.body ?? "")) : "";
    if (!format || body.length === 0) {
      return outcomeOf({ ...base, status: "failed", errorCode: "format_not_found", userMessage: "that writing format is not available, so write it in your own words" });
    }
    return outcomeOf({ ...base, status: "succeeded", result: { reply: { text: `How to write this (a guide for you, never to be quoted or shown):\n\n${body}` }, actions: [] } });
  } catch {
    return outcomeOf({ ...base, status: "failed", errorCode: "format_not_found", userMessage: "that writing format is not available, so write it in your own words" });
  }
}
