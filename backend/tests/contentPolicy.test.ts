import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createContentPolicyResolver, contentPolicyFor, filtersFor, CHILD_UNSAFE_TERMS, type Audience, type ProtectionKind } from "@/lib/contentPolicy";
import { CONTENT_SETTINGS_KEYS } from "@/settings/contentKeys";
import type { PersonRow } from "@/types";
import rawCorpus from "./fixtures/contentPolicy/corpus.json";
import boundaries from "./fixtures/contentPolicy/boundaries.json";
import terms from "@/lib/contentPolicy/data/terms.v1.json";
import kinds from "@/lib/contentPolicy/data/kinds.v1.json";
import { MINOR_MARKERS, SEXUAL_WORDS, contentChecksForFold } from "@/lib/pictures/minorLine";
import { foldForSafety } from "@maipai/spec/safety/ts/fold.js";
import { lanesSchema, floorsSchema } from "@/lib/contentPolicy/dataSchema";
import lanes from "@/lib/contentPolicy/data/lanes.v1.json";
import floors from "@/lib/contentPolicy/data/floors.v1.json";
const person = (role: string): PersonRow => ({ id: `policy-${role}`, role, birthdate: role === "child" ? "2020-01-01" : role === "teen" ? "2011-01-01" : "1990-01-01" } as PersonRow);
const corpus = rawCorpus as Array<{ id: string; kind: ProtectionKind; text: string; severity?: string }>;
const fields = ["prompt", "lyrics", "title", "transcript"] as const;
const resolver = createContentPolicyResolver({ readFilters: () => [] });
const fail = { kind: "minor_line" as const, line: "I couldn't check that safely. Try something different." };

describe("content policy", () => {
  for (const band of ["child", "teen", "adult"] as const) {
    for (const row of corpus) test(`[${row.id}] ${band} across fields`, () => {
      const policy = resolver.contentPolicyFor(person(band));
      const blocked = band === "child" || (band === "teen" && (row.kind === "gore" || (row.kind === "swearing" && row.severity === "strong")));
      for (const field of fields) expect(policy.check(row.text, field)?.kind ?? null).toBe(blocked ? row.kind : null);
    });
    test(`${band} absolute checks and adult floor`, () => {
      const policy = resolver.contentPolicyFor(person(band));
      const absolute = `${MINOR_MARKERS[0]} ${SEXUAL_WORDS[0]}`;
      for (const field of fields) {
        expect(policy.check(absolute, field)?.kind).toBe("minor_line");
        expect(policy.check(SEXUAL_WORDS[0]!, field)?.kind ?? null).toBe(band === "adult" ? null : "sexual");
      }
      expect(policy.filters.has("minor_line")).toBe(true);
      expect(policy.filters.has("real_person")).toBe(band !== "adult");
    });
  }
  test("person additions tighten each band and an empty list cannot relax defaults", () => {
    for (const band of ["child", "teen", "adult"]) {
      const own = createContentPolicyResolver({ readFilters: () => ["swearing", "drugs", "gambling", "gore", "sexual"] });
      for (const row of corpus) expect(own.contentPolicyFor(person(band)).check(row.text, "title")?.kind).toBe(row.kind);
      expect([...resolver.filtersFor(person(band))]).toEqual([...resolver.contentPolicyFor(person(band)).filters]);
    }
  });
  for (const role of ["adult", "owner", "admin", "guest", "teen", "child"]) {
    test(`${role} keeps role defaults for every birthdate`, () => {
      const expected: ProtectionKind[] = role === "child" ? ["minor_line", "real_person", "sexual", "swearing", "drugs", "gambling", "gore"]
        : role === "teen" ? ["minor_line", "real_person", "sexual", "swearing", "gore"] : ["minor_line"];
      for (const birthdate of [null, undefined, "", "invalid", "1990-01-01", "2011-01-01", "2020-01-01", "2026-02-30", "2099-01-01"]) {
        const p = { ...person(role), birthdate } as PersonRow;
        if (birthdate === undefined) delete (p as Partial<PersonRow>).birthdate;
        expect([...resolver.filtersFor(p)]).toEqual(expected);
      }
    });
  }
  test("child birthdates cannot relax child defaults", () => {
    for (const birthdate of ["1990-01-01", "2011-01-01", "2020-01-01", "2026-02-30"]) {
      expect([...resolver.filtersFor({ ...person("child"), birthdate })]).toEqual([...resolver.filtersFor(person("child"))]);
    }
  });
  test("band resolution never reads birthdate", () => {
    const p = person("adult");
    Object.defineProperty(p, "birthdate", { get() { throw new Error("Birthdate must not be read"); } });
    expect([...resolver.filtersFor(p)]).toEqual(["minor_line"]);
  });
  test("unknown identity or role uses child defaults", () => {
    const noId = { ...person("adult") } as Partial<PersonRow>;
    delete noId.id;
    for (const p of [null, noId, { ...person("adult"), id: "" }, person("unknown"), person("")]) {
      expect([...resolver.filtersFor(p as PersonRow)]).toEqual([...resolver.filtersFor(person("child"))]);
    }
  });
  test("moved lists retain the independently reviewed order and bytes", () => {
    for (const [values, digest] of [
      [lanes.CHILD_UNSAFE_TERMS, "8f22be527d0c4126ec90e5e5fce9145bfd187611a2061990449553bdd4c46a34"],
      [lanes.CHILD_IP_NAMES, "2e853d311e55bda4fab5eb87a1032146f8a70b09be244c3a4203a6a75b223152"],
      [floors.MINOR_MARKERS, "af552862a4a4c18cc6b4a4ce2176dd86d7feab9ec532335d43bc00d3f1d75d0b"],
      [floors.SEXUAL_WORDS, "9e253f259370eb9e7f761510ec7dbb736bf14fe9b9a907f95f263dd4ede0b519"],
      [floors.UNCLOTHED_PHRASES, "6ef34e51e4b9fcf4c89e1f3b93b2689b8321ae06211b2755d279589a6553b3a4"],
    ] as const) expect(createHash("sha256").update(JSON.stringify(values)).digest("hex")).toBe(digest);
  });
  test("invalid lane and floor lists throw using the module-load schemas", () => {
    for (const [schema, data, keys] of [
      [lanesSchema, lanes, ["CHILD_UNSAFE_TERMS", "CHILD_IP_NAMES"]],
      [floorsSchema, floors, ["MINOR_MARKERS", "SEXUAL_WORDS", "UNCLOTHED_PHRASES"]],
    ] as const) {
      for (const key of keys) for (const value of [[], ["   "], ["***"], ["\u200b"]]) {
        expect(() => schema.parse({ ...data, [key]: value })).toThrow();
      }
    }
  });
  test("empty or ineffective terms and exception matchers fail closed", () => {
    const invalid: unknown[] = [{ ...terms, terms: [] }];
    for (const value of ["", "   ", "***", "\u200b"]) {
      invalid.push({ ...terms, terms: terms.terms.map(t => ({ ...t, term: value })), exceptions: [] });
      invalid.push({ ...terms, exceptions: terms.exceptions.map(e => ({ ...e, phrase: value })) });
      invalid.push({ ...terms, exceptions: terms.exceptions.map(e => ({ ...e, term: value })) });
    }
    for (const data of invalid) expect(createContentPolicyResolver({ readFilters: () => [], data }).contentPolicyFor(person("adult")).check("garden", "title")).toEqual(fail);
  });
  test("reviewed whole-text exceptions cannot hide continuations or repeated occurrences", () => {
    const policy = contentPolicyFor(person("child"));
    for (const phrase of ["a joint effort", "a joint project", "weed the garden"]) {
      for (const field of fields) {
        expect(policy.check(phrase, field)).toBeNull();
        for (const text of [`${phrase} then roll it, light it and inhale`, `roll and smoke it with ${phrase}`, `${phrase} and ${phrase}`, `${phrase}. Then roll it and smoke it.`]) {
          expect(policy.check(text, field)?.kind).toBe("drugs");
        }
      }
    }
  });
  test("audiences take the stricter band and union present filters", () => {
    const own = createContentPolicyResolver({ readFilters: p => p.role === "adult" ? ["drugs"] : [] });
    const audience = { actor: person("adult"), band: "adult", present: [person("teen")], surface: "chat", surfaceClass: "written", spoken: false } satisfies Audience;
    expect(own.contentPolicyFor(audience).check(corpus[2]!.text, "prompt")?.kind).toBe("drugs");
    expect(own.contentPolicyFor(audience).check(corpus[4]!.text, "prompt")?.kind).toBe("gore");
    expect(own.contentPolicyFor({ ...audience, band: "child" }).filters.size).toBe(7);
  });
  test("trusted subject context blocks real people for minors, and never an adult (models censor for adults, the minor line still holds)", () => {
    for (const context of ["outside", "public", "unresolved"]) {
      const own = createContentPolicyResolver({ readFilters: () => [], readRealPersonContext: () => context });
      expect(own.contentPolicyFor(person("child")).check(corpus[2]!.text, "prompt")?.kind).toBe("real_person");
      expect(own.contentPolicyFor(person("teen")).check("Jon Stewart interviews Hitler on a talk show set", "prompt")?.kind).toBe("real_person");
      expect(own.contentPolicyFor(person("adult")).check("Jon Stewart interviews Hitler on a talk show set", "prompt")).toBeNull();
      expect(own.contentPolicyFor(person("adult")).check(`a sexual portrait of a public figure ${SEXUAL_WORDS[0]}`, "prompt")).toBeNull();
      expect(own.contentPolicyFor(person("teen")).check(`a sexual portrait of a public figure ${SEXUAL_WORDS[0]}`, "prompt")?.kind).toBe("real_person");
      expect(own.contentPolicyFor(person("child")).check(`a sexual portrait of a public figure ${SEXUAL_WORDS[0]}`, "prompt")?.kind).toBe("real_person");
      expect(own.contentPolicyFor(person("adult")).check(`${MINOR_MARKERS[0]} ${SEXUAL_WORDS[0]}`, "prompt")?.kind).toBe("minor_line");
    }
    const own = createContentPolicyResolver({ readFilters: () => [], readRealPersonContext: () => "household" });
    expect(own.contentPolicyFor(person("adult")).check("friendly garden", "title")).toBeNull();
    const bad = createContentPolicyResolver({ readFilters: () => [], readRealPersonContext: () => "unknown" });
    expect(bad.contentPolicyFor(person("adult")).check("garden", "title")).toEqual(fail);
  });
  test("settings are read once and the captured policy is deterministic", () => {
    let reads = 0;
    const extra: ProtectionKind[] = ["drugs"];
    const own = createContentPolicyResolver({ readFilters: () => { reads++; return extra; } });
    const policy = own.contentPolicyFor(person("adult"));
    extra.length = 0;
    for (let i = 0; i < 100; i++) expect(policy.check(corpus[2]!.text, "lyrics")?.kind).toBe("drugs");
    expect(reads).toBe(1);
  });
  test("a caller cannot change captured policy data", () => {
    const data = structuredClone(terms);
    const own = createContentPolicyResolver({ readFilters: () => [], data });
    data.terms.length = 0;
    const policy = own.contentPolicyFor(person("child"));
    expect(policy.check(corpus[2]!.text, "prompt")?.kind).toBe("drugs");
  });
  test("errors and invalid snapshots block safely", () => {
    for (const options of [
      { readFilters: () => { throw new Error("snapshot failed"); } },
      { readFilters: () => ["unknown"] }, { readFilters: () => null },
      { readFilters: () => [], data: {} },
      { readFilters: () => [], data: { ...terms, terms: [{ kind: "unknown", term: "garden", severity: "mild" }] } }, { readFilters: () => [], data: { ...terms, version: 2 } },
      { readFilters: () => [], kinds: { ...kinds, kinds: Array(7).fill("drugs") } },
    ]) expect(createContentPolicyResolver(options).contentPolicyFor(person("adult")).check("friendly garden", "prompt")).toEqual(fail);
    const policy = resolver.contentPolicyFor(person("adult"));
    expect(policy.check(null as never, "title")).toEqual(fail);
    expect(policy.check("garden", "unknown" as never)).toEqual(fail);
  });
  test("filters and policy data cannot be changed at runtime", () => {
    const policy = contentPolicyFor(person("child"));
    const set = policy.filters as Set<ProtectionKind>;
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(set)).toBe(true);
    expect(() => set.add("drugs")).toThrow();
    expect(() => set.delete("gore")).toThrow();
    expect(() => set.clear()).toThrow();
    expect(() => Set.prototype.clear.call(set)).toThrow();
    set.forEach((_value, _key, exposed) => expect(exposed).toBe(set));
    expect(() => (CHILD_UNSAFE_TERMS as string[]).pop()).toThrow();
    expect([...filtersFor(person("child"))]).toEqual([...set]);
  });
  test("reviewed boundaries stay safe without hiding other occurrences", () => {
    const policy = resolver.contentPolicyFor(person("child"));
    for (const text of boundaries.safe) expect(policy.check(text, "transcript")).toBeNull();
    for (const text of boundaries.unsafe) expect(policy.check(text, "transcript")?.kind).toBe("drugs");
  });
  test("the first match follows table order", () => {
    const text = [...corpus].reverse().map(row => row.text).join(" ");
    expect(resolver.contentPolicyFor(person("child")).check(text, "title")?.kind).toBe("swearing");
  });
  test("shared folded checks agree with the existing detector examples", () => {
    expect(contentChecksForFold(foldForSafety(SEXUAL_WORDS[0]!)).adultContent).toBe(true);
    expect(contentChecksForFold(foldForSafety(`${MINOR_MARKERS[0]} ${SEXUAL_WORDS[0]}`)).minorLine).toBe(true);
  });
  test("the ahead-of-spec declaration has plain copy and person scope", () => {
    expect(CONTENT_SETTINGS_KEYS[0]?.key).toBe("content.filters");
    expect(CONTENT_SETTINGS_KEYS[0]?.scope).toBe("person");
    expect(CONTENT_SETTINGS_KEYS[0]?.default).toEqual([]);
  });
  test("4000 characters including a final match have a median below 50 ms", () => {
    const policy = resolver.contentPolicyFor(person("child"));
    const suffix = corpus[2]!.text;
    const times: number[] = [];
    for (let i = 0; i < 61; i++) {
      const prefix = `garden ${i} `;
      const text = prefix + "a ".repeat(2000).slice(0, 4000 - prefix.length - suffix.length) + suffix;
      expect(text.length).toBe(4000);
      const start = performance.now();
      const result = policy.check(text, "transcript");
      times.push(performance.now() - start);
      expect(result?.kind).toBe("drugs");
    }
    const median = times.sort((a, b) => a - b)[30]!;
    console.info(`content policy 4000-character median: ${median.toFixed(2)} ms`);
    expect(median).toBeLessThan(50);
  });
});
