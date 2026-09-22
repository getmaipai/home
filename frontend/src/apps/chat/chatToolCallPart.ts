import type { ThreadAssistantMessagePart } from "@assistant-ui/react";

// A review on slice 5(a) caught this: the same tool-call-part object
// literal (structured_part, artifact, sources) was hand-built five times
// across chatModelAdapter.ts and chatHistoryAdapter.ts - one definition,
// one place (getmaipai/.github's platform principle 1). Every package
// these results come from already ran server-side before the reply ever
// streamed, so `args`/`argsText` are always empty: the wire never carries
// a tool's own call arguments, only its result.
export function toolCallPart<TResult>(toolCallId: string, toolName: string, result: TResult): Extract<ThreadAssistantMessagePart, { type: "tool-call" }> {
  return { type: "tool-call", toolCallId, toolName, args: {}, argsText: "", result };
}
