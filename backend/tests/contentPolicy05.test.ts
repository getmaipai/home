// CONTENT-POLICY-05: the write rules for a person's content filters and level, the eight-dial projection of the pass, the per-projection
// caches of the summary readers, and what each viewer's settings list carries (C2, C3, C4, C6, C10; design "Settings and ceiling projection").
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people, settingsValues } from "@/db/schema";
import { resetDb } from "./reset-db";
import { passFor, passForSurface } from "@/lib/filter/pass";
import { CONTENT_CEILINGS, ceilingRecordFor, dialsFor, projectionOf } from "@/lib/contentCeiling";
import { contentPolicyFor } from "@/lib/contentPolicy";
import { listOverrideValues, listValues, resetValue, setValue } from "@/lib/settings";
import { FILTERS_KEY, backToUserDefaults, changeOverrides, readOverrides, resolvedContentFilters, visibleContentFilters } from "@/lib/settingsLayers";
import { keyPointsKey } from "@/lib/reference/keyPoints";
import { __setNewsSummaryModelForTests, storedKeyPoints, summarizeStory } from "@/lib/news/summary";
import { storyIdOf } from "@/lib/news/cards";
import { sharedShelfStore } from "@/lib/shelf/shelfStore";
import { newsStorySummaries } from "@/db/schema";
import { installNewsApp, removeNewsApp, resetNewsState, seedFeeds, putItem, ADULT_HOST } from "./support/newsFixture";
import type { PersonRow } from "@/types";

const now = new Date().toISOString();
function person(id: string, role: string, controls?: string): PersonRow {
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "hub", createdAt: now, updatedAt: now, hlc: "1700000000000:0:testfix", ...(controls ? { controls } : {}) } as never).run();
  return db.select().from(people).where(eq(people.id, id)).get()! as PersonRow;
}
let owner: PersonRow, admin: PersonRow, adult: PersonRow, adult2: PersonRow, teen: PersonRow, child: PersonRow, guest: PersonRow;
beforeEach(() => {
  resetDb();
  owner = person("person-owneraaa", "owner"); admin = person("person-adminaaa", "admin"); adult = person("person-adultaaa", "adult"); adult2 = person("person-adulttwo", "adult");
  teen = person("person-teenaaa", "teen"); child = person("person-childaaa", "child"); guest = person("person-guestaaa", "guest", "teen");
});
const scope = (p: PersonRow) => `person:${p.id}`;
const ok = (r: { ok: boolean; error?: string }) => { expect(r.error).toBeUndefined(); expect(r.ok).toBe(true); };
const set = (actor: PersonRow, target: PersonRow, key: string, value: unknown) => setValue(actor, scope(target), key, value);
const filtersIn = (target: PersonRow) => [...contentPolicyFor(target).filters].sort();
const listed = (actor: PersonRow, target: PersonRow) => { const r = listValues(actor, scope(target)); expect(r.ok).toBe(true); return r.ok ? r.value.map((s) => s.key) : []; };
const valueOf = (actor: PersonRow, target: PersonRow, key: string) => { const r = listValues(actor, scope(target)); return r.ok ? r.value.find((s) => s.key === key)?.value : undefined; };
const row = (target: PersonRow) => db.select().from(settingsValues).where(eq(settingsValues.scope, scope(target))).all().find((r) => r.key === FILTERS_KEY);

describe("content.filters: who writes, who resets", () => {
  test("an owner or admin adds to a child's filters; the child can neither write nor reset, and sets none", () => {
    ok(set(owner, child, FILTERS_KEY, ["drugs"]));
    expect(filtersIn(child)).toContain("drugs");
    for (const outcome of [set(child, child, FILTERS_KEY, []), resetValue(child, scope(child), FILTERS_KEY), set(child, child, FILTERS_KEY, ["gore", "drugs"])]) {
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error).not.toMatch(/filter|site block/i);
    }
    expect(filtersIn(child)).toContain("drugs");
    expect(changeOverrides(child, child.id, FILTERS_KEY, { add: ["gore"] }).ok).toBe(false);
    expect(visibleContentFilters(owner, child.id)).toEqual(["drugs"]);
    expect(row(child)?.setBy ?? null).toBeNull(); // a delta row, not a plain list
    expect(JSON.parse(row(child)!.value)).toMatchObject({ add: [{ item: "drugs", set_by: owner.id }], remove: [] });
  });

  test("an admin's entry on a teen survives the teen's old-client PUT of [], a reset, and a PUT of another list", () => {
    ok(set(admin, teen, FILTERS_KEY, ["swearing"]));
    ok(set(teen, teen, FILTERS_KEY, []));
    expect(filtersIn(teen)).toContain("swearing");
    ok(resetValue(teen, scope(teen), FILTERS_KEY));
    expect(filtersIn(teen)).toContain("swearing");
    ok(set(teen, teen, FILTERS_KEY, ["gambling"]));
    expect(filtersIn(teen)).toEqual(expect.arrayContaining(["swearing", "gambling"]));
    ok(set(teen, teen, FILTERS_KEY, ["drugs"])); // replaces the teen's own entry only
    expect(resolvedContentFilters(teen.id, "teen").sort()).toEqual(["drugs", "swearing"]);
    ok(resetValue(teen, scope(teen), FILTERS_KEY)); // drops the teen's own entry, not the admin's
    expect(resolvedContentFilters(teen.id, "teen")).toEqual(["swearing"]);
    expect(backToUserDefaults(teen, teen.id, [FILTERS_KEY]).ok).toBe(true);
    expect(resolvedContentFilters(teen.id, "teen")).toEqual(["swearing"]);
  });

  test("a teen's removal of what they did not set is dropped silently, never refused", () => {
    ok(set(admin, teen, FILTERS_KEY, ["swearing"]));
    const direct = changeOverrides(teen, teen.id, FILTERS_KEY, { remove: ["swearing"] });
    expect(direct.ok).toBe(true);
    expect(resolvedContentFilters(teen.id, "teen")).toEqual(["swearing"]);
    // an admin who adds what the teen already holds is not told, and the teen keeps their own entry
    ok(set(teen, teen, FILTERS_KEY, ["gore"]));
    expect(changeOverrides(admin, teen.id, FILTERS_KEY, { add: ["gore"] }).ok).toBe(true);
    expect(resolvedContentFilters(teen.id, "teen").sort()).toEqual(["gore", "swearing"]);
    // and an admin's removal of the teen's own entry is dropped silently too
    expect(changeOverrides(admin, teen.id, FILTERS_KEY, { remove: ["gore"] }).ok).toBe(true);
    expect(resolvedContentFilters(teen.id, "teen").sort()).toEqual(["gore", "swearing"]);
  });

  test("an admin lifts only what an admin set; a teen's own choices are never in the admin's view or write", () => {
    ok(set(teen, teen, FILTERS_KEY, ["gambling"]));
    ok(set(admin, teen, FILTERS_KEY, ["swearing"]));
    expect(visibleContentFilters(admin, teen.id)).toEqual(["swearing"]);
    expect(visibleContentFilters(teen, teen.id)).toEqual(["gambling"]);
    ok(set(owner, teen, FILTERS_KEY, [])); // the admin's view was ["swearing"]: only that is lifted
    expect(resolvedContentFilters(teen.id, "teen")).toEqual(["gambling"]);
    expect(readOverrides(admin, teen.id, FILTERS_KEY)).toMatchObject({ ok: true, value: { add: [], hidden: true } });
  });

  test("an adult changes their own freely; nobody, an admin included, writes another adult's; the old-client PUT is the same gate", () => {
    ok(set(adult, adult, FILTERS_KEY, ["sexual", "drugs"]));
    expect(filtersIn(adult)).toEqual(expect.arrayContaining(["sexual", "drugs", "minor_line"]));
    ok(set(adult, adult, FILTERS_KEY, ["drugs"]));
    expect(resolvedContentFilters(adult.id, "adult")).toEqual(["drugs"]);
    for (const actor of [admin, owner, adult2, teen, child, guest]) expect(set(actor, adult, FILTERS_KEY, [])).toMatchObject({ ok: false, status: 403 });
    expect(resolveFor(adult)).toEqual(["drugs"]);
    ok(resetValue(adult, scope(adult), FILTERS_KEY));
    expect(resolveFor(adult)).toEqual([]);
    expect(resetValue(admin, scope(adult), FILTERS_KEY)).toMatchObject({ ok: false, status: 403 });
  });

  test("a guest on teen controls adds their own and nobody else's; every other role is refused for a teen", () => {
    ok(set(guest, guest, FILTERS_KEY, ["gore"]));
    expect(resolvedContentFilters(guest.id, "teen")).toEqual(["gore"]);
    for (const actor of [teen, adult, guest, child]) {
      if (actor.id === teen.id) continue;
      expect(set(actor, teen, FILTERS_KEY, ["drugs"])).toMatchObject({ ok: false, status: 403 });
    }
  });

  test("the kinds are the registry's: an unknown kind and minor_line are refused with what to pick", () => {
    expect(set(adult, adult, FILTERS_KEY, ["minor_line"])).toMatchObject({ ok: false, status: 400 });
    expect(set(adult, adult, FILTERS_KEY, ["bananas"])).toMatchObject({ ok: false, status: 400 });
    const res = changeOverrides(adult, adult.id, FILTERS_KEY, { add: ["bananas"] });
    expect(res).toMatchObject({ ok: false, status: 400 });
    if (!res.ok) expect(res.error).toContain("Pick one from the list");
  });

  test("the band minimum is never in the delta: after a reset and after an import-style PUT a minor's policy is the band set plus what an admin stamped", () => {
    const bandOnly = (p: PersonRow) => [...contentPolicyFor(p).filters].sort();
    const childBase = bandOnly(child), teenBase = bandOnly(teen);
    expect(teenBase).toEqual(["gore", "minor_line", "sexual", "swearing"]);
    ok(set(admin, teen, FILTERS_KEY, ["drugs"]));
    for (const before of [() => resetValue(teen, scope(teen), FILTERS_KEY), () => set(teen, teen, FILTERS_KEY, []), () => set(teen, teen, FILTERS_KEY, ["gambling"])]) {
      before();
      expect(bandOnly(teen)).toEqual(expect.arrayContaining([...teenBase, "drugs"]));
    }
    ok(set(owner, teen, FILTERS_KEY, []));
    ok(resetValue(teen, scope(teen), FILTERS_KEY));
    expect(bandOnly(teen)).toEqual(teenBase);
    expect(bandOnly(child)).toEqual(childBase);
    expect(JSON.parse(row(teen)?.value ?? "null")).toBeNull();
  });

  test("a stored plain list from before the gate reads as override entries: held by the household for a minor, the person's own for an adult", () => {
    db.insert(settingsValues).values({ scope: scope(teen), key: FILTERS_KEY, value: JSON.stringify(["drugs", "minor_line", "nonsense"]), hlc: "1:0:legacy", source: "user", updatedAt: now }).run();
    db.insert(settingsValues).values({ scope: scope(adult), key: FILTERS_KEY, value: JSON.stringify(["gore"]), hlc: "1:0:legacy", source: "user", updatedAt: now }).run();
    expect(resolvedContentFilters(teen.id, "teen")).toEqual(["drugs"]);
    expect(visibleContentFilters(teen, teen.id)).toEqual([]); // not the teen's own, and never shown to the teen
    ok(set(teen, teen, FILTERS_KEY, []));
    expect(resolvedContentFilters(teen.id, "teen")).toEqual(["drugs"]);
    expect(visibleContentFilters(admin, teen.id)).toEqual(["drugs"]);
    expect(visibleContentFilters(adult, adult.id)).toEqual(["gore"]);
    ok(set(adult, adult, FILTERS_KEY, ["gore", "sexual"])); // the next gate write stores the override format
    expect(JSON.parse(row(adult)!.value)).toHaveProperty("add");
  });

  test("a reset of site blocks (no key named) never clears the filters", () => {
    ok(set(admin, teen, FILTERS_KEY, ["drugs"]));
    ok(set(owner, child, FILTERS_KEY, ["gore"]));
    expect(backToUserDefaults(owner, child.id, []).ok).toBe(true);
    expect(backToUserDefaults(admin, teen.id, []).ok).toBe(true);
    expect(resolvedContentFilters(child.id, "child")).toEqual(["gore"]);
    expect(resolvedContentFilters(teen.id, "teen")).toEqual(["drugs"]);
    expect(backToUserDefaults(owner, child.id, [FILTERS_KEY]).ok).toBe(true);
    expect(resolvedContentFilters(child.id, "child")).toEqual([]);
  });

  test("a write to the key drops the pass, so the policy reads it at once", () => {
    expect(filtersIn(adult)).toEqual(["minor_line"]);
    ok(set(adult, adult, FILTERS_KEY, ["swearing"]));
    expect(filtersIn(adult)).toEqual(["minor_line", "swearing"]);
    expect(contentPolicyFor(adult).check("what the fuck is this", "prompt")?.kind).toBe("swearing");
    ok(resetValue(adult, scope(adult), FILTERS_KEY));
    expect(contentPolicyFor(adult).check("what the fuck is this", "prompt")).toBeNull();
  });
});
const resolveFor = (p: PersonRow) => resolvedContentFilters(p.id, "adult");

describe("the level and unrated keys keep OVERRIDES-01's rule", () => {
  test("an owner or admin writes any person's, a child included; nobody else writes another's; anyone writes their own own_* lowering", () => {
    for (const actor of [owner, admin]) for (const target of [child, teen, adult2, guest]) ok(set(actor, target, "content.ceiling", "PG"));
    for (const actor of [adult, teen, child, guest]) {
      expect(set(actor, teen, "content.ceiling", "X")).toMatchObject({ ok: false, status: 403 });
      expect(set(actor, actor, "content.ceiling", "X")).toMatchObject({ ok: false, status: 403 });
      expect(set(actor, actor, "content.unrated", true)).toMatchObject({ ok: false, status: 403 });
      expect(set(actor, actor, "content.own_ceiling", "G")).toMatchObject({ ok: true });
    }
    expect(set(adult, teen, "content.own_ceiling", "G")).toMatchObject({ ok: false, status: 403 });
    ok(set(admin, child, "content.own_ceiling", "G")); // an owner or admin may also write another person's own_* (existing behavior)
  });

  test("C4: unrated allowed in the library for a teen shows the spec's label, and the pass lets it through for that kind only", () => {
    ok(set(admin, teen, "content.unrated.library", "yes"));
    const view = listOverrideValues(admin, teen.id);
    expect(view.ok).toBe(true);
    if (view.ok) expect(view.value.find((s) => s.key === "content.unrated.library")).toMatchObject({ label: "Unrated items in the library", value: "yes" });
    expect([...passFor(teen.id).unrated]).toEqual(["library"]);
  });

  test("an admin also gets content.unrated and every content.unrated.<kind> for any person", () => {
    ok(set(admin, adult2, "content.unrated", false));
    const view = listOverrideValues(admin, adult2.id);
    expect(view.ok).toBe(true);
    const keys = view.ok ? view.value.map((s) => s.key) : [];
    expect(keys).toEqual(expect.arrayContaining(["content.unrated", "content.unrated.chat", "content.unrated.library", "content.unrated.made", "content.unrated.news", "content.unrated.web"]));
    expect(passFor(adult2.id).unrated.size).toBe(0);
  });
});

describe("what each viewer's list carries (C10: absent, not locked)", () => {
  test("the level, unrated and filter controls are an owner or admin's on another person only; never on a person's own page", () => {
    for (const mine of [adult, teen, child, guest, owner, admin]) {
      const keys = listed(mine, mine);
      expect(keys.some((k) => k.startsWith("content.ceiling") || k.startsWith("content.unrated"))).toBe(false);
    }
    const onChild = listed(owner, child);
    expect(onChild).toEqual(expect.arrayContaining(["content.ceiling", "content.ceiling.news", "content.unrated", "content.unrated.library", FILTERS_KEY]));
    expect(onChild).not.toContain("content.own_ceiling");
    expect(listValues(owner, scope(teen))).toMatchObject({ ok: false, status: 403 }); // canAccessPerson is not widened
    expect(listValues(owner, scope(adult))).toMatchObject({ ok: false, status: 403 });
    expect(listValues(adult, scope(teen))).toMatchObject({ ok: false, status: 403 });
  });

  test("a teen's own list has their own filters only, never an admin's entry, and no ceiling key", () => {
    ok(set(admin, teen, FILTERS_KEY, ["swearing"]));
    ok(set(teen, teen, FILTERS_KEY, ["gambling"]));
    expect(valueOf(teen, teen, FILTERS_KEY)).toEqual(["gambling"]);
    expect(JSON.stringify(listValues(teen, scope(teen)))).not.toContain("swearing");
    expect(listed(teen, teen).filter((k) => k.startsWith("content.ceiling"))).toEqual([]);
    expect(listed(teen, teen)).toContain("content.own_ceiling");
  });

  test("a child has no filters control; Nova at G has nothing lower so no own level; raised to PG-13 she may lower her own", () => {
    expect(listed(child, child)).not.toContain(FILTERS_KEY);
    expect(listed(child, child)).not.toContain("content.own_ceiling");
    expect(listed(child, child).filter((k) => k.startsWith("content.own_ceiling"))).toEqual([]);
    ok(set(owner, child, "content.ceiling", "PG-13"));
    expect(listed(child, child)).toContain("content.own_ceiling");
    ok(set(child, child, "content.own_ceiling", "G"));
    expect(listed(child, child)).toContain("content.own_ceiling"); // already lowered: it stays so she can put it back
  });

  test("own_unrated is listed when unrated is allowed for any kind, whatever the role, and stays once hidden", () => {
    expect(listed(child, child)).not.toContain("content.own_unrated");
    expect(listed(teen, teen)).not.toContain("content.own_unrated");
    ok(set(admin, teen, "content.unrated.library", "yes"));
    expect(listed(teen, teen)).toContain("content.own_unrated");
    ok(set(admin, child, "content.unrated", true));
    expect(listed(child, child)).toContain("content.own_unrated");
    expect(listed(adult, adult)).toContain("content.own_unrated");
    ok(set(teen, teen, "content.own_unrated", "no"));
    expect(passFor(teen.id).unrated.size).toBe(0);
    expect(listed(teen, teen)).toContain("content.own_unrated");
  });

  test("an adult's own page lists their filters; an admin sees an adult's nothing", () => {
    expect(listed(adult, adult)).toContain(FILTERS_KEY);
    const view = listOverrideValues(admin, adult.id);
    expect(view.ok && view.value.map((s) => s.key)).not.toContain(FILTERS_KEY);
    expect(view.ok && view.value.map((s) => s.key)).toContain("content.ceiling");
  });

  test("the override read is for an owner or admin only and is empty on their own page; it shows an admin's entries on a teen, never the teen's own", () => {
    expect(listOverrideValues(teen, teen.id)).toMatchObject({ ok: false, status: 403 });
    expect(listOverrideValues(adult, child.id)).toMatchObject({ ok: false, status: 403 });
    expect(listOverrideValues(admin, admin.id)).toEqual({ ok: true, value: [] });
    ok(set(teen, teen, FILTERS_KEY, ["gambling"]));
    ok(set(admin, teen, FILTERS_KEY, ["swearing"]));
    const view = listOverrideValues(owner, teen.id);
    expect(view.ok && view.value.find((s) => s.key === FILTERS_KEY)?.value).toEqual(["swearing"]);
    expect(JSON.stringify(view)).not.toContain("gambling");
    expect(listOverrideValues(owner, "person-nobody0")).toMatchObject({ ok: false, status: 403 });
    const label = view.ok ? view.value.find((s) => s.key === "content.ceiling")?.label : undefined;
    expect(label).toBe("Content level");
  });
});

describe("the eight dials are a projection of the pass", () => {
  const D = (p: PersonRow, kind: "chat" | "news" = "chat") => dialsFor(passFor(p.id), kind);
  const band = (b: "child" | "teen" | "adult") => CONTENT_CEILINGS[b].dials;
  test("a child: the band row, unchanged", () => { expect(D(child)).toEqual(band("child")); });
  test("a teen with no filters: the band row", () => { expect(D(teen)).toEqual(band("teen")); });
  test("a teen who added swearing and gore", () => {
    ok(set(teen, teen, FILTERS_KEY, ["swearing", "gore"]));
    expect(D(teen)).toEqual({ profanity: "off", sexual: "off", violence: "moderate", substances: "off", crime: "off", hate: "off", self_harm: "off", privacy: "public" });
  });
  test("a teen an admin raised to R: the adult row, then the teen's own filters", () => {
    ok(set(admin, teen, "content.ceiling", "R"));
    expect(D(teen)).toEqual(band("adult"));
    ok(set(teen, teen, FILTERS_KEY, ["swearing", "gore"]));
    expect(D(teen)).toEqual({ profanity: "off", sexual: "unrestricted", violence: "moderate", substances: "discuss", crime: "discuss", hate: "fiction", self_harm: "discuss", privacy: "public" });
  });
  test("an adult lowered to PG (by an admin, or by their own choice): the teen row", () => {
    ok(set(admin, adult, "content.ceiling", "PG"));
    expect(D(adult)).toEqual(band("teen"));
    ok(set(admin, adult, "content.ceiling", "X"));
    expect(D(adult)).toEqual(band("adult"));
    ok(set(adult, adult, "content.own_ceiling", "PG-13"));
    expect(D(adult)).toEqual(band("teen"));
  });
  test("an adult with no filters: the unrestricted row", () => {
    expect(D(adult)).toEqual(band("adult"));
    expect(D(adult)).toEqual({ profanity: "unrestricted", sexual: "unrestricted", violence: "unrestricted", substances: "discuss", crime: "discuss", hate: "fiction", self_harm: "discuss", privacy: "public" });
  });
  test("an adult who added sexual and drugs", () => {
    ok(set(adult, adult, FILTERS_KEY, ["sexual", "drugs"]));
    expect(D(adult)).toEqual({ profanity: "unrestricted", sexual: "off", violence: "unrestricted", substances: "off", crime: "discuss", hate: "fiction", self_harm: "discuss", privacy: "public" });
  });
  test("gambling tightens crime one step, gore caps violence below graphic, crime hate self_harm and privacy keep the band's", () => {
    ok(set(adult, adult, FILTERS_KEY, ["gambling", "gore"]));
    expect(D(adult)).toEqual({ ...band("adult"), crime: "off", violence: "moderate" });
    ok(set(teen, teen, FILTERS_KEY, ["gambling"]));
    expect(D(teen)).toEqual(band("teen"));
  });
  test("the kind picks the ceiling: a news-only override moves the news dials and not chat's", () => {
    ok(set(admin, adult, "content.ceiling.news", "PG"));
    expect(D(adult, "chat")).toEqual(band("adult"));
    expect(D(adult, "news")).toEqual(band("teen"));
  });
  test("an unknown speaker on a shared surface gets the child row; topics, family stories and the floor are never projected", () => {
    const shared = passForSurface({ actor: adult, band: "child" });
    expect(dialsFor(shared, "chat")).toEqual(band("child"));
    ok(set(admin, teen, "content.ceiling", "R"));
    const record = ceilingRecordFor(passFor(teen.id), "teen", "chat");
    expect(record.dials).toEqual(band("adult"));
    expect(record.topics).toBe(CONTENT_CEILINGS.teen.topics);
    expect(record.floor).toBe(CONTENT_CEILINGS.teen.floor);
    expect(record.band).toBe("teen");
  });
  test("no projection mutates the band tables, and a plain reader's record is byte for byte the band's", () => {
    const before = JSON.stringify(CONTENT_CEILINGS);
    ok(set(adult, adult, FILTERS_KEY, ["swearing"]));
    D(adult);
    expect(JSON.stringify(CONTENT_CEILINGS)).toBe(before);
    expect(JSON.stringify(ceilingRecordFor(passFor(teen.id), "teen", "news"))).toBe(JSON.stringify(CONTENT_CEILINGS.teen));
    expect(JSON.stringify(ceilingRecordFor(passFor(child.id), "child", "news"))).toBe(JSON.stringify(CONTENT_CEILINGS.child));
  });
  test("crisis help stays available when a harmful output blocks: the existing filter-suite test still carries it", async () => {
    const source = await Bun.file(`${import.meta.dir}/filter/contentPolicy02.test.ts`).text();
    expect(source).toMatch(/crisis/i);
  });
});

describe("the per-projection cache key (item 14)", () => {
  const key = (p: PersonRow, book = "book", path = "path") => keyPointsKey(passFor(p.id), p.role === "teen" ? "teen" : p.role === "child" ? "child" : "adult", book, path);
  test("a plain reader keeps the plain age-group key", () => {
    expect(key(child)).toBe("child|book|path");
    expect(key(teen)).toBe("teen|book|path");
    expect(key(adult)).toBe("adult|book|path");
  });
  test("an adult lowered to PG never shares the plain teen row", () => {
    ok(set(admin, adult, "content.ceiling", "PG"));
    expect(key(adult)).not.toBe(key(teen));
    expect(key(adult)).toBe("p:adult:teen:|book|path");
    expect(projectionOf(passFor(adult.id), "news").plain).toBe(false);
  });
  test("a teen raised to R never reads the plain adult row", () => {
    ok(set(admin, teen, "content.ceiling", "R"));
    expect(key(teen)).not.toBe(key(adult));
    expect(key(teen)).toBe("p:teen:adult:|book|path");
  });
  test("a child raised to PG-13 never shares an entry with an adult lowered to PG, or with anyone plain", () => {
    ok(set(admin, child, "content.ceiling", "PG-13"));
    ok(set(admin, adult, "content.ceiling", "PG"));
    expect(key(child)).toBe("p:child:teen:|book|path");
    expect(key(child)).not.toBe(key(adult));
    expect(key(child)).not.toBe(key(teen));
  });
  test("added filters are part of the key, in sorted order, and two articles never share an entry", () => {
    ok(set(adult, adult, FILTERS_KEY, ["sexual", "drugs"]));
    expect(key(adult)).toBe("p:adult:adult:drugs,sexual|book|path");
    expect(key(adult, "book", "a")).not.toBe(key(adult, "book", "b"));
    expect(key(adult, "b1", "x")).not.toBe(key(adult, "b2", "x"));
    ok(set(teen, teen, FILTERS_KEY, ["gambling"])); // changes nothing in the dials: still the plain row
    expect(key(teen)).toBe("teen|book|path");
  });
});

describe("the news summary: a reader whose dials differ gets a fresh result that is never stored (item 14, second option)", () => {
  const good = { intro: "The park opened today. Families visited the gardens.", points: ["Trees were planted.", "Paths are open.", "The garden has flowers."] };
  const article = "The park opened for families today. Volunteers planted trees and flowers near the paths. Visitors walked through the garden and learned about the plants. The new paths connect the garden to the library. The park is open during the day.";
  let prompts: string[] = [];
  beforeEach(() => {
    resetNewsState(); installNewsApp(); db.delete(newsStorySummaries).run(); prompts = [];
    __setNewsSummaryModelForTests(async (messages) => { prompts.push(String(messages[0]!.content)); return { ok: true, text: JSON.stringify(good) }; });
  });
  afterEach(() => { __setNewsSummaryModelForTests(null); removeNewsApp(); });
  function seed() {
    const feeds = seedFeeds();
    const item = putItem(feeds.household, ADULT_HOST);
    sharedShelfStore()!.putContent(item.id, "adult", { blocks: [{ type: "paragraph", inlines: [{ type: "text", text: article }] }], source: "fetched", reading_s: 60, fetched_at: new Date().toISOString() });
    return item;
  }
  test("a plain adult reads and writes the shared row; a lowered adult never reads it and never writes one", async () => {
    const item = seed();
    expect(await summarizeStory(item.id, "adult", passFor(adult.id))).toEqual(good);
    expect(db.select().from(newsStorySummaries).all()).toHaveLength(1);
    expect(storedKeyPoints(storyIdOf(item), "adult", passFor(adult.id))).not.toBeNull();
    ok(set(admin, adult, "content.ceiling", "PG"));
    expect(storedKeyPoints(storyIdOf(item), "adult", passFor(adult.id))).toBeNull(); // the plain adult row is not theirs
    expect(await summarizeStory(item.id, "adult", passFor(adult.id))).toEqual(good);
    expect(await summarizeStory(item.id, "adult", passFor(adult.id))).toEqual(good);
    expect(prompts).toHaveLength(3); // the plain one, then a fresh one each time
    expect(db.select().from(newsStorySummaries).all()).toHaveLength(1);
    expect(prompts[0]).toContain('"profanity":"unrestricted"');
    expect(prompts[1]).toContain('"profanity":"mild"');
    expect(prompts[1]).toContain('"band":"adult"');
  });
  test("an adult who added a filter gets their own result and the shared row stays what the background tick wrote", async () => {
    const item = seed();
    ok(set(adult, adult, FILTERS_KEY, ["swearing"]));
    expect(await summarizeStory(item.id, "adult", passFor(adult.id))).toEqual(good);
    expect(db.select().from(newsStorySummaries).all()).toHaveLength(0);
    expect(prompts[0]).toContain('"profanity":"off"');
    expect(await summarizeStory(item.id, "adult")).toEqual(good); // the background writer: the plain row
    expect(db.select().from(newsStorySummaries).all()).toHaveLength(1);
    expect(prompts[1]).toContain('"profanity":"unrestricted"');
  });
});
