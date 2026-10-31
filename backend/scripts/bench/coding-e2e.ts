// Usage: point at already-running scratch Home and Stack instances. By default
// this targets Home on 8893 and Stack on 8894; set E2E_HOME_URL and E2E_STACK_URL
// to other loopback ports (prefer 8893 through 8898). Start them as in
// docs/dev/coding-e2e.md. Requires E2E_HOME_COOKIE and an installed real model.
import { randomBytes } from "node:crypto";

const PROMPT = "Write a function that reverses a string in TypeScript, reply with code only.";
const TOOL = { type: "function", function: { name: "read_file", description: "Read a file from the supplied path.", parameters: { type: "object", required: ["path"], properties: { path: { type: "string" } } } } };
const MESSAGE_TOOL = { name: "read_file", description: "Read a file from the supplied path.", input_schema: { type: "object", required: ["path"], properties: { path: { type: "string" } } } };

export type CheckRow = { name: string; pass: boolean; detail: string; latencyMs?: number; tokensPerSecond?: number | null };

export function guardLoopbackUrl(value: string, label: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an absolute loopback URL.`); }
  if (!(["http:", "https:"].includes(url.protocol)) || !(["127.0.0.1", "localhost"].includes(url.hostname))) {
    throw new Error(`${label} must use http(s) and 127.0.0.1 or localhost.`);
  }
  if (url.username || url.password || url.search || url.hash) throw new Error(`${label} cannot contain credentials, a query, or a fragment.`);
  if ([3000, 8787].includes(Number(url.port))) throw new Error(`${label} cannot use port 3000 or 8787. Use a scratch 88xx port.`);
  return new URL(url.toString().replace(/\/$/, ""));
}

export function redactKeys(value: string, secrets: string[] = []): string {
  let safe = value;
  for (const secret of secrets) if (secret) safe = safe.split(secret).join("[REDACTED_KEY]");
  return safe.replace(/maipai_key_[a-z0-9]+_[A-Z2-7]{52}/g, "[REDACTED_KEY]");
}

export function formatTable(rows: CheckRow[]): string {
  const headers = ["CHECK", "RESULT", "DETAIL", "LATENCY", "TOKENS/S"];
  const cells = rows.map((row) => [row.name, row.pass ? "PASS" : "FAIL", row.detail, row.latencyMs === undefined ? "-" : `${row.latencyMs.toFixed(0)} ms`, row.tokensPerSecond == null ? "-" : row.tokensPerSecond.toFixed(1)]);
  const widths = headers.map((header, i) => Math.max(header.length, ...cells.map((row) => row[i]!.length)));
  const line = (row: string[]) => `| ${row.map((cell, i) => cell.padEnd(widths[i]!)).join(" | ")} |`;
  return [line(headers), `|-${widths.map((width) => "-".repeat(width)).join("-|-" )}-|`, ...cells.map(line)].join("\n");
}

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function object(value: unknown): Record<string, any> { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function secretsState(): Set<string> { return new Set<string>(); }
const secrets = secretsState();
const rows: CheckRow[] = [];
const timers = AbortSignal.timeout(900_000);

async function request(url: URL, path: string, init: RequestInit = {}, cookie?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(new URL(path, `${url.toString()}/`), { ...init, headers, signal: timers });
}
async function jsonRequest(url: URL, path: string, cookie: string, method = "GET", body?: unknown): Promise<any> {
  const response = await request(url, path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, cookie);
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${text.slice(0, 300)}`);
  try { return text ? JSON.parse(text) : {}; } catch { throw new Error(`${method} ${path} did not return JSON.`); }
}
async function setSetting(home: URL, cookie: string, scope: string, key: string, value: unknown): Promise<void> {
  await jsonRequest(home, "/api/settings", cookie, "PUT", { scope, key, value });
}
async function readSetting(home: URL, cookie: string, scope: string, key: string): Promise<unknown> {
  const entries = await jsonRequest(home, `/api/settings?scope=${encodeURIComponent(scope)}`, cookie);
  const row = Array.isArray(entries) ? entries.find((item) => item.key === key) : undefined;
  assert(row && "value" in row, `Could not read the current ${key} setting.`);
  return row.value;
}
async function callCode(home: URL, path: string, key?: string, body?: unknown): Promise<Response> {
  return request(home, path, {
    method: body === undefined ? "GET" : "POST",
    headers: key ? { authorization: `Bearer ${key}` } : undefined,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function cookieFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = /(?:^|,\s*)session=([^;,]+)/.exec(setCookie);
  assert(match?.[1], "Home sign-in did not set a session cookie.");
  return `session=${match[1]}`;
}
function textFromChat(reply: any): string {
  const content = object(reply.choices?.[0]?.message).content;
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.map((part) => typeof part?.text === "string" ? part.text : "").join("") : "";
}
function textFromMessages(reply: any): string { return Array.isArray(reply.content) ? reply.content.filter((part: any) => part?.type === "text").map((part: any) => part.text ?? "").join("") : ""; }
function textFromResponses(reply: any): string {
  return Array.isArray(reply.output) ? reply.output.flatMap((item: any) => Array.isArray(item.content) ? item.content : []).filter((part: any) => part?.type === "output_text").map((part: any) => part.text ?? "").join("") : "";
}
function usageOf(reply: any): { outputTokens: number | null; reasoningTokens: number | null } {
  const usage = object(reply.usage);
  const details = object(usage.completion_tokens_details ?? usage.output_tokens_details);
  const output = usage.completion_tokens ?? usage.output_tokens;
  return {
    outputTokens: typeof output === "number" && Number.isFinite(output) ? output : null,
    reasoningTokens: typeof details.reasoning_tokens === "number" && Number.isFinite(details.reasoning_tokens) ? details.reasoning_tokens : null,
  };
}
function assertModel(reply: any, knownModels: Set<string>, label: string): void {
  assert(typeof reply.model === "string" && knownModels.has(reply.model), `${label}: reply model ${String(reply.model)} is not listed by the coding gateway.`);
}
function measure(name: string, started: number, detail: string, outputTokens: number | null): void {
  const latencyMs = performance.now() - started;
  rows.push({ name, pass: true, detail, latencyMs, tokensPerSecond: outputTokens !== null && latencyMs > 0 ? outputTokens * 1000 / latencyMs : null });
}
async function bodyOf(response: Response, label: string): Promise<any> {
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} returned ${response.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { throw new Error(`${label} returned invalid JSON.`); }
}
function promptMessage() { return [{ role: "user", content: PROMPT }]; }

async function login(home: URL, personId: string, secret: string): Promise<string> {
  const response = await request(home, "/api/auth/verify-secret", { method: "POST", body: JSON.stringify({ personId, secret }) });
  const payload = await response.json().catch(() => ({})) as any;
  assert(response.ok && payload.totpRequired === false, `Scratch person sign-in failed (${response.status}); use a scratch Home without TOTP on its test profiles.`);
  return cookieFrom(response);
}
async function makePerson(home: URL, ownerCookie: string, name: string, role: "adult" | "teen"): Promise<{ id: string; cookie: string }> {
  const secret = `e2e-${randomBytes(24).toString("base64url")}`;
  const created = await jsonRequest(home, "/api/people", ownerCookie, "POST", { displayName: name, role, secret });
  return { id: created.id, cookie: await login(home, created.id, secret) };
}
async function createKey(home: URL, cookie: string, name: string): Promise<{ id: string; key: string }> {
  const made = await jsonRequest(home, "/api/settings/api-keys", cookie, "POST", { name, scopes: ["code"], expires_in_days: 30 });
  assert(typeof made.key?.id === "string" && typeof made.secret === "string", "The key create response was incomplete.");
  secrets.add(made.secret);
  return { id: made.key.id, key: made.secret };
}

async function collectChatStream(response: Response, knownModels: Set<string>, ceiling: number): Promise<{ text: string; model: string; outputTokens: number | null }> {
  assert(response.ok && response.body, `Streaming chat returned ${response.status}.`);
  const decoded = await response.text();
  let text = "", model = "", usage: any = {};
  for (const line of decoded.split("\n")) {
    if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
    let event: any;
    try { event = JSON.parse(line.slice(6)); } catch { continue; }
    if (typeof event.model === "string") model = event.model;
    const choice = event.choices?.[0];
    if (typeof choice?.delta?.content === "string") text += choice.delta.content;
    if (event.usage) usage = event.usage;
  }
  assert(text.trim().length > 0, "Streaming chat returned no answer text.");
  assert(knownModels.has(model), `Streaming chat model ${model || "(missing)"} is not listed by /models.`);
  const { outputTokens, reasoningTokens } = usageOf({ usage });
  assert(reasoningTokens !== null, "Streaming chat did not report reasoning token usage.");
  assert(reasoningTokens <= ceiling, `Streaming chat used ${reasoningTokens} reasoning tokens, above the ${ceiling} token ceiling.`);
  return { text, model, outputTokens };
}
async function toolCallChat(home: URL, key: string, model: string, knownModels: Set<string>, ceiling: number): Promise<void> {
  const prompt = "Call read_file on /tmp/e2e-reverse.ts, then write a TypeScript function that reverses a string, reply with code only.";
  const first = await bodyOf(await callCode(home, "/code/v1/chat/completions", key, { model, messages: [{ role: "user", content: prompt }], tools: [TOOL], tool_choice: "auto", max_tokens: 120, thinking_budget_tokens: ceiling, reasoning_effort: "medium" }), "chat tool call");
  assertModel(first, knownModels, "chat tool call");
  const firstReasoning = usageOf(first).reasoningTokens;
  assert(firstReasoning !== null && firstReasoning <= ceiling, `Chat tool call reasoning tokens must be reported and stay within ${ceiling}.`);
  const assistant = first.choices?.[0]?.message;
  const call = assistant?.tool_calls?.[0];
  assert(call?.function?.name === "read_file", "Chat did not return the read_file tool call.");
  const args = JSON.parse(call.function.arguments);
  assert(args.path === "/tmp/e2e-reverse.ts", "Chat returned an unexpected read_file path.");
  const secondStarted = performance.now();
  const second = await bodyOf(await callCode(home, "/code/v1/chat/completions", key, { model, messages: [{ role: "user", content: prompt }, assistant, { role: "tool", tool_call_id: call.id, content: "export function reverseString(value: string): string { return [...value].reverse().join(''); }" }], tools: [TOOL], max_tokens: 120, thinking_budget_tokens: ceiling, reasoning_effort: "medium" }), "chat tool result");
  assertModel(second, knownModels, "chat tool result");
  const final = textFromChat(second);
  assert(final.trim().length > 0, "Chat returned no final text after the tool result.");
  const { reasoningTokens, outputTokens } = usageOf(second);
  assert(reasoningTokens !== null, "Chat tool round trip did not report reasoning token usage.");
  assert(reasoningTokens <= ceiling, `Chat tool round trip exceeded the ${ceiling} token reasoning ceiling.`);
  measure("chat tool result turn", secondStarted, `tool read_file; ${outputTokens ?? "?"} output tokens`, outputTokens);
}
async function toolCallMessages(home: URL, key: string, model: string, knownModels: Set<string>, ceiling: number): Promise<void> {
  const prompt = "Call read_file on /tmp/e2e-reverse.ts, then write a TypeScript function that reverses a string, reply with code only.";
  const first = await bodyOf(await callCode(home, "/code/v1/messages", key, { model, max_tokens: 1500, messages: [{ role: "user", content: prompt }], tools: [MESSAGE_TOOL], tool_choice: { type: "auto" }, thinking: { type: "enabled", budget_tokens: ceiling } }), "messages tool call");
  assert(typeof first.model === "string" && knownModels.has(first.model), "Messages tool call model is not listed by /models.");
  const firstReasoning = usageOf(first).reasoningTokens;
  assert(firstReasoning === null || firstReasoning <= ceiling, `Messages tool call reasoning tokens must be reported and stay within ${ceiling}.`);
  const use = first.content?.find((part: any) => part?.type === "tool_use");
  assert(use?.name === "read_file" && use.input?.path === "/tmp/e2e-reverse.ts", "Messages did not return the expected read_file tool call.");
  const secondStarted = performance.now();
  const second = await bodyOf(await callCode(home, "/code/v1/messages", key, { model, max_tokens: 1500, messages: [{ role: "user", content: prompt }, { role: "assistant", content: first.content }, { role: "user", content: [{ type: "tool_result", tool_use_id: use.id, content: "export function reverseString(value: string): string { return [...value].reverse().join(''); }" }] }], tools: [MESSAGE_TOOL], tool_choice: { type: "auto" }, thinking: { type: "enabled", budget_tokens: ceiling } }), "messages tool result");
  assert(typeof second.model === "string" && knownModels.has(second.model), "Messages tool result model is not listed by /models.");
  const final = textFromMessages(second);
  assert(final.trim().length > 0, "Messages returned no final text after the tool result.");
  const { reasoningTokens, outputTokens } = usageOf(second);
  assert(reasoningTokens === null || reasoningTokens <= ceiling, `Messages tool round trip exceeded the ${ceiling} token reasoning ceiling.`);
  measure("messages tool result turn", secondStarted, `tool read_file; ${outputTokens ?? "?"} output tokens`, outputTokens);
}

async function run(): Promise<void> {
  const home = guardLoopbackUrl(process.env.E2E_HOME_URL ?? "http://127.0.0.1:8893", "E2E_HOME_URL");
  const stack = guardLoopbackUrl(process.env.E2E_STACK_URL ?? "http://127.0.0.1:8894", "E2E_STACK_URL");
  const ownerCookie = process.env.E2E_HOME_COOKIE;
  assert(ownerCookie && /(?:^|;\s*)session=/.test(ownerCookie), "Set E2E_HOME_COOKIE to a scratch Home owner/admin session cookie.");

  const homeSettings = ["coding.enabled", "coding.paused", "coding.api.enabled", "coding.adults_by_default", "coding.thinking_budget_ceiling", "engines.stack.url"];
  const oldSettings = new Map<string, unknown>();
  let adult: { id: string; cookie: string } | null = null;
  let teen: { id: string; cookie: string } | null = null;
  let adultKey: { id: string; key: string } | null = null;
  let teenKey: { id: string; key: string } | null = null;
  let grantId: string | null = null;
  let restored = false;
  const restorationErrors: string[] = [];
  try {
    for (const key of homeSettings) oldSettings.set(key, await readSetting(home, ownerCookie, "household", key));
    await setSetting(home, ownerCookie, "household", "coding.enabled", true);
    await setSetting(home, ownerCookie, "household", "coding.paused", false);
    await setSetting(home, ownerCookie, "household", "coding.api.enabled", true);
    await setSetting(home, ownerCookie, "household", "coding.adults_by_default", true);
    await setSetting(home, ownerCookie, "household", "engines.stack.url", stack.toString());

    adult = await makePerson(home, ownerCookie, `E2E Adult Riff ${Date.now()}`, "adult");
    teen = await makePerson(home, ownerCookie, `E2E Teen Sprout ${Date.now()}`, "teen");
    await setSetting(home, adult.cookie, `person:${adult.id}`, "coding.person.api_keys", true);
    await setSetting(home, ownerCookie, `person:${teen.id}`, "coding.person.api_keys", true);
    const grant = await jsonRequest(home, "/api/grants", ownerCookie, "POST", { person: teen.id, action: "use:code", effect: "allow", reason: "temporary e2e setup" });
    grantId = grant.id;
    adultKey = await createKey(home, adult.cookie, "Coding E2E adult");
    teenKey = await createKey(home, teen.cookie, "Coding E2E teen");
    await jsonRequest(home, `/api/grants/${grantId}`, ownerCookie, "DELETE");
    grantId = null;
    rows.push({ name: "adult and teen key setup", pass: true, detail: "adult key active; teen grant removed" });

    const modelsResponse = await callCode(home, "/code/v1/models", adultKey.key);
    const models = await bodyOf(modelsResponse, "GET /code/v1/models");
    assert(Array.isArray(models.data) && models.data.some((item: any) => item.id === "maipai-coder"), "Coding gateway did not list maipai-coder.");
    const knownModels = new Set<string>(models.data.map((item: any) => item.id));
    const model = "maipai-coder";
    rows.push({ name: "GET /models", pass: true, detail: `${knownModels.size} coding model name(s)` });
    const ceiling = Number(oldSettings.get("coding.thinking_budget_ceiling") ?? 2000);

    const jsonCases: Array<{ name: string; path: string; body: any; extract: (reply: any) => string }> = [
      { name: "chat completions", path: "/code/v1/chat/completions", body: { model, messages: promptMessage(), stream: false, max_tokens: 160, thinking_budget_tokens: ceiling, reasoning_effort: "medium" }, extract: textFromChat },
      { name: "messages", path: "/code/v1/messages", body: { model, messages: promptMessage(), max_tokens: 1500, thinking: { type: "enabled", budget_tokens: ceiling } }, extract: textFromMessages },
      { name: "responses", path: "/code/v1/responses", body: { model, input: PROMPT, max_output_tokens: 160, reasoning: { effort: "medium" } }, extract: textFromResponses },
    ];
    for (const item of jsonCases) {
      const started = performance.now();
      const reply = await bodyOf(await callCode(home, item.path, adultKey.key, item.body), item.name);
      assert(item.extract(reply).trim().length > 0, `${item.name} returned no answer text.`);
      assertModel(reply, knownModels, item.name);
      const { reasoningTokens, outputTokens } = usageOf(reply);
      assert(reasoningTokens !== null || item.path.endsWith("/messages"), `${item.name} did not report reasoning token usage.`);
      assert(reasoningTokens === null || reasoningTokens <= ceiling, `${item.name} used ${reasoningTokens} reasoning tokens, above the ${ceiling} token ceiling.`);
      measure(item.name, started, `model ${reply.model}; reasoning ${reasoningTokens}; ${outputTokens ?? "?"} output tokens`, outputTokens);
    }

    {
      const started = performance.now();
      const result = await collectChatStream(await callCode(home, "/code/v1/chat/completions", adultKey.key, { model, messages: promptMessage(), stream: true, max_tokens: 160, thinking_budget_tokens: ceiling, reasoning_effort: "medium" }), knownModels, ceiling);
      measure("chat stream", started, `model ${result.model}; ${result.outputTokens ?? "?"} output tokens`, result.outputTokens);
    }
    {
      const started = performance.now();
      const reply = await bodyOf(await callCode(home, "/code/v1/messages/count_tokens", adultKey.key, { model, messages: promptMessage() }), "messages count_tokens");
      assert(typeof reply.input_tokens === "number" && reply.input_tokens > 0, "count_tokens returned no positive input token count.");
      measure("messages count_tokens", started, `${reply.input_tokens} input tokens`, null);
    }
    await toolCallChat(home, adultKey.key, model, knownModels, ceiling);
    await toolCallMessages(home, adultKey.key, model, knownModels, ceiling);

    const stackRoles = await bodyOf(await request(stack, "/stack/v1/roles"), "Stack roles");
    const codingRole = Array.isArray(stackRoles.roles) ? stackRoles.roles.find((role: any) => role?.id === "coding") : null;
    assert(codingRole && ["splash", "llama-server"].includes(codingRole.coding?.engine), "Stack role record has no coding engine of splash or llama-server.");
    assert(codingRole.coding.state === "ready" || codingRole.coding.state === "busy", `Stack coding role is ${codingRole.coding.state}, not serving requests.`);
    rows.push({ name: "Stack coding role served calls", pass: true, detail: `${codingRole.coding.engine}; ${codingRole.coding.state}` });

    const unknown = await callCode(home, "/code/v1/chat/completions", "not-a-real-key", { model, messages: promptMessage() });
    const unknownBody = await unknown.text();
    assert(unknown.status === 401, `Missing key returned ${unknown.status}, expected 401.`);
    await jsonRequest(home, `/api/settings/api-keys/${adultKey.id}`, adult.cookie, "DELETE");
    const revoked = await callCode(home, "/code/v1/chat/completions", adultKey.key, { model, messages: promptMessage() });
    const revokedBody = await revoked.text();
    assert(revoked.status === 401 && revokedBody === unknownBody, "Revoked key did not return the same 401 body as an unknown key.");
    rows.push({ name: "missing and revoked keys", pass: true, detail: "401 with identical body" });

    const teenResponse = await callCode(home, "/code/v1/chat/completions", teenKey.key, { model, messages: promptMessage() });
    const teenText = await teenResponse.text();
    assert(teenResponse.status === 403, `Teen key without allow grant returned ${teenResponse.status}, expected 403.`);
    assert(!teenText.includes("invalid_api_key"), "Teen key was treated as an unknown key instead of refused by the grant gate.");
    rows.push({ name: "teen key without allow grant", pass: true, detail: "403; no engine access" });

    await setSetting(home, ownerCookie, "household", "coding.enabled", false);
    const off = await callCode(home, "/code/v1/chat/completions", teenKey.key, { model, messages: promptMessage() });
    const offBody = await off.text();
    assert(off.status === 503 && offBody.includes("Coding is turned off in this home."), "Coding off did not return its plain 503 sentence.");
    await setSetting(home, ownerCookie, "household", "coding.enabled", true);
    await setSetting(home, ownerCookie, "household", "coding.paused", true);
    const paused = await callCode(home, "/code/v1/chat/completions", teenKey.key, { model, messages: promptMessage() });
    const pausedBody = await paused.text();
    assert(paused.status === 503 && pausedBody.includes("Coding is paused by an admin."), "Paused Coding did not return its plain 503 sentence.");
    rows.push({ name: "coding off and paused", pass: true, detail: "both return plain 503" });
  } finally {
    if (grantId) await jsonRequest(home, `/api/grants/${grantId}`, ownerCookie, "DELETE").catch(() => undefined);
    if (adultKey && adult) await jsonRequest(home, `/api/settings/api-keys/${adultKey.id}`, adult.cookie, "DELETE").catch(() => undefined);
    if (teenKey && teen) await jsonRequest(home, `/api/settings/api-keys/${teenKey.id}`, teen.cookie, "DELETE").catch(() => undefined);
    for (const key of homeSettings) {
      if (!oldSettings.has(key)) continue;
      try { await setSetting(home, ownerCookie, "household", key, oldSettings.get(key)); }
      catch (error) { restorationErrors.push(`${key}: ${error instanceof Error ? error.message : "restore failed"}`); }
    }
    restored = restorationErrors.length === 0;
  }
  assert(restored, restorationErrors.length ? `Scratch Home settings could not be restored: ${restorationErrors.join("; ")}` : "Scratch Home settings were not restored.");
}

if (import.meta.main) {
  run().then(() => {
    console.log(formatTable(rows));
    console.log(`\n${rows.length} checks passed. Secrets are not printed. Settings restored.`);
  }).catch((error: unknown) => {
    const message = redactKeys(error instanceof Error ? error.message : String(error), [...secrets]);
    rows.push({ name: "script", pass: false, detail: message.slice(0, 180) });
    if (rows.length) console.log(formatTable(rows));
    console.error(`\nFAIL: ${message}\nSecrets are not printed. Check the scratch Home, Stack, model, and owner cookie.`);
    process.exitCode = 1;
  });
}
