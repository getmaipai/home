import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MECHANICS, checkEvidence, receivedByModel, scoreHedgePair, scoreRegisterReply, type RegisterRow } from "./registerScore";

const rows = JSON.parse(readFileSync(join(import.meta.dir, "datasets", "register-corpus.json"), "utf8")) as RegisterRow[];

describe("register corpus", () => {
  test("parses, has unique ids, and uses only roster names", () => {
    expect(rows.length).toBeGreaterThanOrEqual(28);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    const data = JSON.stringify(rows);
    expect(data).not.toMatch(/\b(?:John|Jane|Smith|Doe)\b|\b\d{1,3}(?:\.\d{1,3}){3}\b|\b\d+\s+[A-Z][a-z]+\s+(?:Street|Road|Avenue)\b/);
    for (const mechanic of MECHANICS) expect(rows.some((row) => row.mechanic === mechanic)).toBe(true);
    for (const row of rows) {
      expect(row.utterances.length).toBeGreaterThanOrEqual(1);
      if (row.mechanic === "reask") expect(row.utterances.length).toBe(2);
      if (row.lengthRule) expect(row.surface).toBe("robot");
    }
  });
});

describe("register scoring", () => {
  test("each mechanic distinguishes robotic, natural, and unrelated replies", () => {
    const examples: Record<string, { id?: string; robotic: string; natural: string }> = {
      clock: { id: "clock_round", robotic: "The current time is 3:47 PM.", natural: "It's around quarter to four." },
      hedge: { robotic: "It will rain, 70 percent.", natural: "It looks like rain, probably." },
      evidential: { robotic: "The recital is at six.", natural: "I think it was around six." },
      reask: { robotic: "The current time is nine fifty-one, as I said.", natural: "Nine fifty-one." },
      price: { id: "price_round", robotic: "That cost $29.97.", natural: "About thirty dollars." },
      date: { robotic: "No, today is Wednesday, October 28, 2026.", natural: "No, it's Wednesday." },
      opinion: { robotic: "No, that movie was bad.", natural: "It was a little slow for me, though." },
      news: { robotic: "City council approves a new park.", natural: "Apparently, city council approved a new park." },
    };
    for (const [mechanic, example] of Object.entries(examples)) {
      const row = rows.find((item) => item.id === (example as { id?: string }).id) ?? rows.find((item) => item.mechanic === mechanic)!;
      const first = row.lengthRule ? "It is nine fifty-one right now." : undefined;
      const label = `${mechanic}/${row.id}`;
      expect([label, scoreRegisterReply(row, example.robotic, first).verdict]).toEqual([label, "fail"]);
      expect([label, scoreRegisterReply(row, example.natural, first).verdict]).toEqual([label, "pass"]);
      if (!row.lengthRule) expect(scoreRegisterReply(row, "The blue bicycle is parked outside.").verdict).toBe("ambiguous");
    }
    expect(scoreHedgePair("It might rain.", "It will probably rain.").verdict).toBe("pass");
    expect(scoreHedgePair("It might rain.", "It might rain.").verdict).toBe("fail");
  });
});

describe("scoring edges", () => {
  const row = rows.find((r) => r.id === "clock_round")!;
  test("a stub or error reply is ambiguous", () => {
    expect(scoreRegisterReply(row, "[stub model: no real model loaded, this is a canned reply] 3:47 PM").verdict).toBe("ambiguous");
    expect(scoreRegisterReply(row, "[error: MaiPai's AI isn't running right now.]").verdict).toBe("ambiguous");
    expect(scoreRegisterReply(row, "").verdict).toBe("ambiguous");
  });
  test("the shorter rule fails an equal or longer second reply", () => {
    const reask = rows.find((r) => r.lengthRule === "shorter")!;
    expect(scoreRegisterReply(reask, "Nine fifty-one.", "Nine fifty-one, it is.").verdict).not.toBe("fail");
    expect(scoreRegisterReply(reask, "It is nine fifty-one right now.", "Nine fifty-one.").matchedPattern).toBe("length:not-shorter");
  });
  test("checkEvidence counts raw values present and ignores case", () => {
    expect(checkEvidence({ raw: ["4:10 PM", "70%"] }, "x 4:10 pm y").rawFound).toBe(1);
    expect(checkEvidence({ raw: ["a"] }, null).rawFound).toBe(0);
  });
});

describe("receivedByModel", () => {
  test("no request means nothing received", () => {
    expect(receivedByModel([])).toBeNull();
  });
  test("keeps the system text and the tool outcome, drops the person's words", () => {
    const text = receivedByModel([{ contextText: "Today is Wednesday, 2:30 PM.\nThe person's words:\nIs it going to rain?", toolText: "70% chance of rain" }])!;
    expect(text).toContain("2:30 PM");
    expect(text).toContain("70% chance of rain");
    expect(text).not.toContain("going to rain");
  });
});
