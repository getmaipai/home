// ROUTER-BUILD-03: arm B's decision pass as a bench script. One short generation per row (SEARCH or NO_SEARCH), thinking off,
// greedy, max 3 tokens, the last exchange as context. Writes decisions the replay reads; on a labelled dev pool it also prints
// recall and false-search rates per prompt variant. Measurement only; ships nothing.
//
//   dev pool tuning (holds the engine lock):
//   MAIPAI_ENGINE_LOCK_HELD=1 MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8773 bun run scripts/bench/routerBuild02Decide.ts \
//     --rows dev --variants 3 --out ../data-scratch/chat-ab/router-build-02/b-dev
//   stage 1 over the lock box (needs the frozen variant and PREREG):
//   ... --rows /full/path/lockbox.json --variant 2 --reps 3 --prereg /full/path/PREREG.json --out <dir>
// The lock box is refused unless --prereg names it and its sha256 matches. A dev run never touches rows marked `split: heldout`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decide, systemPrompt, type DeciderTurn, type PromptVariant } from "./routerBuild02Decider";
import { assertLockboxMatches, clusterBootstrap, familyValues, median, percentile, sha256Text } from "./routerBuild02Stats";

interface Row { id: string; band: string; category: string; prompt: string; family: string; followUp?: boolean; priorUser?: string; priorAssistant?: string; split?: string; contested?: boolean }

const DATA = join(process.cwd(), "..", "data-scratch", "chat-ab", "router-build-03");

/** The hash of a variant's system prompt, frozen into PREREG.json. */
export const promptSha256 = (variant: PromptVariant): string => sha256Text(systemPrompt(variant));

export async function askEngine(chatUrl: string, messages: { role: string; content: string }[], timeoutMs = 20_000): Promise<string> {
  const res = await fetch(`${chatUrl}/v1/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "chat", messages, max_tokens: 3, temperature: 0, stream: false, chat_template_kwargs: { enable_thinking: false } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`engine HTTP ${res.status}`);
  return ((await res.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
}

if (import.meta.main) {
  const arg = (n: string): string | null => { const i = process.argv.indexOf(n); return i < 0 ? null : (process.argv[i + 1] ?? null); };
  const refuse = (msg: string): never => { console.error(`routerBuild02Decide refused: ${msg}`); process.exit(2); };
  const chatUrl = process.env.MAIPAI_LLAMA_SERVER_URL?.replace(/\/$/, "") ?? refuse("MAIPAI_LLAMA_SERVER_URL is not set. Point it at the second 9B, for example http://127.0.0.1:8773.");
  if (process.env.MAIPAI_ENGINE_LOCK_HELD !== "1") refuse("take data-scratch/lane-locks/engine-8771.lock first, then set MAIPAI_ENGINE_LOCK_HELD=1 for this command.");
  const rowsArg = arg("--rows") ?? refuse("--rows dev or --rows /full/path/rows.json is required.");
  const path = rowsArg === "dev" ? join(DATA, "dev.json") : rowsArg;
  const all = (JSON.parse(readFileSync(path, "utf-8")).rows as Row[]);
  const isLock = all.some((r) => r.split === "heldout");
  if (isLock) {
    const prereg = arg("--prereg") ?? refuse("these rows are a lock box (split heldout). Pass --prereg /full/path/PREREG.json after the freeze commit.");
    try { assertLockboxMatches(path, JSON.parse(readFileSync(prereg, "utf-8"))); } catch (err) { refuse((err as Error).message); }
  }
  const rows = all.filter((r) => r.band === "adult" && !r.contested);
  const variants: PromptVariant[] = arg("--variant") ? [Number(arg("--variant")) as PromptVariant] : ([1, 2, 3] as PromptVariant[]).slice(0, Number(arg("--variants") ?? 3));
  const reps = Number(arg("--reps") ?? 1);
  const out = arg("--out") ?? refuse("--out <dir> is required.");
  mkdirSync(out, { recursive: true });
  const t0 = Date.now();
  for (const variant of variants) {
    const decisions: Record<string, Record<string, string>> = {};
    const ms: number[] = [];
    for (const row of rows) for (let rep = 1; rep <= reps; rep++) {
      const turn: DeciderTurn = { band: "adult", modelToolCalls: 0, text: row.prompt, prior: row.followUp && row.priorUser ? { user: row.priorUser, assistant: row.priorAssistant ?? "" } : null };
      const d = await decide(turn, { arm: "B", variant, ask: (m) => askEngine(chatUrl, m) });
      (decisions[row.id] ??= {})[String(rep)] = d.decision;
      if (d.ms !== undefined) ms.push(d.ms);
      if (d.reason !== "ok") console.error(`[decide] ${row.id} rep ${rep}: failed open (${d.reason})`);
    }
    writeFileSync(join(out, `decisions-v${variant}.json`), JSON.stringify(decisions));
    const searched = (cat: string) => familyValues(rows.filter((r) => r.category === cat).flatMap((r) => Object.values(decisions[r.id] ?? {}).map((v) => ({ family: r.family, row: r.id, value: v === "SEARCH" ? 1 : 0 }))));
    const report = { variant, promptSha256: promptSha256(variant), reps, recall: clusterBootstrap(searched("recency")), falseStable: clusterBootstrap(searched("stable")), falseNoTool: clusterBootstrap(searched("no_tool")), msMedian: median(ms), msP95: percentile(ms, 95), rows: rows.length };
    writeFileSync(join(out, `report-v${variant}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
  console.log(`done in ${Math.round((Date.now() - t0) / 1000)} s`);
}
