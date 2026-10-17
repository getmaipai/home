// THIN-4F: the tool node marks a spoken turn's search with `spoken` (a recipe forwards it as a string, and an
// unset one stays "{spoken}"). The ONE parse of that flag. It is a hint carried in the arguments, never the
// authority for a safety decision: packageHost.ts derives "this is a spoken turn" from the turn's own surface
// (the `spoken` runtime option the tool node and the commands node set) and uses this flag only as a second signal.
export function wantsSpoken(input: { spoken?: unknown } | undefined): boolean {
  return input?.spoken === true || input?.spoken === "true";
}
