// MINOR-TOPICS-01d: no topic setting can weaken the crisis path. Every reachable combination of a
// child's or teen's topic settings renders a block that still carries the fixed support sentence and
// the hard lines; the self-harm check and the crisis support block do not depend on those settings.
import { describe, expect, test } from "bun:test";
import { getCeilingForBand } from "@/lib/contentCeiling";
import { evaluateReply, evaluateSafety, carriesCrisisSignal } from "@/lib/safety";
import {
  CHILD_CRISIS_LINE,
  CRISIS_RESOURCES_TEXT,
  CRISIS_SUPPORT_ACTIONS,
  crisisSupportFor,
} from "@/lib/failureCopy";
import { renderTopicBlock, TOPIC_COPY, TOPIC_FAMILIES, type TopicBand, type TopicFamily, type TopicStance } from "@maipai/spec/interpreters/ts/topicBlock.js";

/** Every combination of the stances a parent can reach for this band (fixed families contribute one). */
function combinations(band: TopicBand): Array<Record<TopicFamily, TopicStance>> {
  const record = getCeilingForBand(band);
  let all: Array<Partial<Record<TopicFamily, TopicStance>>> = [{}];
  for (const family of TOPIC_FAMILIES) {
    const entry = record.topics[family];
    const options = entry.fixed ? [entry.stance] : [...entry.allowed];
    all = all.flatMap((base) => options.map((stance) => ({ ...base, [family]: stance })));
  }
  return all as Array<Record<TopicFamily, TopicStance>>;
}

const HARD_LINES: Record<TopicBand, string[]> = {
  child: ["nothing graphic, scary or dangerous", "Never flirt or role-play romance"],
  teen: ["Never steps for weapons, drugs, crime or dangerous stunts", "never sexual content or romance role-play"],
};

describe("every reachable topic setting keeps the support sentence and the hard lines", () => {
  for (const band of ["child", "teen"] as const) {
    test(`${band}: all combinations`, () => {
      const record = getCeilingForBand(band);
      const combos = combinations(band);
      expect(combos.length).toBeGreaterThan(1);
      const support = TOPIC_COPY.families.feelings[band].support as string;
      for (const stances of combos) {
        for (const names of [[], ["Santa Claus", "the Tooth Fairy"]]) {
          const block = renderTopicBlock({ band, record, stances, familyStoryNames: names });
          expect(block).toContain(support);
          expect(block).toContain("988");
          expect(block.toLowerCase()).toContain("no methods");
          expect(block).toContain(TOPIC_COPY.families.people[band].protect as string);
          expect(block).toContain("911");
          for (const line of HARD_LINES[band]) {
            // A hard line is in the header or in a bodies sentence that every reachable stance repeats.
            const carriers = band === "child" ? block : block.split("\n")[0];
            expect(carriers).toContain(line);
          }
        }
      }
    });

    test(`${band}: a stale or tampered setting still yields the full block`, () => {
      const record = getCeilingForBand(band);
      const block = renderTopicBlock({ band, record, stances: { feelings: "informative", people: "neutral", bodies: "support" } });
      expect(block).toContain(TOPIC_COPY.families.feelings[band].support as string);
      expect(block).toContain(TOPIC_COPY.families.people[band].protect as string);
    });
  }

  test("no key reaches feelings or people: those families are fixed in both bands", () => {
    for (const band of ["child", "teen"] as const) {
      const record = getCeilingForBand(band);
      expect(record.topics.feelings.fixed).toBe(true);
      expect(record.topics.people.fixed).toBe(true);
      expect(record.topics.feelings.stance).toBe("support");
    }
  });
});

describe("self-harm stays allow_with_resources for a minor, whatever the topic settings", () => {
  const MESSAGES = ["I want to kill myself", "I am going to kill myself tonight"];
  for (const band of ["child", "teen"] as const) {
    test(`${band}: input and output`, () => {
      for (const text of MESSAGES) {
        const input = evaluateSafety(text, band);
        expect(input.categories).toContain("self_harm");
        expect(input.action).toBe("allow_with_resources");
        expect(carriesCrisisSignal(input)).toBe(true);
        const reply = evaluateReply({ text: `I am so sorry. ${text}` }, band);
        expect(JSON.stringify(reply)).toContain("self_harm");
      }
    });
  }
});

describe("the crisis support block", () => {
  test("a child's text opens with the trusted-grown-up line, then the unchanged 988 text", () => {
    const block = crisisSupportFor(CRISIS_RESOURCES_TEXT, "child");
    expect(block?.text).toBe(`${CHILD_CRISIS_LINE} ${CRISIS_RESOURCES_TEXT}`);
    expect(CHILD_CRISIS_LINE).toBe("Tell a grown-up you trust right now.");
    for (const action of CRISIS_SUPPORT_ACTIONS) expect(block?.actions).toContainEqual(action);
  });

  test("a teen and an adult get the 988 text exactly as before", () => {
    for (const band of ["teen", "adult"] as const) {
      const block = crisisSupportFor(CRISIS_RESOURCES_TEXT, band);
      expect(block?.text).toBe(CRISIS_RESOURCES_TEXT);
      expect(block?.actions).toEqual([...CRISIS_SUPPORT_ACTIONS]);
    }
    expect(crisisSupportFor(CRISIS_RESOURCES_TEXT, "adult")?.text).toBe(CRISIS_RESOURCES_TEXT);
  });

  test("a child gets the child-abuse help line for a known region, none for an unknown one", () => {
    const us = crisisSupportFor(CRISIS_RESOURCES_TEXT, "child", "US");
    expect(us?.actions.length).toBe(CRISIS_SUPPORT_ACTIONS.length + 1);
    expect(us?.actions.at(-1)?.href).toStartWith("tel:");
    const elsewhere = crisisSupportFor(CRISIS_RESOURCES_TEXT, "child", "ZZ");
    expect(elsewhere?.actions.length).toBe(CRISIS_SUPPORT_ACTIONS.length);
    expect(elsewhere?.text).toStartWith(CHILD_CRISIS_LINE);
  });

  test("no crisis resources means no block, for every band", () => {
    for (const band of ["child", "teen", "adult"] as const) expect(crisisSupportFor(undefined, band)).toBeUndefined();
  });
});
