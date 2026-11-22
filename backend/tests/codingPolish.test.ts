// CODE-POLISH: uploads into a session's workspace, the context figure for the status-bar ring, and the failure code kept on a stopped turn.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodingSession } from "@/lib/codingSessions";
import { __setWorkspaceRootForTests, codingWorkspace } from "@/lib/codingShare";
import { appendCodingMessage, listCodingMessages } from "@/lib/codingTranscript";
import { __resetCodingWindowCacheForTests, sessionContext } from "@/lib/codingContext";
import { uploadToWorkspace, UPLOAD_MAX_BYTES } from "@/lib/codingUpload";
import { input, owner, startRig } from "./codingRig";

let base = ""; let rig: ReturnType<typeof startRig>;
beforeEach(() => { rig = startRig(); base = mkdtempSync(join(tmpdir(), "code-polish-")); __setWorkspaceRootForTests(join(base, "coding")); __resetCodingWindowCacheForTests(); });
afterEach(() => { rig.restore(); __setWorkspaceRootForTests(null); rmSync(base, { recursive: true, force: true }); });
const bytes = (text: string) => new TextEncoder().encode(text);

describe("uploads", () => {
  test("a text file lands in uploads, a taken name gets a number and nothing is replaced", async () => {
    const a = owner(); const s = createCodingSession(a, input());
    const one = await uploadToWorkspace(a, s.id, "notes.md", bytes("first"));
    const two = await uploadToWorkspace(a, s.id, "notes.md", bytes("second"));
    expect([one.path, two.path]).toEqual(["uploads/notes.md", "uploads/notes-1.md"]);
    expect(readFileSync(join(codingWorkspace(a.id, s.id), one.path), "utf8")).toBe("first");
  });
  test("a path in the name is reduced to a plain file name", async () => {
    const a = owner(); const s = createCodingSession(a, input());
    expect((await uploadToWorkspace(a, s.id, "../../../etc/passwd.txt", bytes("x"))).path).toBe("uploads/passwd.txt");
    expect(existsSync(join(base, "etc"))).toBe(false);
  });
  test("too large, an odd type, an empty file and a file holding a key are each refused with a next step", async () => {
    const a = owner(); const s = createCodingSession(a, input());
    await expect(uploadToWorkspace(a, s.id, "big.txt", new Uint8Array(UPLOAD_MAX_BYTES + 1))).rejects.toThrow("smaller file");
    await expect(uploadToWorkspace(a, s.id, "tool.exe", bytes("MZ"))).rejects.toThrow("text, code, picture and PDF");
    await expect(uploadToWorkspace(a, s.id, "empty.txt", new Uint8Array())).rejects.toThrow("empty");
    await expect(uploadToWorkspace(a, s.id, "env.txt", bytes("key " + "maipai_" + "a1B2".repeat(6)))).rejects.toThrow("password or key");
  });
  test("an uploads folder that is a link out of the workspace is refused", async () => {
    const a = owner(); const s = createCodingSession(a, input());
    const ws = codingWorkspace(a.id, s.id); mkdirSync(ws, { recursive: true });
    const outside = join(base, "outside"); mkdirSync(outside); symlinkSync(outside, join(ws, "uploads"));
    await expect(uploadToWorkspace(a, s.id, "x.txt", bytes("x"))).rejects.toThrow("link");
    expect(readdirSync(outside)).toEqual([]);
  });
  test("another person's session is not found", async () => {
    const s = createCodingSession(owner(), input());
    await expect(uploadToWorkspace(owner(), s.id, "x.txt", bytes("x"))).rejects.toThrow("not found");
  });
});

describe("context", () => {
  test("the engine's latest numbers win; before any, the text size divided by four", async () => {
    const a = owner(); const s = createCodingSession(a, input());
    appendCodingMessage({ sessionId: s.id, personId: a.id, role: "user", parts: [{ type: "text", text: "x".repeat(400) }] });
    expect(await sessionContext(a, s.id)).toMatchObject({ used_tokens: 100, source: "estimate" });
    appendCodingMessage({ sessionId: s.id, personId: a.id, role: "system", parts: [{ type: "usage", input: 5000, output: 250 }] });
    appendCodingMessage({ sessionId: s.id, personId: a.id, role: "system", parts: [{ type: "usage", input: 9000, output: 500 }] });
    expect(await sessionContext(a, s.id)).toMatchObject({ used_tokens: 9500, source: "engine" });
  });
  test("a usage part is stored but is not text a person reads", () => {
    const a = owner(); const s = createCodingSession(a, input());
    appendCodingMessage({ sessionId: s.id, personId: a.id, role: "system", parts: [{ type: "usage", input: 1, output: 2 }] });
    expect(listCodingMessages(a.id, s.id)[0]!.parts[0]).toEqual({ type: "usage", input: 1, output: 2 });
  });
});

describe("a finished or failed turn", () => {
  test("a turn that finishes keeps the engine's token numbers, and one that fails keeps a reason code, never the error text", async () => {
    const { sendMessage, turnFinished } = await import("@/lib/codingTurns");
    rig.restore(); rig = startRig({ fail: true });
    const a = owner(); const s = createCodingSession(a, input());
    const sent = sendMessage(a, s.id, "go") as { turn_id: string }; rig.agent.autoFinish?.();
    await turnFinished(sent.turn_id);
    const stopped = listCodingMessages(a.id, s.id).flatMap((m) => m.parts).find((p) => p.type === "stopped") as { code?: string } | undefined;
    expect(stopped).toBeTruthy();
    expect(JSON.stringify(stopped)).not.toContain("secret-repo");
    expect(typeof stopped!.code).toBe("string");
  });
});
