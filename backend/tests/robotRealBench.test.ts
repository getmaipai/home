// ROBOT-VOICE-02: the real robot-surface turn, end to end, against a real chat model. Off unless MAIPAI_REAL_CHAT (a llama-server base URL) is set,
// so the gate never runs it. A recording proxy keeps each completion request's full message list, so the composed prompt can be read, not guessed.
//   MAIPAI_REAL_CHAT=http://127.0.0.1:50737 MAIPAI_REAL_EMBED=http://127.0.0.1:50869 bun test tests/robotRealBench.test.ts
// MAIPAI_REAL_SCRIPT is a JSON file: {"companion":"rivet","controls":"adult","turns":["..."],"dump":"/path/out.json"}.
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { useDefaultScriptedStack } from "./stackFixture";
import { createBenchPeople } from "../scripts/bench/conversationRunner";
import { setHouseholdSettingValue, setValue } from "@/lib/settings";
import { createDevice } from "@/lib/devices";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { db, sqlite } from "@/db";
import { conversationTurns, people as peopleTable } from "@/db/schema";

const CHAT = process.env.MAIPAI_REAL_CHAT;
const EMBED = process.env.MAIPAI_REAL_EMBED ?? CHAT;
const run = CHAT ? describe : describe.skip;

type Script = { companion?: string; controls?: "child" | "teen" | "adult"; turns: string[]; dump?: string; live?: { copy: string; device: string; person: string; before?: string; conversation?: string } };
type Seen = { path: string; messages: { role: string; content: unknown }[] };

run("the real robot turn", () => {
  test("replays a script on the robot surface and dumps what the model was given", async () => {
    const script = JSON.parse(readFileSync(process.env.MAIPAI_REAL_SCRIPT ?? "", "utf-8")) as Script;
    resetDb();
    useDefaultScriptedStack();
    let people = createBenchPeople();
    let deviceId = "";
    if (script.live) {
      // The household's own rows (a copy of the live database made by the caller): people, memory, places, settings, the robot's conversation.
      // Secrets and sessions are never copied. Replies are generated here, against this scratch database only.
      sqlite.exec(`ATTACH DATABASE '${script.live.copy.replace(/'/g, "''")}' AS live`);
      const skip = new Set(["sessions", "person_credentials", "passkey_credentials", "totp_secrets", "person_api_tokens", "api_keys", "device_tokens", "robot_credentials", "biometric_prints", "__drizzle_migrations"]);
      const tables = (sqlite.query("SELECT name FROM live.sqlite_master WHERE type='table' AND name NOT LIKE '%\\_fts%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name).filter((n) => !skip.has(n));
      sqlite.exec("PRAGMA foreign_keys = OFF");
      for (const t of tables) {
        const mine = new Set((sqlite.query(`PRAGMA main.table_info(${t})`).all() as { name: string }[]).map((c) => c.name));
        const theirs = (sqlite.query(`PRAGMA live.table_info(${t})`).all() as { name: string }[]).map((c) => c.name).filter((c) => mine.has(c));
        if (!theirs.length) continue;
        const cols = theirs.map((c) => `"${c}"`).join(",");
        try {
          sqlite.exec(`DELETE FROM main."${t}"`);
          sqlite.exec(`INSERT OR REPLACE INTO main."${t}" (${cols}) SELECT ${cols} FROM live."${t}"${t === "conversation_turns" && script.live.before ? ` WHERE created_at < '${script.live.before}'` : ""}`);
        } catch (error) { console.log(`copy ${t} skipped: ${String(error).slice(0, 100)}`); }
      }
      sqlite.exec("DETACH DATABASE live");
      sqlite.exec("PRAGMA foreign_keys = ON");
      const owner = db.select().from(peopleTable).where(eq(peopleTable.id, script.live.person)).get();
      if (!owner) throw new Error("the live person is not in the copy");
      people = { ...people, owner };
      deviceId = script.live.device;
      sqlite.exec("DELETE FROM settings_values WHERE key = 'chat.model_id'");
      setHouseholdSettingValue("chat.model_id", process.env.MAIPAI_REPLAY_MODEL_ID ?? "qwen3-6-35b-a3b-ud-q4-k-xl");
    } else {
      setHouseholdSettingValue("chat.model_id", process.env.MAIPAI_REPLAY_MODEL_ID ?? "qwen3-6-35b-a3b-ud-q4-k-xl");
      deviceId = createDevice("robot", "StackChan", people.owner.id).id;
      expect((await setValue(people.owner, `device:${deviceId}`, "robot.controls", script.controls ?? "adult")).ok).toBe(true);
      expect((await setValue(people.owner, `device:${deviceId}`, "robot.companion.id", script.companion ?? "rivet")).ok).toBe(true);
    }
    const seen: Seen[] = [];
    const proxy = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch: async (req) => {
        const url = new URL(req.url);
        const body = await req.text();
        if (url.pathname === "/v1/chat/completions") {
          try { seen.push({ path: url.pathname, messages: (JSON.parse(body) as Seen).messages }); } catch { /* not JSON */ }
        }
        const base = (url.pathname === "/v1/embeddings" ? EMBED : CHAT)!.replace(/\/$/, "");
        const upstream = await fetch(`${base}${url.pathname}${url.search}`, { method: req.method, headers: { "content-type": "application/json" }, body: req.method === "GET" ? undefined : body });
        return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
      },
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = `http://127.0.0.1:${proxy.port}`;
    process.env.MAIPAI_EMBED_URL = process.env.MAIPAI_LLAMA_SERVER_URL;
    __resetLlmSupervisorForTests();
    const out: { user: string; reply: string; plan: unknown; messages: Seen["messages"] | null }[] = [];
    try {
      for (const text of script.turns) {
        const before = seen.length;
        const result = await runTurnNext(people.owner, "robot", text, { deviceId, speakerEvidence: null, present: null, spoken: true, ...(script.live?.conversation ? { conversationId: script.live.conversation } : {}) });
        if (!result.ok || result.kind !== "immediate") throw new Error(`turn failed: ${JSON.stringify(result)}`);
        const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get()!;
        const last = seen.length > before ? seen[seen.length - 1]! : null;
        out.push({ user: text, reply: row.replyText, plan: JSON.parse(row.plan as string), messages: last?.messages ?? null });
        console.log(`USER: ${text}\nREPLY: ${row.replyText}\n`);
      }
    } finally {
      proxy.stop(true);
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
      delete process.env.MAIPAI_EMBED_URL;
      __resetLlmSupervisorForTests();
    }
    if (script.dump) writeFileSync(script.dump, JSON.stringify(out, null, 2));
  }, 600_000);
});
