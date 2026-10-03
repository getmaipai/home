// THIN-7C: the scripted engine and the table snapshot the mode tests share
// (bare, attachments, temporary, supersedes, continuation), the same shape
// turnNext.test.ts uses, so each mode's test reads one request and one diff.
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import { startRecordingProxy } from "../../scripts/bench/conversationRunner";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { sqlite } from "@/db";

/** One scripted chat engine; `seen` collects every request it was sent. */
export async function withEngine<T>(reply: (request: ChatCompletionRequest) => string, fn: (seen: ChatCompletionRequest[]) => Promise<T>): Promise<T> {
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const seen: ChatCompletionRequest[] = [];
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (request) => {
      seen.push(request);
      return reply(request);
    },
  });
  const proxy = startRecordingProxy(stub.url);
  process.env.MAIPAI_LLAMA_SERVER_URL = proxy.url;
  __resetLlmSupervisorForTests();
  try {
    return await fn(seen);
  } finally {
    proxy.stop();
    await stub.stop();
  }
}

/** Row count of every table, by name. */
export function tableCounts(): Record<string, number> {
  const names = (sqlite.query("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '%\\_fts%' escape '\\'").all() as { name: string }[]).map((r) => r.name);
  const counts: Record<string, number> = {};
  for (const name of names) counts[name] = (sqlite.query(`select count(*) as n from "${name}"`).get() as { n: number }).n;
  return counts;
}

/** The tables whose row count changed between two snapshots. */
export function changedTables(before: Record<string, number>, after: Record<string, number>): string[] {
  return Object.keys(after).filter((name) => after[name] !== before[name]).sort();
}
