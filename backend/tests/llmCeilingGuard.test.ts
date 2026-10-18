import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { join } from "node:path";
import { reasoningReserveFor, __resetLearnedCeilingsForTests } from "@/lib/reasoningReserve";
import { complete, completeBackground, completeViaStackRequest } from "@/lib/llm";
import { __setRoleHealthForTests } from "@/lib/roleHealth";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import type { StackClient } from "@/lib/stack/client";

const ALWAYS = "muse-glimmer-30b-mlx-4bit";
afterEach(() => { __setRoleHealthForTests({}); __resetStackEngineForTests(); __resetLearnedCeilingsForTests(); });

// Only these engine dispatch functions may set total generation ceilings.
const WRAPPER_ENTRY_POINTS: Record<string, string[]> = {
  "lib/llm.ts": ["stackRequestOnce", "openStackPieces", "completeOnce", "startDirectTokens"],
};
function engineBypasses(file: string, source: string): string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const failures: string[] = [];
  const clients = new Set(["client", "getStackClient()"]);
  // Follow ordinary client aliases, including chains, before checking calls.
  let changed = true;
  while (changed) {
    changed = false;
    const aliases = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && clients.has(node.initializer.getText(ast)) && !clients.has(node.name.text)) {
        clients.add(node.name.text); changed = true;
      }
      ts.forEachChild(node, aliases);
    };
    aliases(ast);
  }
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const method = ts.isPropertyAccessExpression(expression) ? expression.name.text
        : ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression) ? expression.argumentExpression.text : undefined;
      const receiver = ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression) ? expression.expression.getText(ast) : "";
      if (method && (["chatComplete", "chatCompleteStream"].includes(method) || (method === "chat" && (clients.has(receiver) || /max_tokens/.test(node.getText(ast)))))) {
        let parent: ts.Node | undefined = node.parent;
        const allowed = WRAPPER_ENTRY_POINTS[file] ?? [];
        let name: string | undefined;
        let permitted = false;
        while (parent) {
          if (ts.isFunctionDeclaration(parent)) {
            name ??= parent.name?.text;
            if (allowed.includes(parent.name?.text ?? "")) permitted = true;
          }
          parent = parent.parent;
        }
        const line = ast.getLineAndCharacterOfPosition(node.getEnd()).line;
        const annotated = /\/\/ (answer-budget\b|exact-ceiling: .+|stream-ceiling: .+)/.test(node.getText(ast) + (source.split("\n")[line] ?? ""));
        if (!permitted && !annotated) failures.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}: ${name ?? "anonymous"} bypasses answer-budget wrappers (${Object.entries(WRAPPER_ENTRY_POINTS).map(([path, names]) => `${path}: ${names.join("/")}`).join(", ")})`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return failures;
}

test("engine requests route through the named wrappers and declare answer budgets", async () => {
  const src = join(import.meta.dir, "../src");
  const missing: string[] = [];
  let files = 0;
  let declarations = 0;
  for await (const file of new Bun.Glob("**/*.{ts,tsx,js,jsx}").scan(src)) {
    files++;
    const source = readFileSync(join(src, file), "utf8");
    missing.push(...engineBypasses(file, source));
    if (["lib/llm.ts", "lib/reasoningReserve.ts", "routes/llm.ts", "wire.ts", "lib/turnStats.ts"].includes(file)) continue;
    // Wrapper callers are not direct engine requests. In particular, the
    // existing streaming turn ceilings stay local and unchanged.
    declarations += (source.match(/\/\/ (answer-budget\b|exact-ceiling: .+|stream-ceiling: .+)/g) ?? []).length;
  }
  expect(files).toBeGreaterThan(0);
  expect(declarations).toBeGreaterThan(0);
  expect(missing).toEqual([]);
});
for (const request of ["{ max_tokens: 120 }", "{ max_tokens }", "{ ['max_tokens']: 120 }", "{ ...request }"]) {
  test(`guard rejects direct engine request ${request}`, () => {
    for (const receiver of ["client", "getStackClient()", "stack"])
      expect(engineBypasses("lib/bypass.ts", `function bypass() { const stack = getStackClient(); ${receiver}.chat(${request}); }`)[0]).toContain("lib/bypass.ts:1: bypass");
    expect(engineBypasses("lib/bypass.ts", `function bypass() { const stack = getStackClient(); stack["chat"](${request}); }`)[0]).toContain("lib/bypass.ts:1: bypass");
    expect(engineBypasses("lib/llm.ts", `async function stackRequestOnce() { client.chat(${request}); }`)).toEqual([]);
  });
}

test("all always-thinking role records reserve room; other records do not", () => {
  for (const role of ["chat", "judge", "router", "vision", "coding"]) {
    const record = { id: `fixture-${role}`, thinking_mode: "always" };
    expect(reasoningReserveFor(record, 120)).toBe(1024);
    expect(reasoningReserveFor(record, 2048)).toBe(4096);
  }
  expect(reasoningReserveFor({ thinking_mode: "none" }, 120)).toBe(0);
  expect(reasoningReserveFor({ thinking_mode: "switchable" }, 120)).toBe(0);
  expect(reasoningReserveFor({ thinking_mode: "always" }, 120, { contextTokens: 1000, promptTokens: 800 })).toBe(80);
  expect(reasoningReserveFor({ thinking_mode: "always" }, 120, { contextTokens: 1000, promptTokens: 1000 })).toBe(0);
  expect(reasoningReserveFor({ thinking_mode: "always" }, 100000)).toBe(32768);
});

function engine(contents: string[], stream = false, model = ALWAYS, stopReason?: string) {
  const ceilings: number[] = [];
  __setRoleHealthForTests({ chat: { availability: "ready", reason: null, modelId: model }, background: { availability: "ready", reason: null, modelId: model } });
  __setStackClientForTests({ chat: async (request: { max_tokens: number }) => {
    ceilings.push(request.max_tokens);
    const content = contents[Math.min(ceilings.length - 1, contents.length - 1)]!;
    const finish_reason = stopReason ?? (content ? "stop" : "length");
    if (!stream) return { data: { model, choices: [{ finish_reason, message: { content, reasoning_content: "private", tool_calls: [] } }] }, identity: null };
    const rows = [{ choices: [{ delta: { reasoning_content: "private" }, finish_reason: null }] }, { choices: [{ delta: { content }, finish_reason }] }];
    return { headers: new Headers(), stream: new ReadableStream({ start(controller) { for (const row of rows) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(row)}\n\n`)); controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); controller.close(); } }) };
  } } as unknown as StackClient);
  return ceilings;
}

test("blocking empty length gets exactly one larger retry then typed failure", async () => {
  const ceilings = engine([""]);
  const result = await complete("chat", [{ role: "user", content: "hello" }], { max_tokens: 120, dropReasoning: true });
  expect(ceilings).toEqual([1144, 2168]);
  expect(result.ok).toBe(false);
  if (!result.ok) { expect(result.code).toBe("unavailable"); expect(result.reason).toBe("empty_length"); }
});
test("blocking retry recovers and non-thinking models keep the answer budget", async () => {
  let ceilings = engine(["", "answer"]);
  const result = await complete("chat", [{ role: "user", content: "hello" }], { max_tokens: 120 });
  expect(result.ok && result.value.text).toBe("answer");
  expect(ceilings).toEqual([1144, 2168]);
  ceilings = engine(["answer"], false, "qwen3-8b-instruct-q4-k-m");
  await complete("chat", [{ role: "user", content: "hello" }], { max_tokens: 120 });
  expect(ceilings).toEqual([120]);
});
test("exact smoke ceiling is preserved and does not retry", async () => {
  const ceilings = engine([""]);
  await complete("chat", [{ role: "user", content: "hello" }], { max_tokens: 1, exactCeiling: true }); // exact-ceiling: smoke test exercises opt-out.
  expect(ceilings).toEqual([1]);
});
test("background judge and raw picture calls share the reserve and retry", async () => {
  const ceilings = engine(["", "answer"]);
  expect(await completeBackground([{ role: "user", content: "hello" }], { max_tokens: 120 })).toEqual({ ok: true, text: "answer" });
  expect(ceilings).toEqual([1144, 2168]);
  const raw = engine([""]);
  const result = await completeViaStackRequest("chat", { model: "chat", messages: [{ role: "user", content: "hello" }], max_tokens: 120 });
  expect(result.ok).toBe(false);
  expect(raw).toEqual([1144, 2168]);
});

test("measured context bounds the initial ceiling and retry, including picture tokens", async () => {
  const ceilings = engine([""]);
  __setRoleHealthForTests({ chat: { availability: "ready", reason: null, modelId: ALWAYS, contextPerSlot: 600 } });
  const result = await complete("chat", [{ role: "user", content: "hello", images: [{ id: "fixture", name: "photo", url: "data:image/jpeg;base64,AAAA", reservedTokens: 200 }] }], { max_tokens: 120 });
  expect(result.ok).toBe(false);
  expect(ceilings).toHaveLength(1);
  expect(ceilings[0]).toBeLessThanOrEqual(600 - 200);

});
test("nonempty length replies never retry", async () => {
  const ceilings = engine(["answer"], false, ALWAYS, "length");
  await complete("chat", [{ role: "user", content: "hello" }], { max_tokens: 120 });
  expect(ceilings).toEqual([1144]);
});

test("an unknown model that spends its ceiling invisibly gets a reserve on later calls", async () => {
  const ceilings = engine(["", "answer"], false, "future-fixture-model");
  const messages = [{ role: "user" as const, content: "hello" }];
  await complete("chat", messages, { max_tokens: 120 });
  await complete("chat", messages, { max_tokens: 120 });
  expect(ceilings).toEqual([120, 2168, 1144]);
});

test("background smoke callers can opt out of reserve and retry", async () => {
  const ceilings = engine([""]);
  const result = await completeBackground([{ role: "user", content: "hello" }], { max_tokens: 1, exactCeiling: true }); // exact-ceiling: smoke test exercises the background opt-out.
  expect(result.ok).toBe(false);
  expect(ceilings).toEqual([1]);
});

test("non-thinking requests preserve the exact budget even with a tiny context", async () => {
  const ceilings = engine(["answer"], false, "qwen3-8b-instruct-q4-k-m");
  __setRoleHealthForTests({ chat: { availability: "ready", reason: null, modelId: "qwen3-8b-instruct-q4-k-m", contextPerSlot: 32 } });
  await complete("chat", [{ role: "user", content: "界".repeat(1000) }], { max_tokens: 4096 });
  expect(ceilings).toEqual([4096]);
});

test("planning never makes a roles request, including with no cached role", async () => {
  let roles = 0;
  let generations = 0;
  __setRoleHealthForTests({});
  __setStackClientForTests({ roles: async () => { roles++; throw new Error("unexpected role read"); }, chat: async () => {
    generations++;
    return { identity: null, data: { choices: [{ finish_reason: "stop", message: { content: "answer" } }] } };
  } } as unknown as StackClient);
  await complete("chat", [{ role: "user", content: "hello" }], { model: ALWAYS, max_tokens: 120 });
  expect(generations).toBe(1);
  expect(roles).toBe(0);
});

for (const material of ["unicode", "tools", "schema", "pictures", "wire pictures"] as const) {
  test(`context failure accounts for ${material} and never dispatches a zero ceiling`, async () => {
    const ceilings = engine(["answer"]);
    __setRoleHealthForTests({ chat: { availability: "ready", reason: null, modelId: ALWAYS, contextPerSlot: 500 } });
    const content = material === "unicode" ? "界😀".repeat(1000) : "hello";
    const messages = [{ role: "user" as const, content: material === "wire pictures" ? [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } }] : content,
      ...(material === "pictures" ? { images: [{ id: "photo", name: "photo", url: "data:image/jpeg;base64,AAAA", reservedTokens: 500 }] } : {}) }];
    const result = material === "wire pictures" ? await completeViaStackRequest("chat", { model: "chat", messages: messages as never, max_tokens: 120 }) : await complete("chat", messages as Parameters<typeof complete>[1], { max_tokens: 120,
      ...(material === "tools" ? { tools: [{ id: "fixture", description: "schema".repeat(1000), args: { type: "object" } }] } : {}),
      ...(material === "schema" ? { response_format: { type: "json_schema" as const, json_schema: { name: "fixture", schema: { description: "schema".repeat(1000) } } } } : {}),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect("failure" in result ? result.failure.reason : result.reason).toBe("context_too_large");
    expect(ceilings).toEqual([]);
  });
}

test("learned ceilings clear on engine build change", async () => {
  const { setCeilingEngineIdentity, rememberCeilingSpentInvisibly, emptyLengthRetryCount } = await import("@/lib/reasoningReserve");
  setCeilingEngineIdentity({ host: "stub", build: "one", model: "unknown" });
  rememberCeilingSpentInvisibly("unknown");
  expect(reasoningReserveFor("unknown", 120)).toBe(1024);
  setCeilingEngineIdentity({ host: "stub", build: "two", model: "unknown" });
  expect(reasoningReserveFor("unknown", 120)).toBe(0);
  __resetLearnedCeilingsForTests();
  expect(emptyLengthRetryCount()).toBe(0);
});

test("a reserve already at its maximum never repeats the same generation", async () => {
  const ceilings = engine([""]);
  const result = await complete("chat", [{ role: "user", content: "hello" }], { max_tokens: 20000 });
  expect(ceilings).toEqual([52768]);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("empty_length");
});

test("exact smoke failure does not learn or increment the retry counter", async () => {
  const { emptyLengthRetryCount } = await import("@/lib/reasoningReserve");
  engine([""], false, "unknown-smoke-model");
  await complete("chat", [{ role: "user", content: "hello" }], { max_tokens: 1, exactCeiling: true });
  expect(emptyLengthRetryCount()).toBe(0);
  expect(reasoningReserveFor("unknown-smoke-model", 120)).toBe(0);
});

test("a catalog non-thinking empty length never learns a new ceiling", async () => {
  const model = "qwen3-8b-instruct-q4-k-m";
  const ceilings = engine([""], false, model);
  await complete("chat", [{ role: "user", content: "hello" }], { max_tokens: 120 });
  expect(ceilings).toEqual([120]);
  expect(reasoningReserveFor(model, 120)).toBe(0);
});

test("non-streaming output is preserved without prose trimming", async () => {
  const text = "An unpunctuated title ".repeat(100);
  engine([text]);
  const result = await complete("chat", [{ role: "user", content: "hello" }], { max_tokens: 24 });
  expect(result.ok && result.value.text).toBe(text);
});

test("streaming keeps the caller ceiling and complete prose", async () => {
  const { startCompleteStreamPieces } = await import("@/lib/llm");
  const text = "A friendly sentence. ".repeat(100);
  const ceilings = engine([text], true);
  const result = await startCompleteStreamPieces("chat", [{ role: "user", content: "hello" }], { max_tokens: 120, dropReasoning: true });
  if (!result.ok) throw new Error(result.error);
  let released = "";
  for await (const piece of result.pieces) released += piece.text;
  expect(released).toBe(text);
  expect(ceilings).toEqual([120]);
});
