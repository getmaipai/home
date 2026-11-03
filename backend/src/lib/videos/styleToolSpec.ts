// VIDEO-LORA-10 (docs/design/video-loras-2026-11-02.md 6.3 and 3.6): the `styles` argument of `generate_video` and `edit_video` as the model is offered it. The
// description lists, for this person on this screen, the all-ages styles they may use (at most 12 names of at most 24 characters, about 100 tokens); an adult-only
// or unknown-audience style is never listed, so the model cannot name one it was never told (the person's own typed name is how it is found, in styleChoice.ts).
// Where the person may use no style, or the screen is spoken or shared, or the person is a minor, the `styles` and `strength` arguments are not offered at all.
import type { ToolSpec } from "@/lib/llm";
import { listableStyleNames } from "./styleChoice";
import { videoAudienceOf } from "./tool";
import { EDIT_VIDEO_TOOL_ID } from "./editTool";
import { GENERATE_VIDEO_TOOL_ID } from "./tool";

type SpecState = Parameters<typeof videoAudienceOf>[0];

export function withStyleList(spec: ToolSpec, state: SpecState | undefined): ToolSpec {
  if (spec.id !== GENERATE_VIDEO_TOOL_ID && spec.id !== EDIT_VIDEO_TOOL_ID) return spec;
  const args = spec.args as { properties?: Record<string, { description?: string }> } | null;
  if (!args || typeof args !== "object" || !args.properties?.styles) return spec;
  const names = state ? listableStyleNames(videoAudienceOf(state, false)) : [];
  const properties = { ...args.properties };
  if (names.length === 0) {
    delete properties.styles;
    delete properties.strength;
  } else {
    properties.styles = { ...properties.styles!, description: `${properties.styles!.description ?? ""} Styles this person can use: ${names.join(", ")}.`.trim() };
  }
  return { ...spec, args: { ...args, properties } };
}
