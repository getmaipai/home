// SEARCH-DDGS-TEEN-01: whether a turn is spoken is read from the turn's own surface (the planned surface class the
// tool node passes to the package host), so every voice entry point keeps a minor on SearXNG
// only: the chat route with the spoken flag (live voice session, Wyoming satellites and the OpenAI-style route all
// run the turn as `chat` + `spoken`), and the robot surface. A written teen turn does reach ddgs.
// The real machine, a scripted model, a fake SearXNG and a fake ddgs sidecar.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { useDefaultScriptedStack } from "../stackFixture";
import { addBenchTeen, createBenchPeople, startRecordingProxy, type BenchPeople } from "../../scripts/bench/conversationRunner";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { __setChatWindowContextForTests } from "@/lib/roleHealth";
import { __setPageReaderForTests, __resetSearchCacheForTests } from "@/lib/packageHost";
import { __resetDdgsForTests } from "@/lib/retrieval/ddgsSource";
import { DDGS_URL_ENV } from "@/lib/retrieval/ddgsConfig";
import { MINOR_DDGS_KEY } from "@/settings/minorDdgsKeys";
import { __reloadRegistryForTests } from "@/lib/settingsRegistry";

let people: BenchPeople;
let sidecar: ReturnType<typeof Bun.serve>;
let searx: ReturnType<typeof Bun.serve>;
let sidecarHits = 0;
const before = process.env[DDGS_URL_ENV];

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  __resetSearchCacheForTests();
  __resetDdgsForTests();
  __setChatWindowContextForTests(4608);
  people = createBenchPeople();
  addBenchTeen(people);
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  sidecarHits = 0;
  sidecar = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => { sidecarHits++; return Response.json({ rows: [{ title: "Duck page", url: "https://duck.example/p", snippet: "from ddgs" }] }); } });
  searx = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => (new URL(req.url).pathname === "/config" ? Response.json({ engines: [] }) : Response.json({ results: [{ title: "Searx page", url: "https://searx.example/p", content: "from searxng" }], infoboxes: [] })) });
  process.env[DDGS_URL_ENV] = `http://127.0.0.1:${sidecar.port}`;
  __reloadRegistryForTests();
  setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${searx.port}`);
  setHouseholdSettingValue("search.web_sources", ["searxng", "ddgs"]);
  setHouseholdSettingValue(MINOR_DDGS_KEY, "teens_and_children");
  __setPageReaderForTests(async (url) => ({ type: "document", file_id: "f", url, title: "A page", text: "A page about herons.", chunks: [], links: [], sections: [] }));
});

afterEach(() => {
  sidecar.stop(true);
  searx.stop(true);
  if (before === undefined) delete process.env[DDGS_URL_ENV]; else process.env[DDGS_URL_ENV] = before;
  __reloadRegistryForTests();
  __setPageReaderForTests(null);
  __setChatWindowContextForTests(undefined);
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

async function turn(who: "teen" | "child", surface: "chat" | "robot", utterance: string, opts?: { spoken?: boolean }, call = true): Promise<void> {
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (request: ChatCompletionRequest) => (request.messages.some((m) => m.role === "tool") ? "Here is what I found." : "ok"),
    scriptedToolCalls: (request: ChatCompletionRequest) => {
      if (!call || !request.tools || request.tools.length === 0 || request.messages.some((m) => m.role === "tool")) return undefined;
      return [{ id: "call-1", type: "function" as const, function: { name: "websearch", arguments: JSON.stringify({ expression: "herons" }) } }];
    },
  });
  const proxy = startRecordingProxy(stub.url);
  process.env.MAIPAI_LLAMA_SERVER_URL = proxy.url;
  __resetLlmSupervisorForTests();
  try {
    const result = await runTurnNext(people[who]!, surface, utterance, opts);
    expect(result.ok).toBe(true);
  } finally {
    proxy.stop();
    await stub.stop();
  }
}

describe("a minor's search reaches ddgs only on a written turn", () => {
  test("a written teen chat turn searches beside SearXNG", async () => {
    await turn("teen", "chat", "tell me about herons");
    expect(sidecarHits).toBe(1);
  });
  test("a written child chat turn searches beside SearXNG when the owner allowed children", async () => {
    await turn("child", "chat", "tell me about herons");
    expect(sidecarHits).toBe(1);
  });
  test("the spoken chat turn (live voice session, Wyoming satellite, OpenAI-style route) stays on SearXNG", async () => {
    await turn("teen", "chat", "tell me about herons", { spoken: true });
    await turn("child", "chat", "tell me about herons", { spoken: true });
    expect(sidecarHits).toBe(0);
  });
  test("the robot surface stays on SearXNG", async () => {
    await turn("teen", "robot", "tell me about herons");
    await turn("child", "robot", "tell me about herons");
    expect(sidecarHits).toBe(0);
  });
  test("a caller that does not say what its surface is (a direct plugin run) is treated as spoken for a minor", async () => {
    const { runPlugin } = await import("@/lib/plugins");
    const run = await runPlugin("websearch", people.teen!, { expression: "herons" });
    expect(run.ok).toBe(true);
    expect(sidecarHits).toBe(0);
  });
});
