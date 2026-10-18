import { z } from "zod";
import { policyWord, lanesSchema } from "./contentPolicy/dataSchema";
import { foldForSafety, TermSet } from "@maipai/spec/safety/ts/fold.js";
import { detectCsam } from "@maipai/spec/safety/ts/signals.js";
import { contentChecksForFold } from "./pictures/minorLine";
import { speakerAgeBand, type AgeBand } from "./ageBand";
import type { PersonRow as Person } from "@/types";
import type { PictureAudience } from "./pictures/policy";
import kindsData from "./contentPolicy/data/kinds.v1.json";
import termsData from "./contentPolicy/data/terms.v1.json";
import laneData from "./contentPolicy/data/lanes.v1.json";

export type ProtectionKind = "swearing" | "drugs" | "gambling" | "gore" | "sexual" | "minor_line" | "real_person";
export interface ContentPolicy {
  readonly filters: ReadonlySet<ProtectionKind>;
  check(text: string, field: "prompt" | "lyrics" | "title" | "transcript"): null | { kind: ProtectionKind; line: string };
}
export type Audience = PictureAudience & { readonly present?: readonly Person[] };
const kind = z.enum(["swearing", "drugs", "gambling", "gore", "sexual", "minor_line", "real_person"]);
const termKind = z.enum(["swearing", "drugs", "gambling", "gore"]);
const word = policyWord;
const termsSchema = z.object({ version: z.literal(1), terms: z.array(z.object({ kind: termKind, term: word, severity: z.enum(["mild", "strong"]) }).strict()).min(1), exceptions: z.array(z.object({ kind: termKind, term: word, phrase: word }).strict()) }).strict();
const kindsSchema = z.object({ version: z.literal(1), kinds: z.array(kind).length(7), lines: z.record(kind, z.string().min(1)), fallback: z.literal("I couldn't check that safely. Try something different.") }).strict();
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
const lanes = freeze(lanesSchema.parse(laneData));
export const CHILD_UNSAFE_TERMS: readonly string[] = lanes.CHILD_UNSAFE_TERMS;
export const CHILD_IP_NAMES: readonly string[] = lanes.CHILD_IP_NAMES;

function immutableSet(values: Iterable<ProtectionKind>): ReadonlySet<ProtectionKind> {
  const set = new Set(values);
  const blocked = (): never => { throw new TypeError("Content filters cannot be changed"); };
  const wrapper: ReadonlySet<ProtectionKind> & { add: typeof blocked; delete: typeof blocked; clear: typeof blocked } = {
    get size() { return set.size; }, has: (value) => set.has(value),
    entries: () => set.entries(), keys: () => set.keys(), values: () => set.values(),
    [Symbol.iterator]: () => set.values(),
    forEach(callback, thisArg) { set.forEach(value => callback.call(thisArg, value, value, wrapper)); },
    union: set.union.bind(set), intersection: set.intersection.bind(set),
    difference: set.difference.bind(set), symmetricDifference: set.symmetricDifference.bind(set),
    isSubsetOf: set.isSubsetOf.bind(set), isSupersetOf: set.isSupersetOf.bind(set), isDisjointFrom: set.isDisjointFrom.bind(set),
    add: blocked, delete: blocked, clear: blocked,
  };
  return Object.freeze(wrapper);
}
const defaults = freeze({ child: ["minor_line", "real_person", "sexual", "swearing", "drugs", "gambling", "gore"], teen: ["minor_line", "real_person", "sexual", "swearing", "gore"], adult: ["minor_line", "real_person"] } satisfies Record<AgeBand, ProtectionKind[]>);
const fallback = Object.freeze({ kind: "minor_line" as const, line: "I couldn't check that safely. Try something different." });
const ranks: Record<AgeBand, number> = { child: 0, teen: 1, adult: 2 };
function bandOf(person: Person): AgeBand {
  if (!person?.id || !["child", "teen", "adult", "owner", "admin"].includes(person.role)) return "child";
  // People creation permits absent adult birthdates. Only this policy uses the child
  // floor for those adults; leave speakerAgeBand's existing callers unchanged.
  if (!z.iso.date().safeParse(person.birthdate).success) return "child";
  return speakerAgeBand(person, new Date());
}

/** The reader must return a validated in-memory snapshot. No settings writes are enabled here. */
export function createContentPolicyResolver(options: { readFilters: (person: Person) => unknown; data?: unknown; kinds?: unknown; readRealPersonContext?: (subject: Person | Audience) => unknown }) {
  let compiled: { kinds: z.infer<typeof kindsSchema>; terms: Array<{ kind: z.infer<typeof termKind>; severity: "mild" | "strong"; matcher: TermSet; exceptions: RegExp[] }> } | undefined;
  try {
    const data = freeze(termsSchema.parse(options.data === undefined ? termsData : options.data));
    const kinds = freeze(kindsSchema.parse(options.kinds === undefined ? kindsData : options.kinds));
    if (termKind.options.some(k => !data.terms.some(t => t.kind === k))) throw new Error("Missing policy terms");
    if (new Set(kinds.kinds).size !== 7 || kind.options.some(k => !kinds.lines[k])) throw new Error("Invalid kinds");
    for (const e of data.exceptions) if (!data.terms.some(t => t.kind === e.kind && t.term === e.term)) throw new Error("Invalid exception");
    compiled = { kinds, terms: data.terms.map(t => ({
      ...t,
      matcher: new TermSet([t.term]),
      exceptions: data.exceptions.filter(e => e.kind === t.kind && e.term === t.term).flatMap(e =>
        [...new Set(foldForSafety(e.phrase).forms.map(form => form.text))].map(phrase =>
          new RegExp(`^${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "gu"))),
    })) };
  } catch { /* Invalid data leaves every check closed. */ }
  function resolve(subject: Person | Audience): ContentPolicy {
    let valid = !!compiled;
    let band: AgeBand = "child";
    let added: ProtectionKind[] = [];
    let realPersonBlocked = false;
    const filters = new Set<ProtectionKind>(defaults.child);
    try {
      const context = z.enum(["none", "household", "outside", "public", "unresolved"]).parse(options.readRealPersonContext ? options.readRealPersonContext(subject) : "none");
      realPersonBlocked = context === "outside" || context === "public" || context === "unresolved";
      const audience = subject && "actor" in subject ? subject : undefined;
      const persons = audience ? [audience.actor, ...(audience.present ?? [])] : [subject as Person];
      band = audience && audience.band in ranks ? audience.band : audience ? "child" : "adult";
      filters.clear();
      for (const person of persons) {
        const own = bandOf(person);
        if (ranks[own] < ranks[band]) band = own;
        const extra = z.array(kind).parse(options.readFilters(person));
        added = [...added, ...extra];
        for (const k of [...defaults[own], ...extra]) filters.add(k);
      }
      for (const k of defaults[band]) filters.add(k);
    } catch { valid = false; for (const k of defaults.child) filters.add(k); }
    const allProfanity = band !== "teen" || added.includes("swearing");
    return Object.freeze({ filters: immutableSet(filters), check(text, field) {
      try {
        if (!valid || !compiled || typeof text !== "string" || !["prompt", "lyrics", "title", "transcript"].includes(field)) return fallback;
        // No input truncation: the review measured about 2 s for a 1 MiB
        // repeated interior-mask input. Bounding shared masked scanning needs
        // a commons change and must preserve detection across the full input.
        const fold = foldForSafety(text);
        const block = (k: ProtectionKind) => ({ kind: k, line: compiled!.kinds.lines[k] });
        const shared = contentChecksForFold(fold);
        if (detectCsam(text).matched.length || shared.minorLine) return block("minor_line");
        if (realPersonBlocked) return block("real_person");
        if (filters.has("sexual") && shared.adultContent) return block("sexual");
        for (const k of ["swearing", "drugs", "gambling", "gore"] as const) {
          if (!filters.has(k)) continue;
          for (const t of compiled.terms) {
            if (t.kind !== k || (k === "swearing" && !allProfanity && t.severity !== "strong")) continue;
            if (t.matcher.matches(fold)) {
              // Exceptions cover the whole checked text only. Added context, including
              // a second occurrence, is ambiguous and keeps the restriction.
              const remainder = { ...fold, forms: fold.forms.map(form => ({ ...form, text: t.exceptions.reduce((text, pattern) => text.replace(pattern, " "), form.text) })) };
              if (t.matcher.matches(remainder)) return block(k);
            }
          }
        }
        return null;
      } catch { return fallback; }
    } } satisfies ContentPolicy);
  }
  return Object.freeze({ contentPolicyFor: resolve, filtersFor: (person: Person) => resolve(person).filters });
}
const resolver = createContentPolicyResolver({ readFilters: () => [] });
export const contentPolicyFor: (subject: Person | Audience) => ContentPolicy = resolver.contentPolicyFor;
export const filtersFor: (person: Person) => ReadonlySet<ProtectionKind> = resolver.filtersFor;
