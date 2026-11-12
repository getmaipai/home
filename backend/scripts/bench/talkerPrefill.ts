// TALKER-FIRST-00: measure continuation of a trailing assistant prefill with
// Home's base tool schemas. Prompts are from CHAT-AB-01; no hub data is read.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeEngineUrl } from "@/lib/engineIdentity";
import { toolSpecFor } from "@/lib/turnMachine/nodes/model";
import { VIRTUAL_TOOL_REGISTRY } from "@/lib/projects/tool";
import { toToolDefinition, type ToolSpec } from "@/lib/llm";
import { createEngineActivity } from "./engineSettle";

const OPENER = "Okay, so.";
const SYSTEM = "You are a helpful assistant.";
const ROOT = new URL("../../", import.meta.url).pathname;
const DATASET = join(ROOT, "scripts/bench/datasets/chat-ab-01.json");
const PACKAGE_ROOT = join(ROOT, "packages");

type Message = { role: string; content: string };
type Prompt = { id: string; prompt: string };
type EngineConfig = { name: string; url?: string };
type RequestRecord = {
  engine: string; promptId: string; variant: "A" | "B"; prompt_n: number | null; cache_n: number | null;
  prompt_ms: number | null; wall_ms: number; finishReason: string | null; toolCallsParsed: boolean;
  continued?: boolean; repeatedOpener?: boolean; leadingSpace?: boolean; error?: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function messageFrom(reply: unknown): Record<string, unknown> {
  const choices = record(reply)?.choices;
  return record(Array.isArray(choices) ? choices[0]?.message : null) ?? {};
}

function contentOf(reply: unknown): string {
  const content = messageFrom(reply).content;
  return typeof content === "string" ? content : "";
}

function toolCallsOf(reply: unknown): unknown[] {
  const calls = messageFrom(reply).tool_calls;
  return Array.isArray(calls) ? calls : [];
}

export function judgeContinued(reply: unknown): boolean {
  const message = messageFrom(reply);
  const content = typeof message.content === "string" ? message.content : "";
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const startsAgain = content.toLocaleLowerCase().startsWith(OPENER.toLocaleLowerCase());
  const startsTemplate = /^(?:<\|im_start\|>|assistant\b|<think>)/i.test(content.trimStart());
  return !startsAgain && !startsTemplate && (content.length > 0 || calls.length > 0);
}

export function judgeRepeatedOpener(content: string, opener: string): boolean {
  return content.slice(0, 40).toLocaleLowerCase().includes(opener.toLocaleLowerCase());
}

export function leadingSpace(content: string): boolean {
  return content.startsWith(" ");
}

function toolsFromLocalBaseManifests(): ToolSpec[] {
  // The live offer builder depends on household settings and package status.
  // For a data-free bench, use local manifests marked `offer.mode: base` and
  // the model node's actual schema builder; dynamic/home-gated tools are out.
  const ids: string[] = [];
  for (const entry of readdirSync(PACKAGE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, entry.name, "manifest.json"), "utf8")) as {
        id?: unknown; offer?: { mode?: unknown };
      };
      if (manifest.offer?.mode === "base" && typeof manifest.id === "string") ids.push(manifest.id);
    } catch { /* directories without readable manifests are not packages */ }
  }
  const packageTools = ids.sort().map((id) => toolSpecFor(id)).filter((item): item is ToolSpec => item !== null);
  const virtualTools = VIRTUAL_TOOL_REGISTRY.filter((tool) => tool.offer.mode === "base").map((tool) => tool.spec());
  return [...packageTools, ...virtualTools];
}

function parseArgs(args: string[]): { engines: EngineConfig[]; n: number; out?: string } {
  const engines: EngineConfig[] = [
    { name: "splash", url: process.env.MAIPAI_SPLASH_URL },
    { name: "llama", url: process.env.MAIPAI_LLAMA_SERVER_URL ?? "http://127.0.0.1:8798" },
  ];
  let n = 20;
  let out: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--engine") {
      const value = args[++i];
      const split = value?.indexOf("=") ?? -1;
      if (split <= 0) throw new Error("--engine expects <name>=<url>");
      const item = { name: value!.slice(0, split), url: value!.slice(split + 1) };
      const existing = engines.findIndex((engine) => engine.name === item.name);
      if (existing >= 0) engines[existing] = item; else engines.push(item);
    } else if (arg === "--n") {
      n = Number(args[++i]);
      if (!Number.isInteger(n) || n < 1) throw new Error("--n must be a positive integer");
    } else if (arg === "--out") {
      out = args[++i];
      if (!out) throw new Error("--out expects a directory");
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return { engines, n, out };
}

async function send(url: string, messages: Message[], tools: ToolSpec[]): Promise<{ reply: unknown; wallMs: number }> {
  const body = {
    model: process.env.MAIPAI_CHAT_MODEL ?? "default", messages,
    tools: tools.map(toToolDefinition),
    tool_choice: "auto", chat_template_kwargs: { enable_thinking: false }, stream: false, max_tokens: 96,
  };
  const started = performance.now();
  const response = await fetch(`${url.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const wallMs = performance.now() - started;
  if (!response.ok) throw new Error(`engine answered ${response.status} ${response.statusText}`);
  return { reply: await response.json() as unknown, wallMs };
}

function metric(reply: unknown, key: string): number | null {
  const root = record(reply);
  const timings = record(root?.timings);
  const usage = record(root?.usage);
  const details = record(usage?.prompt_tokens_details);
  const value = key === "prompt_ms" ? timings?.prompt_ms ?? usage?.prompt_ms
    : key === "prompt_n" ? usage?.prompt_tokens ?? timings?.prompt_n
      : details?.cached_tokens ?? usage?.cache_n ?? timings?.cache_n;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toolParsed(reply: unknown): boolean {
  return toolCallsOf(reply).some((call) => typeof record(record(call)?.function)?.name === "string");
}

function median(values: Array<number | null>): number | null {
  const sorted = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function fmt(value: number | null): string { return value === null ? "n/a" : value.toFixed(1); }

function reportFor(name: string, rows: RequestRecord[], n: number): Record<string, unknown> {
  const a = rows.filter((row) => row.variant === "A" && !row.error);
  const b = rows.filter((row) => row.variant === "B" && !row.error);
  const promptA = median(a.map((row) => row.prompt_ms));
  const promptB = median(b.map((row) => row.prompt_ms));
  const extraPromptN = b.flatMap((row) => {
    const plain = a.find((candidate) => candidate.promptId === row.promptId);
    return row.prompt_n !== null && plain?.prompt_n !== null && plain?.prompt_n !== undefined ? [row.prompt_n - plain.prompt_n] : [];
  });
  return {
    engine: name, N: n,
    continued: `${b.filter((row) => row.continued).length}/${b.length}`,
    repeatedOpeners: b.filter((row) => row.repeatedOpener).length,
    leadingSpaceShare: `${b.filter((row) => row.leadingSpace).length}/${b.length}`,
    toolCallParseRate: `${a.filter((row) => row.toolCallsParsed).length}/${a.length} vs ${b.filter((row) => row.toolCallsParsed).length}/${b.length}`,
    medianPromptMsA: promptA, medianPromptMsB: promptB,
    promptMsDifference: promptA === null || promptB === null ? null : promptB - promptA,
    medianExtraPromptN: median(extraPromptN),
  };
}

async function main(): Promise<void> {
  const { engines, n, out } = parseArgs(process.argv.slice(2));
  const dataset = JSON.parse(readFileSync(DATASET, "utf8")) as { items: Array<{ id: string; prompt: string }> };
  const prompts: Prompt[] = dataset.items.slice(0, n).map(({ id, prompt }) => ({ id, prompt }));
  const tools = toolsFromLocalBaseManifests();
  const activity = createEngineActivity();
  const records: RequestRecord[] = [];
  let sentRequest = false;
  for (const engine of engines) {
    if (!engine.url) { console.log(`Skipped ${engine.name}: no URL configured`); continue; }
    const url = engine.url.replace(/\/$/, "");
    console.log(`Running ${engine.name} (${sanitizeEngineUrl(url)}) with ${prompts.length} prompts and ${tools.length} base tools`);
    let reachable = false;
    for (const prompt of prompts) {
      for (const variant of ["A", "B"] as const) {
        await activity.settle(0, 5_000);
        if (sentRequest) await new Promise((resolve) => setTimeout(resolve, 1_000));
        const messages: Message[] = [{ role: "system", content: SYSTEM }, { role: "user", content: prompt.prompt }];
        if (variant === "B") messages.push({ role: "assistant", content: OPENER });
        activity.begin();
        sentRequest = true;
        try {
          const { reply, wallMs } = await send(url, messages, tools);
          reachable = true;
          const content = contentOf(reply);
          const choices = record(reply)?.choices;
          const firstChoice = record(Array.isArray(choices) ? choices[0] : null);
          const row: RequestRecord = {
            engine: engine.name, promptId: prompt.id, variant, prompt_n: metric(reply, "prompt_n"),
            cache_n: metric(reply, "cache_n"), prompt_ms: metric(reply, "prompt_ms"), wall_ms: wallMs,
            finishReason: typeof firstChoice?.finish_reason === "string" ? firstChoice.finish_reason : null,
            toolCallsParsed: toolParsed(reply),
          };
          if (variant === "B") {
            row.continued = judgeContinued(reply);
            row.repeatedOpener = judgeRepeatedOpener(content, OPENER);
            row.leadingSpace = leadingSpace(content);
          }
          records.push(row);
        } catch (error) {
          records.push({ engine: engine.name, promptId: prompt.id, variant, prompt_n: null, cache_n: null, prompt_ms: null, wall_ms: 0, finishReason: null, toolCallsParsed: false, error: error instanceof Error ? error.message : String(error) });
          if (!reachable) { console.log(`Unreachable ${engine.name}: ${error instanceof Error ? error.message : String(error)}`); break; }
        } finally { activity.end(); }
      }
      if (!reachable && records.some((row) => row.engine === engine.name && row.error)) break;
    }
    if (reachable) console.log(`Completed ${engine.name}`);
  }
  const engineRows = engines.map((engine) => reportFor(engine.name, records.filter((row) => row.engine === engine.name), prompts.length));
  const headers = ["engine", "N", "continued", "repeated", "leading-space", "tool calls A vs B", "prompt ms A", "prompt ms B", "Δ prompt ms", "median extra prompt_n"];
  const table = [
    `| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`,
    ...engineRows.map((row) => `| ${row.engine} | ${row.N} | ${row.continued} | ${row.repeatedOpeners} | ${row.leadingSpaceShare} | ${row.toolCallParseRate} | ${fmt(row.medianPromptMsA as number | null)} | ${fmt(row.medianPromptMsB as number | null)} | ${fmt(row.promptMsDifference as number | null)} | ${fmt(row.medianExtraPromptN as number | null)} |`),
  ].join("\n");
  console.log(table);
  const outputDir = out ?? join(ROOT, "data-scratch/bench/talker-prefill", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "results.json"), `${JSON.stringify({ prompts: prompts.map((p) => p.id), tools: tools.map((tool) => tool.id), records, summary: engineRows }, null, 2)}\n`);
  writeFileSync(join(outputDir, "results.md"), `${table}\n`);
}

if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 0; });
