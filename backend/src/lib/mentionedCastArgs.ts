// CREATOR-05: the structured `@` mentions a media tool call receives. A call that names no cast gets the ones the person picked from the list. Kept out of
// the turn machine (which holds no entertainment words) and free of imports so it loads anywhere.
const MEDIA_TOOLS = new Set(["generate_image", "generate_video", "make_film", "make_reference_video"]);

export function withMentionedCast<T extends Record<string, unknown>>(tool: string, args: T, ids: readonly string[] | undefined): T & { cast?: string[] } {
  if (!MEDIA_TOOLS.has(tool) || !ids?.length || args.cast !== undefined) return args;
  return { ...args, cast: [...ids] };
}
