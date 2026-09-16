// Round-trips every fixture in spec/fixtures/records/ through its generated
// Zod model. This is the TS half of the proof required by platform plan 3:
// "home's check.sh round-trips every fixture in spec/fixtures/ through both
// generated model sets." The Python half is spec/gen/py/test_fixtures.py.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Person } from "../../gen/ts/person.js";
import { SettingValue } from "../../gen/ts/setting-value.js";
import { SettingsKey } from "../../gen/ts/settings-key.js";
import { MemoryRecord } from "../../gen/ts/memory-record.js";
import { PackageManifest } from "../../gen/ts/manifest.js";
import { SafetyResult } from "../../gen/ts/safety-result.js";
import { ModelCapabilities } from "../../gen/ts/model-capabilities.js";
import { Entity } from "../../gen/ts/entity.js";
import { List } from "../../gen/ts/list.js";
import { Relationship } from "../../gen/ts/relationship.js";
import { Grant } from "../../gen/ts/grant.js";
import { Issue } from "../../gen/ts/issue.js";
import { Conversation } from "../../gen/ts/conversation.js";
import { Device } from "../../gen/ts/device.js";
import { ContentCeiling } from "../../gen/ts/content-ceiling.js";
import { Source } from "../../gen/ts/source.js";
import { TurnSignal } from "../../gen/ts/turn-signal.js";
import { ReplyPlan } from "../../gen/ts/reply-plan.js";
import { SubjectRef } from "../../gen/ts/subject-ref.js";
import { ConversationTurn } from "../../gen/ts/conversation-turn.js";
import { OpenQuestion } from "../../gen/ts/open-question.js";
import { ReplyFeedback } from "../../gen/ts/reply-feedback.js";
// ErrorEntry is standards-owned (std-v0.2.0), not generated here; the error
// catalogue's shape is imported from the sibling .github checkout, the same
// way spec/schemas/manifest.schema.json imports PrivacyRow by $ref.
import { ErrorEntry } from "../../../../.github/standards/gen/ts/error-entry.js";

const FIXTURES_DIR = join(import.meta.dir, "..", "..", "fixtures", "records");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf-8"));
}

describe("record fixtures validate against their generated Zod models", () => {
  test("person.example.json", () => {
    expect(() => Person.parse(loadFixture("person.example.json"))).not.toThrow();
  });

  test("setting-value.example.json", () => {
    expect(() =>
      SettingValue.parse(loadFixture("setting-value.example.json")),
    ).not.toThrow();
  });

  test("settings-key.example.json", () => {
    expect(() =>
      SettingsKey.parse(loadFixture("settings-key.example.json")),
    ).not.toThrow();
  });

  for (const kind of ["memory", "memory-legacy", "entity", "episode"]) {
    test(`memory-record.${kind}.example.json`, () => {
      expect(() =>
        MemoryRecord.parse(loadFixture(`memory-record.${kind}.example.json`)),
      ).not.toThrow();
    });
  }

  for (const kind of ["person", "pet", "place"]) {
    test(`entity.${kind}.example.json`, () => {
      expect(() => Entity.parse(loadFixture(`entity.${kind}.example.json`))).not.toThrow();
    });
  }

  for (const kind of ["shopping", "todo", "custom"]) {
    test(`list.${kind}.example.json`, () => {
      expect(() => List.parse(loadFixture(`list.${kind}.example.json`))).not.toThrow();
    });
  }

  // Three relationship fixtures, one per case the two-axis design exists
  // for: a former job (valid_to set), an estranged daughter (valid_to
  // null, status estranged), and an unconfirmed inference.
  for (const kind of ["stated", "estranged", "inferred"]) {
    test(`relationship.${kind}.example.json`, () => {
      expect(() => Relationship.parse(loadFixture(`relationship.${kind}.example.json`))).not.toThrow();
    });
  }

  test("grant.example.json", () => {
    expect(() => Grant.parse(loadFixture("grant.example.json"))).not.toThrow();
  });

  test("issue.example.json", () => {
    expect(() => Issue.parse(loadFixture("issue.example.json"))).not.toThrow();
  });

  test("conversation.example.json", () => {
    expect(() => Conversation.parse(loadFixture("conversation.example.json"))).not.toThrow();
  });

  test("device.example.json", () => {
    expect(() => Device.parse(loadFixture("device.example.json"))).not.toThrow();
  });

  test("source.example.json", () => {
    expect(() => Source.parse(loadFixture("source.example.json"))).not.toThrow();
  });

  test("manifest.example.json", () => {
    expect(() =>
      PackageManifest.parse(loadFixture("manifest.example.json")),
    ).not.toThrow();
  });

  test("safety-result.example.json", () => {
    expect(() =>
      SafetyResult.parse(loadFixture("safety-result.example.json")),
    ).not.toThrow();
  });

  for (const kind of ["chat", "image"]) {
    test(`model-capabilities.${kind}.example.json`, () => {
      expect(() =>
        ModelCapabilities.parse(loadFixture(`model-capabilities.${kind}.example.json`)),
      ).not.toThrow();
    });
  }

  for (const band of ["child", "teen", "adult"]) {
    test(`content-ceiling.${band}.example.json`, () => {
      expect(() =>
        ContentCeiling.parse(loadFixture(`content-ceiling.${band}.example.json`)),
      ).not.toThrow();
    });
  }

  test("every content-ceiling band carries the identical floor - it documents an invariant, not a per-band setting", () => {
    const floors = ["child", "teen", "adult"].map(
      (band) => (loadFixture(`content-ceiling.${band}.example.json`) as { floor: string[] }).floor,
    );
    expect(floors[0]).toEqual(floors[1]);
    expect(floors[1]).toEqual(floors[2]);
  });

  test("turn-signal.example.json", () => {
    expect(() => TurnSignal.parse(loadFixture("turn-signal.example.json"))).not.toThrow();
  });

  test("reply-plan.example.json", () => {
    expect(() => ReplyPlan.parse(loadFixture("reply-plan.example.json"))).not.toThrow();
  });

  // SPEC-01's own acceptance: round-trip fixtures for all three SubjectRef
  // variants, and the validator refuses a world reference carrying an
  // entity_id (the second test below).
  for (const kind of ["household", "world", "unresolved"]) {
    test(`subject-ref.${kind}.example.json`, () => {
      expect(() => SubjectRef.parse(loadFixture(`subject-ref.${kind}.example.json`))).not.toThrow();
    });
  }

  test("a world SubjectRef carrying an entity_id is refused", () => {
    const world = loadFixture("subject-ref.world.example.json") as Record<string, unknown>;
    expect(() => SubjectRef.parse({ ...world, entity_id: "ent-p7q8r9" })).toThrow();
  });

  test("conversation-turn.example.json", () => {
    expect(() => ConversationTurn.parse(loadFixture("conversation-turn.example.json"))).not.toThrow();
  });

  test("open-question.example.json", () => {
    expect(() => OpenQuestion.parse(loadFixture("open-question.example.json"))).not.toThrow();
  });

  test("reply-feedback.example.json", () => {
    expect(() => ReplyFeedback.parse(loadFixture("reply-feedback.example.json"))).not.toThrow();
  });

  test("error catalogue entries", () => {
    const errors = JSON.parse(
      readFileSync(
        join(import.meta.dir, "..", "..", "errors", "errors.json"),
        "utf-8",
      ),
    ) as unknown[];
    expect(errors.length).toBeGreaterThan(0);
    for (const entry of errors) {
      expect(() => ErrorEntry.parse(entry)).not.toThrow();
    }
  });
});

describe("a bad record is rejected, not silently accepted", () => {
  test("person missing a required field fails", () => {
    const bad = loadFixture("person.example.json") as Record<string, unknown>;
    delete bad.role;
    expect(() => Person.parse(bad)).toThrow();
  });

  test("person with an unknown extra field fails (additionalProperties: false)", () => {
    const bad = { ...(loadFixture("person.example.json") as Record<string, unknown>), extra: "nope" };
    expect(() => Person.parse(bad)).toThrow();
  });
});
