import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptEntries, isProtected, planBatches, reviewList, stackOnlyFetch, translateCatalog, validateTranslation, type Fetch } from "./translate-catalog";
import { parsePo } from "./po";

const STACK = "http://127.0.0.1:8770";
const HEADER = 'msgid ""\nmsgstr ""\n"Language: es\\n"\n\n';
const entry = (file: string, id: string, msgstr = "", flag = "") => `#: ${file}:1\n${flag}msgid ${JSON.stringify(id)}\nmsgstr ${JSON.stringify(msgstr)}\n`;

function setup(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "maipai-translate-"));
  const poPath = join(dir, "messages.po");
  writeFileSync(poPath, HEADER + body);
  return { dir, poPath };
}

/** A fake Stack: roles answer, chat answers from `reply`, every chat prompt is recorded. */
function fakeStack(state: string, reply: (prompt: string) => unknown) {
  const prompts: string[] = [];
  const fetchFn: Fetch = async (url, init) => {
    if (url.endsWith("/stack/v1/roles")) return Response.json({ roles: [{ id: "chat", state: { state } }] });
    const prompt = JSON.parse(String(init?.body)).messages[0].content as string;
    prompts.push(prompt);
    return Response.json({ choices: [{ message: { content: JSON.stringify(reply(prompt)) } }] });
  };
  return { fetchFn, prompts };
}

const echo = (prompt: string) => [...prompt.matchAll(/\{"id":"((?:[^"\\]|\\.)*)","from"/g)].map((m) => ({ id: JSON.parse(`"${m[1]}"`), msgstr: `ES ${JSON.parse(`"${m[1]}"`)}` }));
const glossary = { dialect: "neutral", style: ["plain"], Library: { es: "Biblioteca" } };

describe("validateTranslation", () => {
  test("keeps placeholders, refuses em dashes and empty text", () => {
    expect(validateTranslation("Saved {name}", "Guardado {name}")).toBeNull();
    expect(validateTranslation("Saved {name}", "Guardado")).toBe("placeholders differ");
    expect(validateTranslation("{count, plural, one {# item} other {# items}}", "{count, plural, one {# cosa} other {# cosas}}")).toBeNull();
    expect(validateTranslation("Hello", "Hola — amigo")).toBe("em dash");
    expect(validateTranslation("Hello", "")).toBe("empty");
  });
});

describe("planBatches", () => {
  test("one batch per source file, split past the limit", () => {
    const entries = parsePo(HEADER + entry("a.tsx", "A1") + "\n" + entry("b.tsx", "B1") + "\n" + entry("a.tsx", "A2") + "\n" + entry("b.tsx", "B2") + "\n" + entry("b.tsx", "B3"));
    expect(planBatches(entries).map((b) => [b.file, b.entries.map((e) => e.id)])).toEqual([["a.tsx", ["A1", "A2"]], ["b.tsx", ["B1", "B2", "B3"]]]);
    expect(planBatches(entries, 2).map((b) => b.entries.length)).toEqual([2, 2, 1]);
  });
});

describe("translateCatalog with a fake Stack", () => {
  test("fills with the flag, sends one request per file, and uses the glossary", async () => {
    const { dir, poPath } = setup(entry("src/a.tsx", "Save") + "\n" + entry("src/b.tsx", "Open") + "\n" + entry("src/a.tsx", "Close") + "\n" + entry("src/c.tsx", "Done", "Hecho"));
    const stack = fakeStack("ready", echo);
    const { text, report } = await translateCatalog({ locale: "es", poPath, glossary, stackUrl: STACK, fetch: stack.fetchFn });
    expect(stack.prompts.length).toBe(2);
    expect(stack.prompts[0]).toContain("Biblioteca");
    expect(report.filled.sort()).toEqual(["Close", "Open", "Save"]);
    const parsed = parsePo(text);
    expect(parsed.find((e) => e.id === "Save")).toMatchObject({ msgstr: "ES Save", flags: ["needs-review"] });
    expect(parsed.find((e) => e.id === "Done")).toMatchObject({ msgstr: "Hecho", flags: [] });
    rmSync(dir, { recursive: true });
  });

  test("an explicit key id is translated from its en-US text, and minor failure lines are refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maipai-translate-"));
    mkdirSync(join(dir, "es")); mkdirSync(join(dir, "en-US"));
    const poPath = join(dir, "es", "messages.po");
    writeFileSync(poPath, HEADER + entry("../backend/src/lib/failureCopy.ts", "failure.busy.adult") + "\n" + entry("../backend/src/lib/failureCopy.ts", "failure.busy.minor"));
    writeFileSync(join(dir, "en-US", "messages.po"), HEADER + entry("../backend/src/lib/failureCopy.ts", "failure.busy.adult", "One moment. Send that again in a bit.") + "\n" + entry("../backend/src/lib/failureCopy.ts", "failure.busy.minor", "One moment. Try again soon."));
    const stack = fakeStack("ready", (prompt) => [...prompt.matchAll(/\{"id":"([^"]+)","from":\[[^\]]*\],"text":"([^"]+)"\}/g)].map((m) => ({ id: m[1], msgstr: `ES ${m[2]}` })));
    const { text, report } = await translateCatalog({ locale: "es", poPath, glossary, stackUrl: STACK, fetch: stack.fetchFn });
    expect(stack.prompts[0]).toContain("One moment. Send that again in a bit.");
    expect(report.filled).toEqual(["failure.busy.adult"]);
    expect(report.refused).toEqual(["failure.busy.minor"]);
    expect(parsePo(text).find((e) => e.id === "failure.busy.adult")).toMatchObject({ msgstr: "ES One moment. Send that again in a bit.", flags: ["needs-review"] });
    expect(parsePo(text).find((e) => e.id === "failure.busy.minor")?.msgstr).toBe("");
    rmSync(dir, { recursive: true });
  });

  test("a reviewed entry is never overwritten", async () => {
    const { dir, poPath } = setup(entry("src/a.tsx", "Save", "Guardar"));
    const stack = fakeStack("ready", echo);
    const { text } = await translateCatalog({ locale: "es", poPath, glossary, stackUrl: STACK, fetch: stack.fetchFn });
    expect(stack.prompts.length).toBe(0);
    expect(parsePo(text)[0]).toMatchObject({ msgstr: "Guardar", flags: [] });
    rmSync(dir, { recursive: true });
  });

  test("refuses to write child, teen, crisis, consent, refusal, spoken clip, robot and SEARCH-DOWN-EMPTY-01 lines", async () => {
    const protectedLines = [["src/child/Setup.tsx", "Pick a name"], ["src/teen/Home.tsx", "Hi"], ["src/crisis.tsx", "Call someone"], ["src/consent.tsx", "Agree"], ["src/refusal.tsx", "No"], ["src/spoken/clip.tsx", "Hello there"], ["src/robot/Face.tsx", "Beep"], ["src/search.tsx", "SEARCH-DOWN-EMPTY-01"]];
    const { dir, poPath } = setup(protectedLines.map(([file, id]) => entry(file!, id!)).join("\n") + "\n" + entry("src/ok.tsx", "Save"));
    const stack = fakeStack("ready", echo);
    const { text, report } = await translateCatalog({ locale: "es", poPath, glossary, stackUrl: STACK, fetch: stack.fetchFn });
    expect(report.refused.length).toBe(8);
    expect(report.filled).toEqual(["Save"]);
    expect(stack.prompts.join("")).not.toContain("Call someone");
    for (const e of parsePo(text).filter((e) => e.id !== "Save")) expect(e).toMatchObject({ msgstr: "", flags: [] });
    expect(isProtected(["src/x.tsx:1"], "Plain")).toBe(false);
    rmSync(dir, { recursive: true });
  });

  test("refuses when chat is not ready and writes nothing", async () => {
    const { dir, poPath } = setup(entry("src/a.tsx", "Save"));
    const before = readFileSync(poPath, "utf8");
    const stack = fakeStack("loaded", echo);
    const { text, report } = await translateCatalog({ locale: "es", poPath, glossary, stackUrl: STACK, fetch: stack.fetchFn });
    expect(report.stopped).toContain("not ready");
    expect(stack.prompts.length).toBe(0);
    expect(text).toBe(before);
    rmSync(dir, { recursive: true });
  });

  test("a bad answer (lost placeholder, em dash) is retried once alone, then left empty and listed", async () => {
    const { dir, poPath } = setup(entry("src/a.tsx", "Saved {name}") + "\n" + entry("src/a.tsx", "Hello"));
    const stack = fakeStack("ready", (prompt) => echo(prompt).map((r) => (r.id === "Saved {name}" ? { ...r, msgstr: "Guardado" } : { ...r, msgstr: "Hola — hola" })));
    const { text, report } = await translateCatalog({ locale: "es", poPath, glossary, stackUrl: STACK, fetch: stack.fetchFn });
    expect(stack.prompts.length).toBe(3);
    expect(report.failed.sort()).toEqual(["Hello", "Saved {name}"]);
    expect(parsePo(text).every((e) => e.msgstr === "")).toBe(true);
    rmSync(dir, { recursive: true });
  });

  test("dry run sends nothing, and max-batches limits the run", async () => {
    const { dir, poPath } = setup(entry("src/a.tsx", "A") + "\n" + entry("src/b.tsx", "B"));
    const stack = fakeStack("ready", echo);
    const dry = await translateCatalog({ locale: "es", poPath, glossary, stackUrl: STACK, fetch: stack.fetchFn, dryRun: true });
    expect(dry.report.batches).toBe(2);
    expect(stack.prompts.length).toBe(0);
    const one = await translateCatalog({ locale: "es", poPath, glossary, stackUrl: STACK, fetch: stack.fetchFn, maxBatches: 1 });
    expect(one.report.filled).toEqual(["A"]);
    rmSync(dir, { recursive: true });
  });

  test("no request leaves for any host but the Stack", async () => {
    const guarded = stackOnlyFetch(STACK, async () => new Response("{}"));
    expect(() => guarded("https://example.com/v1/chat/completions")).toThrow("only the Stack");
    expect((await guarded(`${STACK}/stack/v1/roles`)).ok).toBe(true);
  });
});

describe("accept and review", () => {
  test("--accept clears the flag by id or by file", () => {
    const text = HEADER + entry("src/a.tsx", "Save", "Guardar", "#, needs-review\n") + "\n" + entry("src/b.tsx", "Open", "Abrir", "#, needs-review\n");
    const byId = acceptEntries(text, "Save");
    expect(parsePo(byId.text).map((e) => e.flags)).toEqual([[], ["needs-review"]]);
    expect(acceptEntries(text, "src/b.tsx").accepted).toEqual(["Open"]);
  });

  test("the review list shows the translation with a back translation", async () => {
    const { dir, poPath } = setup(entry("src/a.tsx", "Save", "Guardar", "#, needs-review\n"));
    const stack = fakeStack("ready", () => [{ id: "Save", msgstr: "Save (back)" }]);
    const list = await reviewList({ locale: "es", poPath, stackUrl: STACK, fetch: stack.fetchFn });
    expect(list).toContain("Guardar");
    expect(list).toContain("Save (back)");
    rmSync(dir, { recursive: true });
  });
});
