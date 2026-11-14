// CREATOR-26: the Talking avatar page. A cast member plus one typed line, made through the same generate_video call the Create page uses,
// with the line in quotes (after the speech normalizer) and no start picture. Chat gets no new argument.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { normalizeForSpeech } from "@maipai/spec/voice/ts/normalizeForSpeech.js";
import { PageNodeSchema } from "@/kit/schema/types";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { createMediaSubject } from "@/lib/mediaSubjects";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { quotedLine, SAY_FIRST_LINE } from "@/lib/videos/make";
import { resetDb } from "./reset-db";
import { household } from "./fixtures/adultLock";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import type { PersonRow } from "@/types";

let fake: FakeVideoStack;
beforeEach(() => { resetDb(); __resetVideoAdapterCacheForTests(); fake = installFakeVideoStack(); });
afterEach(() => { fake.restore(); });

const PAGE = "/api/plugins/video/pages/talking-avatar";
const findBar = (n: any): any => (n && typeof n === "object" ? (n.type === "prompt_bar" ? n : Object.values(n).map(findBar).find(Boolean)) : undefined);

describe("the served page", () => {
  test("an adult gets a page that passes the kit schema, with a cast slot, at most six chips, every chip icon-only with an icon", async () => {
    const { owner } = await household();
    const res = await owner.get(PAGE);
    expect(res.status).toBe(200);
    const page = (await res.json()) as { body: unknown };
    expect(PageNodeSchema.safeParse(page).success).toBe(true);
    const bar = findBar(page.body);
    expect(bar.placeholder).toBe("Type what they should say.");
    expect(bar.references.some((r: any) => r.kind === "character")).toBe(true);
    expect(bar.references.some((r: any) => r.kind === "picture")).toBe(false);
    expect(bar.chips.length).toBeGreaterThan(0);
    expect(bar.chips.length).toBeLessThanOrEqual(6);
    for (const chip of bar.chips) {
      expect(chip.icon_only).toBe(true);
      expect(typeof chip.icon).toBe("string");
    }
    const states = bar.chips.map((c: any) => c.state);
    expect(states).toContain("orientation");
    expect(states).toContain("seconds");
    expect(bar.tier?.state).toBe("tier");
  });

  test("the submit call makes a clip with the cast id, a spoken line and no start picture", async () => {
    const { owner } = await household();
    const bar = findBar(await (await owner.get(PAGE)).json().then((p) => (p as { body: unknown }).body));
    const call = bar.submit.call;
    expect(call.target).toBe("/api/plugins/video/actions/make");
    expect(call.args.cast).toBe("{cast}");
    expect(call.args.prompt).toBe("{prompt}");
    expect(call.args.speak).toBe(true);
    expect(call.args.start_frame).toBeUndefined();
    expect(bar.starts).toBe("video");
  });

  test("a teen and a child get the same answer as the Create page", async () => {
    const { teen, child } = await household();
    for (const who of [teen, child]) {
      const create = await who.client.get("/api/plugins/video/pages/create");
      const talking = await who.client.get(PAGE);
      expect(talking.status).toBe(create.status);
    }
  });
});

describe("the line", () => {
  test("goes through the speech normalizer and sits inside quotes, quotes typed by the person are softened", () => {
    expect(quotedLine("It is 4:00 pm, and I am 5.")).toBe(`"${normalizeForSpeech("It is 4:00 pm, and I am 5.")}"`);
    expect(quotedLine('She said "hi" to me')).not.toContain('""');
    expect(quotedLine('She said "hi" to me').match(/"/g)).toHaveLength(2);
    expect(quotedLine("   ")).toBe("");
  });
});

describe("Generate", () => {
  const actorOf = (name: string) => db.select().from(peopleTable).where(eq(peopleTable.displayName, name)).get()! as PersonRow;

  test("a cast member and a line start a clip whose prompt holds the quoted line, with no start picture", async () => {
    const { adult } = await household();
    const saved = createMediaSubject(actorOf("Marlow"), { name: "Pip", kind: "character", look: "a tiny blue fox" });
    const res = await adult.client.post("/api/plugins/video/actions/make", { prompt: "Good morning, everyone.", cast: saved.id, speak: true, orientation: "portrait", seconds: 5 });
    expect(res.status).toBe(200);
    expect(fake.submitted).toHaveLength(1);
    const prompt = String(fake.submitted[0]!.prompt);
    expect(prompt).toContain(`"${normalizeForSpeech("Good morning, everyone.")}"`);
    expect(prompt).toContain("a tiny blue fox");
    expect(fake.submitted[0]!.image).toBeUndefined();
  });

  test("no cast member picked starts nothing and says what to do", async () => {
    const { adult } = await household();
    const res = await adult.client.post("/api/plugins/video/actions/make", { prompt: "Hello.", cast: "{cast}", speak: true });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe(SAY_FIRST_LINE);
    expect(fake.submitted).toHaveLength(0);
  });

  test("a made-up cast id is refused with the cast line", async () => {
    const { adult } = await household();
    const res = await adult.client.post("/api/plugins/video/actions/make", { prompt: "Hello.", cast: "msub-ffffffffff", speak: true });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toContain("not in your cast list");
    expect(fake.submitted).toHaveLength(0);
  });

  test("a child and a teen are refused like on the Create page", async () => {
    const { teen, child } = await household();
    for (const who of [teen, child]) {
      const res = await who.client.post("/api/plugins/video/actions/make", { prompt: "Hello.", cast: "x", speak: true });
      expect([403, 404]).toContain(res.status);
    }
    expect(fake.submitted).toHaveLength(0);
  });
});
