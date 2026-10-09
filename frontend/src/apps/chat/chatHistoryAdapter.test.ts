import { afterEach, describe, expect, test, mock } from "bun:test";
import { chosenBranchHeadId, createChatHistoryAdapter, rowsToBranchableMessages } from "@/apps/chat/chatHistoryAdapter";
import type { ConversationTurnWithMemoryIds } from "@/lib/api";
import { SHOWCASE_BLOCKS } from "@maipai/home-backend/src/lib/uiFixtureBlocks";
import type { Source } from "@maipai/spec/gen/ts/source.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function makeRow(id: string, replyText: string, memoryIds: string[] = [], supersedes: string | null = null, branch: { parentTurnId?: string | null; branchChosen?: boolean; hlc?: string } = {}): ConversationTurnWithMemoryIds {
  return {
    id,
    personId: "person-abc123",
    surface: "chat",
    userText: `question ${id}`,
    replyText,
    source: "model",
    pluginId: null,
    commandId: null,
    safetyFlagged: false,
    safetyAction: "allow",
    minorSpeaker: false,
    createdAt: "2026-09-04T00:00:00.000Z",
    supersedes,
    ...branch,
    judgeStatus: null,
    memory_ids: memoryIds,
  } as ConversationTurnWithMemoryIds;
}

// Flattens a rowsToBranchableMessages() result into the same
// {message, parentId}[] shape ExportedMessageRepository.fromBranchableArray()
// consumes, so a test can assert on parent links directly.
function flatten(turns: ReturnType<typeof rowsToBranchableMessages>) {
  return turns.flatMap((t) => [t.user, t.reply]);
}

describe("rowsToBranchableMessages", () => {
  test("one row becomes a user message and a reply message, oldest first", () => {
    const rows = [makeRow("row-1", "first reply"), makeRow("row-2", "second reply")]; // per-thread route is oldest first
    const items = flatten(rowsToBranchableMessages(rows, "Nova", "conv-example123"));
    expect(items.map(({ message }) => message.id)).toEqual(["row-1-user", "row-1-reply", "row-2-user", "row-2-reply"]);
    expect(items[0]!.message).toMatchObject({ role: "user", content: "question row-1" });
    expect(items[1]!.message).toMatchObject({ role: "assistant", content: "first reply", status: { type: "complete", reason: "stop" } });
  });

  test("a sent quote reloads from its stored markdown text without rebuilding quote metadata", () => {
    const row = { ...makeRow("row-quote", "answer"), userText: "> quoted words\n\nCan you explain?" };
    const user = flatten(rowsToBranchableMessages([row], "Nova", "conv-example123"))[0]!.message;

    expect(user.content).toBe("> quoted words\n\nCan you explain?");
    expect(user.metadata?.custom?.quote).toBeUndefined();
  });

  // SAFETY-NOTICE-01: crisis resources a reply carried stay beside it after a reload.
  test("a reply that carried crisis resources gets its support block back on reload; others get none", () => {
    const support = { title: "Support is available", text: "Call or text 988.", actions: [{ label: "Call 988", href: "tel:988" }] };
    const row = { ...makeRow("row-1", "I'm glad you told me."), crisis_support: support } as ConversationTurnWithMemoryIds;
    const items = flatten(rowsToBranchableMessages([row, makeRow("row-2", "plain")], "Nova", "conv-example123"));
    expect((items[1]!.message.metadata as { custom: { crisisSupport?: unknown } }).custom.crisisSupport).toEqual(support);
    expect((items[3]!.message.metadata as { custom: { crisisSupport?: unknown } }).custom.crisisSupport).toBeUndefined();
  });

  // UPLOAD-IMG-02: a reopened chat shows the person's sent pictures the
  // way the live send did, as the kit's image attachments above the
  // bubble, loaded from the hub's own store by id (never a data: URL).
  test("a stored turn's sent pictures come back as image attachments on the person's message", () => {
    const images = [
      { id: "file-robot0001", name: "robot.jpg", width: 640, height: 480, media_type: "image/jpeg" },
      { id: "file-picker002", name: "picker.png", width: 800, height: 600, media_type: "image/jpeg" },
    ];
    const row = { ...makeRow("row-1", "a reply"), images } as ConversationTurnWithMemoryIds;
    const items = flatten(rowsToBranchableMessages([row, makeRow("row-2", "plain")], "Nova", "conv-example123"));
    expect(items[0]!.message.attachments).toEqual([
      { id: "file-robot0001", type: "image", name: "robot.jpg", contentType: "image/jpeg", status: { type: "complete" }, content: [{ type: "image", image: "/api/attachments/file-robot0001?v=full&conversation_id=conv-example123", filename: "robot.jpg" }] },
      { id: "file-picker002", type: "image", name: "picker.png", contentType: "image/jpeg", status: { type: "complete" }, content: [{ type: "image", image: "/api/attachments/file-picker002?v=full&conversation_id=conv-example123", filename: "picker.png" }] },
    ]);
    // A turn with no pictures carries no attachments at all.
    expect(items[2]!.message.attachments).toBeUndefined();
  });

  test("each pair carries the row's real id as metadata.custom.turnId - what remember/forget attribute to", () => {
    const items = flatten(rowsToBranchableMessages([makeRow("row-1", "a reply")], "Nova", "conv-example123"));
    expect(items[0]!.message.metadata!.custom!.turnId).toBe("row-1");
    expect(items[1]!.message.metadata!.custom!.turnId).toBe("row-1");
  });

  // CHAT-CALM-ERRORS-01c: a reloaded failed reply is flagged for the one
  // details control, from what the row itself says (its `failed` status, or
  // an admin's raw generation error or failed outcome); a clean row is not.
  test("a reloaded failed row is flagged for the details control; a clean row is not", () => {
    const failedRow = { ...makeRow("row-1", "The AI was stopped."), status: "failed" } as ConversationTurnWithMemoryIds;
    const toolRow = { ...makeRow("row-2", "I could not look that up."), outcomes: JSON.stringify([{ callId: "c1", packageId: "websearch", status: "failed" }]) } as unknown as ConversationTurnWithMemoryIds;
    const cleanRow = { ...makeRow("row-3", "Hello."), status: "done", outcomes: null } as unknown as ConversationTurnWithMemoryIds;
    const items = flatten(rowsToBranchableMessages([failedRow, toolRow, cleanRow], "Nova", "conv-example123"));
    expect(items[1]!.message.metadata!.custom).toMatchObject({ failedGeneration: true, failedTool: false });
    expect(items[3]!.message.metadata!.custom).toMatchObject({ failedGeneration: false, failedTool: true });
    expect(items[5]!.message.metadata!.custom).toMatchObject({ failedGeneration: false, failedTool: false });
  });

  // SHELL-02 slice 4: canvas-split's own acceptance ("this slice must
  // survive reload") - a row carrying `artifact` ({id, version},
  // conversationHistory.ts's own reload-path twin of the live `done`
  // event) becomes the same real tool-call part chatModelAdapter.ts
  // builds live, alongside the reply text (not instead of it).
  test("a row carrying an artifact becomes a real tool-call part alongside the reply text, card before prose", () => {
    const row = { ...makeRow("row-1", "Wrote it."), artifact: { id: "art-example123", version: 2 } };
    const items = flatten(rowsToBranchableMessages([row], "Nova", "conv-example123"));
    expect(items[1]!.message.content).toEqual([
      { type: "tool-call", toolCallId: "row-1-artifact", toolName: "write_document", args: {}, argsText: "", result: { id: "art-example123", version: 2 } },
      { type: "text", text: "Wrote it." },
    ]);
  });

  test("a row with no artifact keeps the plain reply text, unchanged", () => {
    const items = flatten(rowsToBranchableMessages([makeRow("row-1", "just a reply")], "Nova", "conv-example123"));
    expect(items[1]!.message.content).toBe("just a reply");
  });

  // getmaipai/home#182: a background project's finished document attaches
  // to the same turn row that already produced its "Starting…" reply
  // (backend/src/lib/projects/post.ts's postProjectResult()) - the reply
  // genuinely came first in time, so its card belongs AFTER the reply
  // text, the opposite order from the synchronous write_document case
  // above. Told apart by which tool answered the turn: a row whose
  // pluginId is "start_project" (backend/src/lib/projects/tool.ts's
  // START_PROJECT_TOOL_ID) never mints its own artifact, so one riding
  // such a row can only be the project's own result, attached later.
  test("a project-attached artifact (pluginId start_project) becomes a real tool-call part AFTER the reply text", () => {
    const row = { ...makeRow("row-1", "Starting Bedtime story now - 3 steps, about a minute."), pluginId: "start_project", artifact: { id: "art-example123", version: 1 } };
    const items = flatten(rowsToBranchableMessages([row], "Nova", "conv-example123"));
    expect(items[1]!.message.content).toEqual([
      { type: "text", text: "Starting Bedtime story now - 3 steps, about a minute." },
      { type: "tool-call", toolCallId: "row-1-artifact", toolName: "write_document", args: {}, argsText: "", result: { id: "art-example123", version: 1 } },
    ]);
  });

  // Regression coverage for #182's fix: an artifact riding a row whose
  // pluginId is the write_document package itself (the synchronous
  // case, packageHost.ts's own `artifact.create()`) keeps the existing
  // card-before-prose order, unchanged by the project-ordering branch
  // just added above.
  test("a synchronous write_document artifact (pluginId write_document) still renders BEFORE the reply text", () => {
    const row = { ...makeRow("row-1", "Wrote it."), pluginId: "write_document", artifact: { id: "art-example456", version: 1 } };
    const items = flatten(rowsToBranchableMessages([row], "Nova", "conv-example123"));
    expect(items[1]!.message.content).toEqual([
      { type: "tool-call", toolCallId: "row-1-artifact", toolName: "write_document", args: {}, argsText: "", result: { id: "art-example456", version: 1 } },
      { type: "text", text: "Wrote it." },
    ]);
  });

  // PROJECT-PROGRESS-01: a row carrying `project` ({id}, conversationHistory.ts's
  // own reload-path twin of the live `done` event's `TurnValue.project`)
  // becomes the same real tool-call part chatModelAdapter.ts builds live -
  // `toolName: "project"`. AFTER the reply text, not before, since
  // 2026-09-27 (a code review caught this still card-before-prose after
  // chatModelAdapter.ts's own live "done" event moved to card-after-text:
  // the two disagreeing meant a reload catching a still-running project
  // visibly relocated the exact card the live/reload-of-a-finished-project
  // fix was supposed to stop doing).
  test("a row carrying a project becomes a real tool-call part alongside the reply text, card after prose", () => {
    const row = { ...makeRow("row-1", "Starting a bedtime story now."), project: { id: "proj-example123" } };
    const items = flatten(rowsToBranchableMessages([row], "Nova", "conv-example123"));
    expect(items[1]!.message.content).toEqual([
      { type: "text", text: "Starting a bedtime story now." },
      { type: "tool-call", toolCallId: "row-1-project", toolName: "project", args: {}, argsText: "", result: { id: "proj-example123" } },
    ]);
  });

  test("a row with no project keeps the plain reply text, unchanged", () => {
    const items = flatten(rowsToBranchableMessages([makeRow("row-1", "just a reply")], "Nova", "conv-example123"));
    expect(items[1]!.message.content).toBe("just a reply");
  });

  // getmaipai/home#130: the weather/almanac card disappeared after a
  // reload - a row carrying `structured_part` becomes the same real
  // tool-call part chatModelAdapter.ts builds live from the done event,
  // riding before the text part (the reference card reads above its own
  // sentence, chatModelAdapter.ts's own live ordering: reasoning,
  // structured, artifact, text, sources).
  test("a row carrying a structured part becomes a real tool-call part before the reply text", () => {
    const structuredPart = { kind: "spec_sheet" as const, tool_id: "weather", title: "Seattle", rows: [{ label: "Now", value: "57°F, partly cloudy" }] };
    const row = { ...makeRow("row-1", "It's 57 and partly cloudy."), structured_part: structuredPart };
    const items = flatten(rowsToBranchableMessages([row], "Nova", "conv-example123"));
    expect(items[1]!.message.content).toEqual([
      { type: "tool-call", toolCallId: "row-1-structured", toolName: "weather", args: {}, argsText: "", result: structuredPart },
      { type: "text", text: "It's 57 and partly cloudy." },
    ]);
  });

  test("a row with no structured part keeps the plain reply text, unchanged", () => {
    const items = flatten(rowsToBranchableMessages([makeRow("row-1", "just a reply")], "Nova", "conv-example123"));
    expect(items[1]!.message.content).toBe("just a reply");
  });

  // APPROVE-CARD-01: `row.confirm` is the reload-path twin of the live
  // "done" event's own `TurnValue.confirm` (chatModelAdapter.ts) -
  // conversationHistory.ts's own listConversationTurns()/list() already
  // derive `open` fresh on every read (never trusted from what was
  // stored at write time), so `row.confirm.open` here is already
  // correct by the time it reaches this adapter - no additional
  // freshness handling needed.
  test("a row carrying an open confirm becomes a real tool-call part under the reply text (APPROVE-CALM-01)", () => {
    const row = { ...makeRow("row-1", "Go ahead and lock the doors?"), confirm: { package_id: "lock-doors", open: true } };
    const items = flatten(rowsToBranchableMessages([row], "Nova", "conv-example123"));
    expect(items[1]!.message.content).toEqual([
      { type: "text", text: "Go ahead and lock the doors?" },
      { type: "tool-call", toolCallId: "row-1-confirm", toolName: "confirm", args: {}, argsText: "", result: { package_id: "lock-doors", open: true, turn_id: "row-1" } },
    ]);
  });

  test("a row carrying an answered (closed) confirm still becomes a tool-call part, with open: false", () => {
    const row = { ...makeRow("row-1", "Go ahead and lock the doors?"), confirm: { package_id: "lock-doors", open: false } };
    const items = flatten(rowsToBranchableMessages([row], "Nova", "conv-example123"));
    expect(items[1]!.message.content).toEqual([
      { type: "text", text: "Go ahead and lock the doors?" },
      { type: "tool-call", toolCallId: "row-1-confirm", toolName: "confirm", args: {}, argsText: "", result: { package_id: "lock-doors", open: false, turn_id: "row-1" } },
    ]);
  });

  test("a row with no confirm keeps the plain reply text, unchanged", () => {
    const items = flatten(rowsToBranchableMessages([makeRow("row-1", "just a reply")], "Nova", "conv-example123"));
    expect(items[1]!.message.content).toBe("just a reply");
  });

  // REASONING-04 (safety ruling, 2026-09-22): a reloaded adult turn shows
  // the answer and a Reasoning block, never "<think>" - conversationHistory.ts's
  // own read-side gate is what ensures `row.reasoning` is only ever
  // present when it should be; this proves the reload path renders it
  // through the same Reasoning Element a live turn uses (reasoning-part
  // first, chatModelAdapter.ts's own live ordering), not that it's a raw
  // string sitting in the reply text.
  test("a row carrying reasoning becomes a real reasoning part before the reply text - a reloaded adult turn shows the answer and a Reasoning block, never <think>", () => {
    const row = { ...makeRow("row-1", "17 times 24 is 408."), reasoning: "carry the two" };
    const items = flatten(rowsToBranchableMessages([row], "Nova", "conv-example123"));
    expect(items[1]!.message.content).toEqual([
      { type: "reasoning", text: "carry the two" },
      { type: "text", text: "17 times 24 is 408." },
    ]);
    const text = JSON.stringify(items[1]!.message.content);
    expect(text).not.toContain("<think>");
  });

  // A minor's own row never carries `reasoning` at all (conversationHistory.ts's
  // write path, REASONING-04) - a reloaded child turn shows the answer
  // and no reasoning, the plain reply text unchanged, same as any other
  // row with nothing extra to attach.
  test("a row with no reasoning shows the answer and no reasoning - a reloaded child turn", () => {
    const items = flatten(rowsToBranchableMessages([makeRow("row-1", "17 times 24 is 408.")], "Nova", "conv-example123"));
    expect(items[1]!.message.content).toBe("17 times 24 is 408.");
  });

  test("a row carrying sources becomes native source parts after the reply text", () => {
    const sources: Source[] = [{ id: "src-1", kind: "web", title: "A page", url: "https://example.com/a", site: "example.com", snippet: null, source: "row-1", created_at: "2026-09-13T00:00:00Z", hlc: "1757000000000:0:abc123" }];
    const row = { ...makeRow("row-1", "High tide is at 4pm."), sources };
    const items = flatten(rowsToBranchableMessages([row], "Nova", "conv-example123"));
    expect(items[1]!.message.content).toEqual([
      { type: "text", text: "High tide is at 4pm." },
      { type: "source", sourceType: "url", id: "src-1", url: "https://example.com/a", title: "A page" },
    ]);
  });

  // GENUI-03b: the stored answer blocks come back as the same `answer_block`
  // data parts the live stream built, in tool-call order, before the text.
  test("a row carrying answer blocks reloads them in tool-call order, before the text", () => {
    const [sheet, table, chart] = SHOWCASE_BLOCKS;
    const row = { ...makeRow("row-1", "Here you go."), blocks: [table!, sheet!, chart!] };
    const items = flatten(rowsToBranchableMessages([row], "Nova", "conv-example123"));
    expect(items[1]!.message.content).toEqual([
      { type: "data", name: "answer_block", data: table },
      { type: "data", name: "answer_block", data: sheet },
      { type: "data", name: "answer_block", data: chart },
      { type: "text", text: "Here you go." },
    ]);
  });

  test("a stored block of an unknown kind is dropped on reload and the reply still loads", () => {
    const [sheet] = SHOWCASE_BLOCKS;
    const row = { ...makeRow("row-1", "Still here."), blocks: [{ ...sheet!, id: "blk-zzzzzz", kind: "hologram" }, sheet!] } as unknown as ConversationTurnWithMemoryIds;
    const items = flatten(rowsToBranchableMessages([row], "Nova", "conv-example123"));
    expect(items[1]!.message.content).toEqual([{ type: "data", name: "answer_block", data: sheet }, { type: "text", text: "Still here." }]);
    const only = { ...makeRow("row-2", "Plain."), blocks: [{ id: "x", kind: "hologram" }] } as unknown as ConversationTurnWithMemoryIds;
    expect(flatten(rowsToBranchableMessages([only], "Nova", "conv-example123"))[1]!.message.content).toEqual([{ type: "text", text: "Plain." }]);
  });

  test("a row with an empty sources array keeps the plain reply text, unchanged", () => {
    const row = { ...makeRow("row-1", "just a reply"), sources: [] };
    const items = flatten(rowsToBranchableMessages([row], "Nova", "conv-example123"));
    expect(items[1]!.message.content).toBe("just a reply");
  });

  test("a row without sources maps without source parts and does not crash", () => {
    const items = flatten(rowsToBranchableMessages([makeRow("row-1", "a reply")], "Nova", "conv-example123"));
    expect(items[1]!.message.content).toBe("a reply");
  });

  test("a reloaded feedback verdict marks the matching assistant message selected", () => {
    const items = flatten(rowsToBranchableMessages([makeRow("row-1", "a reply")], "Nova", "conv-example123", new Map([["row-1", "negative"]])));
    expect(items[1]!.message.metadata?.submittedFeedback).toEqual({ type: "negative" });
  });

  test("empty history maps to an empty thread", () => {
    expect(rowsToBranchableMessages([], "Nova", "conv-example123")).toEqual([]);
  });

  test("a safety-refused turn still renders both sides, not swallowed", () => {
    const row = { ...makeRow("row-1", "I can't help with that."), source: "safety_refuse" };
    const items = flatten(rowsToBranchableMessages([row], "Nova", "conv-example123"));
    expect(items[1]!.message).toMatchObject({ role: "assistant", content: "I can't help with that." });
  });

  test("a linear chain: each row's user message parents off the previous row's reply", () => {
    const rows = [makeRow("row-1", "first reply"), makeRow("row-2", "second reply")];
    const items = flatten(rowsToBranchableMessages(rows, "Nova", "conv-example123"));
    expect(items[0]).toMatchObject({ parentId: null }); // the very first message in the conversation
    expect(items[1]).toMatchObject({ parentId: "row-1-user" });
    expect(items[2]).toMatchObject({ parentId: "row-1-reply" }); // row-2's user message follows row-1's reply
  });

  // getmaipai/home#60: an edited-and-resent message is a real new
  // conversation_turns row with its own id and `supersedes` pointing at
  // the row it replaces - not a rewrite of the old one. The old row's own
  // user message and the new row's user message must land as SIBLINGS
  // (the same parentId) for BranchPickerPrimitive to show "1/2, 2/2"
  // instead of two separate exchanges after a reload.
  test("a row with supersedes becomes a sibling branch of the row it replaces, not a child of it", () => {
    const rows = [makeRow("row-1", "original reply"), makeRow("row-2", "edited reply", [], "row-1")];
    const turns = rowsToBranchableMessages(rows, "Nova", "conv-example123");
    const items = flatten(turns);
    const originalUser = items.find(({ message }) => message.id === "row-1-user")!;
    const editedUser = items.find(({ message }) => message.id === "row-2-user")!;
    expect(editedUser.parentId).toBe(originalUser.parentId); // same parent = siblings = a branch, not a new exchange
    expect(editedUser.parentId).toBeNull(); // both are the conversation's very first message
  });

  test("a normal turn sent after an edit chains off the edited (newest) reply, not the original", () => {
    const rows = [makeRow("row-1", "original reply"), makeRow("row-2", "edited reply", [], "row-1"), makeRow("row-3", "third reply")];
    const items = flatten(rowsToBranchableMessages(rows, "Nova", "conv-example123"));
    const row3User = items.find(({ message }) => message.id === "row-3-user")!;
    expect(row3User.parentId).toBe("row-2-reply"); // the edit is the conversation's current path going forward
  });

  test("a second edit of the same slot chains off the same anchor as the first edit", () => {
    const rows = [
      makeRow("row-1", "original reply"),
      makeRow("row-2", "first edit", [], "row-1"),
      makeRow("row-3", "second edit", [], "row-1"),
    ];
    const items = flatten(rowsToBranchableMessages(rows, "Nova", "conv-example123"));
    const row1User = items.find(({ message }) => message.id === "row-1-user")!;
    const row3User = items.find(({ message }) => message.id === "row-3-user")!;
    expect(row3User.parentId).toBe(row1User.parentId); // a third sibling under the same original parent
  });

  test("explicit branch state replays the chosen root-to-head path while retaining every sibling", () => {
    const rows = [
      makeRow("row-1", "original reply", [], null, { parentTurnId: null, branchChosen: false, hlc: "100:0:node" }),
      makeRow("row-2", "edited reply", [], "row-1", { parentTurnId: null, branchChosen: true, hlc: "101:0:node" }),
      makeRow("row-3", "follow-up reply", [], null, { parentTurnId: "row-2", branchChosen: true, hlc: "102:0:node" }),
      makeRow("row-4", "old branch follow-up", [], null, { parentTurnId: "row-1", branchChosen: true, hlc: "103:0:node" }),
    ];
    const items = flatten(rowsToBranchableMessages(rows, "Nova", "conv-example123"));
    expect(chosenBranchHeadId(rows)).toBe("row-3-reply");
    expect(items.map(({ message }) => message.id)).toEqual([
      "row-1-user", "row-1-reply", "row-2-user", "row-2-reply",
      "row-3-user", "row-3-reply", "row-4-user", "row-4-reply",
    ]);
    expect(items.find(({ message }) => message.id === "row-4-user")!.parentId).toBe("row-1-reply");
  });

  test("a persisted choice can move the replay head to a retained sibling's descendant", () => {
    const rows = [
      makeRow("row-1", "original reply", [], null, { parentTurnId: null, branchChosen: true, hlc: "100:0:node" }),
      makeRow("row-2", "edited reply", [], "row-1", { parentTurnId: null, branchChosen: false, hlc: "101:0:node" }),
      makeRow("row-3", "old branch follow-up", [], null, { parentTurnId: "row-1", branchChosen: true, hlc: "102:0:node" }),
    ];
    expect(chosenBranchHeadId(rows)).toBe("row-3-reply");
  });

  // Lane 11 item 1's own acceptance: "never persisted, never in history."
  // chatTurnActivity.ts's `activity` field only ever exists on a message
  // still streaming live (chatModelAdapter.ts) - a reloaded row has no
  // source for it at all (no such column on ConversationTurnWithMemoryIds),
  // so this is a guard against a future edit accidentally adding one, not
  // a behavior that's ever been possible to trigger today.
  test("a reloaded reply's metadata never carries a live-only activity line", () => {
    const items = flatten(rowsToBranchableMessages([makeRow("row-1", "an ordinary reply")], "Nova", "conv-example123"));
    const reply = items.find(({ message }) => message.id === "row-1-reply")!;
    expect(reply.message.metadata?.custom).not.toHaveProperty("activity");
  });
});

describe("createChatHistoryAdapter", () => {
  test("load restores settings from the conversation record for the active thread", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/conversations/conv-example123/turns")) return Promise.resolve(Response.json([]));
      if (url.endsWith("/api/conversations/conv-example123")) {
        return Promise.resolve(Response.json({ id: "conv-example123", settings: { thinking: true, model: "chat-primary", future_option: "preserved" } }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const loaded: Array<{ id: string; settings: unknown }> = [];
    try {
      const adapter = createChatHistoryAdapter("Nova", () => "conv-example123", (id, settings) => loaded.push({ id, settings }));
      await adapter.load();
      expect(loaded).toEqual([{ id: "conv-example123", settings: { thinking: true, model: "chat-primary", future_option: "preserved" } }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a conversation without stored settings reports the default state as absent", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/conversations/conv-default123/turns")) return Promise.resolve(Response.json([]));
      if (url.endsWith("/api/conversations/conv-default123")) return Promise.resolve(Response.json({ id: "conv-default123" }));
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    let loadedSettings: unknown = "not-called";
    try {
      const adapter = createChatHistoryAdapter("Nova", () => "conv-default123", (_id, settings) => { loadedSettings = settings; });
      await adapter.load();
      expect(loadedSettings).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("load() builds an ExportedMessageRepository from GET /api/conversations/conv-example123/turns", async () => {
    // Asserts the real path, not just "any fetch resolves" - a code
    // review-adjacent finding (session E step 5, 2026-09-06): the
    // previous version of this mock matched every URL unconditionally,
    // which is exactly why a real, live bug (this call still hitting the
    // bare /api/conversations after that route's own shape changed
    // out from under it, backend/src/routes/conversations.ts's own
    // comment) went uncaught by this suite.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/conversations/conv-example123/turns")) {
        return Promise.resolve(new Response(JSON.stringify([makeRow("row-1", "a reply")]), { status: 200 }));
      }
      if (url.endsWith("/api/conversations/turns/row-1/feedback")) {
        return Promise.resolve(new Response(JSON.stringify({ id: "rf-abc123", turn_id: "row-1", person_id: "person-abc123", verdict: "up", reason: null, source: "test", created_at: "2026-09-04T00:00:00.000Z", hlc: "1756944000000:0:abc123" }), { status: 200 }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const adapter = createChatHistoryAdapter("Nova", () => "conv-example123");
      const repo = await adapter.load();
      expect(repo.messages.map(({ message }) => message.id)).toEqual(["row-1-user", "row-1-reply"]);
      expect(repo.messages[1]!.message.metadata?.submittedFeedback).toEqual({ type: "positive" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("append is a no-op - the backend already persists every turn", async () => {
    const adapter = createChatHistoryAdapter("Nova", () => "conv-example123");
    await expect(adapter.append({ parentId: null } as never)).resolves.toBeUndefined();

  });
});

test("a new unsaved chat starts empty without reading any other conversation", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = mock(() => { throw new Error("New chat must not fetch history"); }) as unknown as typeof fetch;
  try {
    expect((await createChatHistoryAdapter("Nova", () => undefined).load()).messages).toEqual([]);
  } finally { globalThis.fetch = original; }
});
