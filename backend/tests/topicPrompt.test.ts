// MINOR-TOPICS-01c: the topic block reaches every model call that can serve a child or teen,
// an adult's prompt does not change by a byte, and the block stays inside its token budget.
import { beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { sqlite } from "@/db";
import { getCeilingForBand } from "@/lib/contentCeiling";
import { DEFAULT_PERSONA } from "@/lib/persona";
import { setValue } from "@/lib/settings";
import { topicBlockFor, topicBlockForTurn, topicMessages, withTopicBlock } from "@/lib/topicPrompt";
import { buildStablePrefix } from "@/lib/turnShared";
import { contextToMessages } from "@/lib/turnMachine/messages";
import { planFor } from "@/lib/register";
import { resolveTopicStances } from "@/lib/topicStances";
import { renderTopicBlock, TOPIC_FAMILIES, type TopicStance } from "@maipai/spec/interpreters/ts/topicBlock.js";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import type { PersonRow } from "@/types";

describe("an adult's prompt is unchanged", () => {
  test("buildStablePrefix with no block is byte-identical to the pre-topics output", () => {
    // The block is only ever appended: no block, no change to any part of the prefix.
    for (const surface of ["spoken", "written"] as const) {
      expect(buildStablePrefix(DEFAULT_PERSONA, surface, "")).toBe(buildStablePrefix(DEFAULT_PERSONA, surface));
      expect(buildStablePrefix(DEFAULT_PERSONA, surface, "BLOCK").startsWith(buildStablePrefix(DEFAULT_PERSONA, surface))).toBe(true);
    }
    expect(buildStablePrefix()).toBe(buildStablePrefix(DEFAULT_PERSONA, "spoken", ""));
  });

  test("an adult gets no block and no extra system message", () => {
    expect(topicBlockFor("adult")).toBe("");
    expect(topicBlockFor("adult", "any-id")).toBe("");
  });
});

describe("the block for a minor", () => {
  test("child and teen blocks open with their header and carry every family", () => {
    expect(topicBlockFor("child")).toStartWith("Child controls.");
    expect(topicBlockFor("teen")).toStartWith("Teen controls.");
    for (const band of ["child", "teen"] as const) {
      const block = topicBlockFor(band);
      expect(block).toContain("988");
      expect(block).toContain("take no side");
    }
  });

  test("it follows the persona sections, separated by a blank line, once", () => {
    const block = topicBlockFor("child");
    for (const surface of ["spoken", "written"] as const) {
      const prefix = buildStablePrefix(DEFAULT_PERSONA, surface, block);
      expect(prefix.startsWith(buildStablePrefix(DEFAULT_PERSONA, surface))).toBe(true);
      expect(prefix.endsWith(`\n\n${block}`)).toBe(true);
      expect(prefix.split("Child controls.").length - 1).toBe(1);
    }
  });

  test("the system message of a minor's turn carries the block, an adult's does not", () => {
    const plan = (band: "child" | "teen" | "adult") => planFor({ ...basis(band), evidence: { choices: 0, sources: 0, deliverable: false } });
    const signal = { age_band: "child" } as never;
    for (const band of ["child", "teen"] as const) {
      const block = topicBlockFor(band);
      const messages = contextToMessages([], "hello", DEFAULT_PERSONA, plan(band), signal, "spoken", [], false, block);
      expect(messages[0]!.content).toContain(block);
    }
    const adult = contextToMessages([], "hello", DEFAULT_PERSONA, plan("adult"), signal, "spoken");
    expect(adult[0]!.content).not.toContain("controls.");
  });

  test("the old lone child line is gone from the answer instruction", async () => {
    const { compositionInstruction } = await import("@/lib/composer");
    expect(compositionInstruction({ constraints: undefined as never, moves: undefined, ageBand: "child" }, [])).not.toContain("for a child");
  });
});

function basis(band: "child" | "teen" | "adult") {
  return {
    signal: { age_band: band } as never,
    surface: "chat" as const,
    surfaceClass: "spoken" as const,
    brevity: false,
    companion: { directness: "direct" as const, engagement: DEFAULT_PERSONA.engagement, complexity: DEFAULT_PERSONA.complexity },
    band,
    deferred: false,
    disclosureWithheld: false,
  };
}

describe("the block never comes up empty for a minor", () => {
  test("a missing person reads as a child; an unreadable setting falls back to the band defaults", () => {
    expect(withTopicBlock("", [{ role: "user", content: "hi" }])).toEqual([{ role: "user", content: "hi" }]);
    expect(topicBlockFor("child", "no-such-person").length).toBeGreaterThan(500);
  });
});

describe("the person's own keys", () => {
  beforeEach(() => resetDb());
  const row = (id: string) => sqlite.query("SELECT * FROM people WHERE id = ?").get(id) as unknown as PersonRow;

  test("a child's keys shape their block; a teen follows the household; a mismatched band gets defaults", async () => {
    const owner = new TestClient();
    const res = await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const ownerId = ((await res.json()) as { person: { id: string } }).person.id;
    const child = (await (await owner.post("/api/people", { displayName: "Bramble", role: "child" })).json()) as { id: string };
    const teen = (await (await owner.post("/api/people", { displayName: "Willow", role: "teen" })).json()) as { id: string };

    expect(topicBlockForTurn(row(child.id), "child")).toBe(topicBlockFor("child"));
    setValue(row(ownerId), `person:${child.id}`, "topics.bodies", "gentle");
    setValue(row(ownerId), `person:${child.id}`, "topics.family_stories", "off");
    const childBlock = topicBlockForTurn(row(child.id), "child");
    expect(childBlock).toContain("correct body words");
    expect(childBlock).not.toContain("Santa Claus");

    // A robot turn that heard a child on an adult's session gets the band defaults, not the adult's keys.
    expect(topicBlockForTurn(row(ownerId), "child")).toBe(topicBlockFor("child"));
    // Another child's keys never reach this one.
    expect(topicBlockForTurn(row(teen.id), "child")).toBe(topicBlockFor("child"));

    setValue(row(ownerId), "household", "topics.teen.bodies", "redirect");
    expect(topicBlockForTurn(row(teen.id), "teen")).toContain("trusted adult or doctor is the best person to ask");
    const asked = [{ role: "user" as const, content: "hi" }];
    expect(topicMessages(row(ownerId), asked)).toEqual(asked);
    expect(topicMessages(row(child.id), asked)).toEqual([{ role: "system", content: childBlock }, ...asked]);
    // A caller's own leading system message and the block share one system message.
    expect(topicMessages(row(child.id), [{ role: "system", content: "Be brief." }, ...asked])[0]).toEqual({ role: "system", content: `Be brief.\n\n${childBlock}` });
    expect(topicMessages(row(child.id), [{ role: "system", content: "Be brief." }, ...asked])).toHaveLength(2);
  });
});

describe("the token budget", () => {
  const names = ["Santa Claus", "the Tooth Fairy", "the Easter Bunny"];
  const block = (band: "child" | "teen") => topicBlockFor(band);

  test("the default blocks stay inside 260 tokens (a character floor; the live bench re-measures with the engine)", () => {
    // Measured 2026-10-12 with the Qwen3.8 9B tokenizer: child 256, teen 258 tokens.
    expect(block("child").length).toBeLessThanOrEqual(1000);
    expect(block("teen").length).toBeLessThanOrEqual(1100);
    expect(resolveTopicStances("child")!.familyStoryNames).toEqual(names);
  });

  test("the largest reachable combination is bounded: no block ever exceeds the character ceiling", () => {
    for (const band of ["child", "teen"] as const) {
      const record = getCeilingForBand(band);
      const families = Object.entries(record.topics!) as [(typeof TOPIC_FAMILIES)[number], { allowed: readonly string[] }][];
      let longest = 0;
      const walk = (i: number, cur: Record<string, TopicStance>) => {
        if (i === families.length) {
          const stories = band === "child" ? Array.from({ length: 10 }, () => "A".repeat(40)) : [];
          longest = Math.max(longest, renderTopicBlock({ band, record, stances: cur as never, familyStoryNames: stories }).length);
          return;
        }
        for (const stance of families[i]![1].allowed) walk(i + 1, { ...cur, [families[i]![0]]: stance as TopicStance });
      };
      walk(0, {});
      expect(longest).toBeLessThanOrEqual(band === "child" ? 2000 : 1250);
    }
  });
});

// The call-site inventory (architect condition 4). Every source file that imports a model-call function from
// lib/llm is listed here, either as carrying the topic block or as exempt with the reason. A new call site
// fails this test until someone decides which it is.
const GENERATORS = new Set(["complete", "completeBackground", "startCompleteStream", "startCompleteStreamPieces", "completeViaStackRequest"]);

const CARRIES: Record<string, RegExp> = {
  "lib/turnMachine/nodes/model.ts": /state\.topicBlock/,
  "lib/packageHost.ts": /topicMessages\(actor,/,
  "routes/llm.ts": /topicMessages\(actor,/,
  "routes/companions.ts": /topicMessages\(actor,/,
  "lib/projects/steps.ts": /topicMessagesForId\(/,
  "lib/quickReaction.ts": /topicMessagesForId\(/,
};

const EXEMPT: Record<string, string> = {
  "lib/turnMachine/bareCompare.ts": "bare mode is owner and admin only and refused for a minor (routes/turn.ts)",
  "lib/followUpSuggestions.ts": "suggestions are generated for an adult's own chat only (canGenerateFollowUpSuggestions)",
  "lib/conversationTitle.ts": "a two to five word label, run through the output gate for the owner's band; gives no advice",
  "lib/news/summary.ts": "Key points for a stored article, one per story and age band; a minor's text passes the minor floor, and a child's also the child gate sentence by sentence, before storage and again at release; gives no advice",
  "lib/conversationHistory.ts": "retention summaries kept as records; never sent to the person as a reply",
  "lib/companionLook.ts": "describes a companion's own character picture as a JSON card for its editor; no text reaches a person as a reply",
  "lib/pictures/ageCheck.ts": "labels a picture as a possible minor in JSON; no text reaches the person, a doubt withholds the picture",
  "lib/pictures/laneGate.ts": "labels a picture child-safe or not in JSON; no text reaches the person, a doubt withholds the picture",
  "lib/robotVision.ts": "describes one robot camera picture in a single sentence kept for 90 seconds as background data in that robot's own turn; it is never shown to the person, and the turn that reads it carries the topic block and passes the output gate",
  "lib/weatherSummary.ts": "a one or two sentence forecast summary from the day's numbers, shared by everyone who sees the place, so the text must pass the child floor before it is stored; it never blocks a page, and a refusal shows the advice line instead; gives no advice of its own",
  "lib/media/podcasts.ts": "3 to 5 sentence summary and takeaways for a stored podcast episode transcript, one per episode, never for a child; the text must pass the teen output gate (evaluateReply) before it is stored and again each time it is read; gives no advice of its own",
  "lib/prefixPrewarm.ts": "re-sends a person's last system message with a one-token answer that is discarded, only to refill the engine's prompt cache; no text reaches anyone",
  "lib/deliveryChoice.ts": "picks one sound tag (laugh, sigh, gasp or none) and its place for a sentence that was already written and checked; the model writes no words, and a child or teen is never asked",
  "lib/memoryJudge.ts": "classifies memory candidates into a JSON verdict; no text reaches the person",
  "lib/personaJudge.ts": "admin evaluation judge; no person-facing text",
  "lib/replyParityJudge.ts": "admin evaluation judge; no person-facing text",
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

describe("model call site inventory", () => {
  const root = join(import.meta.dir, "..", "src");
  const callers = sourceFiles(root)
    .filter((path) => {
      if (path.endsWith("lib/llm.ts")) return false;
      const text = readFileSync(path, "utf-8").replace(/import\s+type\s[^;]*?from\s*"[^"]+";?/g, "");
      // Any other way to reach lib/llm (a namespace, a dynamic import, a relative path) counts too.
      if (/import\s*\*\s*as\s+\w+\s+from\s*"(@\/lib\/|\.\.?\/)(.*\/)?llm"|await\s+import\(\s*"(@\/lib\/|\.\.?\/)(.*\/)?llm"\s*\)|from\s*"\.\.?\/(.*\/)?llm"/.test(text)) return true;
      return [...text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/llm"/g)].some((m) =>
        m[1]!.split(",").some((part) => GENERATORS.has(part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim())),
      );
    })
    .map((path) => path.slice(root.length + 1))
    .sort();

  test("every file that calls a model is classified, and nothing classified is stale", () => {
    expect(callers).toEqual([...Object.keys(CARRIES), ...Object.keys(EXEMPT)].sort());
  });

  test("every file classified as carrying the block really uses it", () => {
    for (const [file, pattern] of Object.entries(CARRIES)) {
      expect(readFileSync(join(root, file), "utf-8"), file).toMatch(pattern);
    }
  });

  test("every exemption names its reason", () => {
    for (const [file, reason] of Object.entries(EXEMPT)) expect(reason.length, file).toBeGreaterThan(20);
  });
});
