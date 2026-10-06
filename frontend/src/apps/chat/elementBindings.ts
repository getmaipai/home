// SHARED-THREAD-01: the ONE registry of which Element renders what in the chat
// thread. ChatThread.tsx reads it, and ChatThread is the only thing the chat
// page (NextChatPage) and the /dev/ui showcase (NextUiShowcasePage) render for
// the thread, so a binding added here shows up in both with no second edit.
//
// How to add an Element:
//   1. Add the binding here: a tool id in TOOL_BINDINGS (the tool-call part's
//      toolName and the component that renders its result), or a slot in
//      THREAD_SLOTS (the kit Thread's `components` map: reasoning groups,
//      message footer, action bar, composer pieces).
//   2. Add a showcase fixture for it (backend/src/lib/uiFixtures.ts) so the
//      playground has a scenario that exercises it.
//   Nothing else: not NextChatPage, not NextUiShowcasePage. The guard test
//   (chatThreadShared.test.ts) fails if either page imports the kit's Thread.
//   A new renderer component goes in chatToolUis.tsx (tool results) or
//   chatThreadSlots.tsx (slots); a new context it reads needs a safe default in
//   chatThreadContexts.ts, because the showcase mounts without the chat page's
//   providers.
//
// The Elements adoption scanner (scripts/elementsAdoption.ts) counts direct
// `@maipai/ui/src/elements/...` imports from Home source; test and dev files
// are excluded. This registry documents which chat renderers compose each
// Element, while the scanner reports imports mechanically.
import type { DataMessagePartComponent, ToolCallMessagePartComponent } from "@assistant-ui/react";
import {
  AssistantMoreItems,
  ChatComposerNotice,
  ChatMessageQueue,
  ChatThinkingIndicator,
  ComposerExtraControls,
  ComposerModelSelector,
  MessageFooterExtra,
  NextChatWelcome,
  NextReasoningGroup,
  FailedTurnActionBarExtras,
} from "@/apps/chat/chatThreadSlots";
import { ChatMessageError } from "@/apps/chat/chatErrorSlot";
import { ChatCitationLink } from "@/apps/chat/chatCitationLink";
import { ArtifactCardToolRender, ConfirmToolRender, ProjectToolRender, SourcesNoopRender, SpecSheetToolRender, ToolTimelineToolRender } from "@/apps/chat/chatToolUis";
import { ComposerAddMenu } from "@/apps/chat/composerAddMenu";
import { ComposerDictationWaveform } from "@/apps/chat/composerDictationWaveform";
import { preprocessChatMarkdown } from "@/apps/chat/chatStreamingMarkdown";
import { ANSWER_IMAGES_PART, AnswerImagesDataRender } from "@/apps/chat/chatAnswerImages";
export type ToolBinding = {
  /** The tool-call part's `toolName` on the wire (chatModelAdapter.ts). */
  toolName: string;
  /** The shipped Element the renderer composes, for the adoption audit. */
  element: string;
  // The renderers carry their own result types; the registry stores them erased.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous result shapes, each renderer types its own
  render: ToolCallMessagePartComponent<any, any>;
};

// `display: "standalone"` is applied to every binding (ChatThread): without it
// Thread's chain-of-thought grouping tucks a tool-call part behind a collapsed
// "1 tool call" trigger (found live: a weather card nobody can see without an
// extra click is a real regression for a family hub, not a cosmetic nit).
// Any tool id not listed here still renders through Thread's own ToolFallback.
export const TOOL_BINDINGS: readonly ToolBinding[] = [
  { toolName: "weather", element: "spec-sheet", render: SpecSheetToolRender },
  { toolName: "almanac-date", element: "spec-sheet", render: SpecSheetToolRender },
  { toolName: "write_document", element: "artifact-card", render: ArtifactCardToolRender },
  { toolName: "confirm", element: "tool-fallback (Approval)", render: ConfirmToolRender },
  { toolName: "project", element: "job-progress", render: ProjectToolRender },
  { toolName: "tool_timeline", element: "tool-timeline", render: ToolTimelineToolRender },
  { toolName: "sources", element: "sources", render: SourcesNoopRender },
];

export type DataBinding = {
  /** The data part's `name` on the wire. */
  name: string;
  /** The shipped Element the renderer composes, for the adoption audit. */
  element: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each renderer types its own data shape
  render: DataMessagePartComponent<any>;
};

// ANSWER-IMG-04: named `data` parts render in place, where the hub put them
// in the reply (between two text parts), through the shipped Element.
export const DATA_BINDINGS: readonly DataBinding[] = [
  { name: ANSWER_IMAGES_PART, element: "image-gallery", render: AnswerImagesDataRender },
];

// The kit Thread's `components` slots. Per-page behaviour (what a sent edit
// does, whether the model picker is allowed) is a ChatThread prop, never a
// different component here.
export const THREAD_SLOTS = {
  markdown: {
    components: { a: ChatCitationLink },
    preprocess: preprocessChatMarkdown,
    remend: { links: false, linkMode: "text-only" },
  },
  Welcome: NextChatWelcome,
  AssistantMoreItems,
  // The kit's append slot accepts one Element; compose both product
  // controls here, with failed-turn diagnostics last in the row.
  AssistantActionBarExtra: FailedTurnActionBarExtras,
  AssistantMessageFooterExtra: MessageFooterExtra,
  Indicator: ChatThinkingIndicator,
  MessageError: ChatMessageError,
  ComposerAddAttachmentOverride: ComposerAddMenu,
  ComposerQueue: ChatMessageQueue,
  // CHAT-CALM-ERRORS-01d: the one quiet line under the composer while chat
  // cannot answer; renders nothing while chat is ready.
  ComposerNotice: ChatComposerNotice,
  // VOICE-LIVE-01: the trailing-side append point beside Send/dictate;
  // ComposerVoiceControls gates its own render on stt+tts being ready.
  ComposerExtraEnd: ComposerExtraControls,
  // VOICE-LIVE-04b: owns the composer's text-field region (waveform or a real
  // ComposerPrimitive.Input), so it is unconditional.
  ComposerInputOverride: ComposerDictationWaveform,
  ReasoningGroup: NextReasoningGroup,
} as const;

// The composer's model selector renders nothing under two models, so the
// showcase (no model list) shows no picker; the chat page gates it further on
// its own `modelPickerAllowed`.
export const MODEL_SELECTOR_SLOT = ComposerModelSelector;
