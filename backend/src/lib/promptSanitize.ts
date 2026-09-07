// Shared by turnEngine.ts and memoryJudge.ts (SEC-8, code review,
// 2026-09-06: a self-editable displayName interpolated into a prompt is
// an injection vector - one definition, not a hand-copied second one).
// Pulled out of turnEngine.ts into its own leaf module rather than left
// there: turnEngine.ts pulls in persona.ts, which pulls in plugins.ts,
// which (via packageHost.ts -> scheduler.ts -> memoryJudge.ts) closes a
// real import cycle the moment memoryJudge.ts imports this function from
// turnEngine.ts directly - a TDZ crash ("Cannot access 'manifestCache'
// before initialization") whenever the module graph happened to resolve
// persona.ts's own eager PERSONAS catalog before plugins.ts's module
// body had finished running. This function has no dependencies of its
// own, so it costs nothing to give it a module none of that chain runs
// through.
export function sanitizeForPrompt(text: string): string {
  return text.replace(/[\r\n{}]/g, " ").trim();
}
