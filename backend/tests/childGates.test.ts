// Two child rules that no test named until now, each observed at the level where that single rule is the thing seen (a second layer also stops the child today):
//   1. mediaSubjects.ts `subjectsForNames`: a real-person subject is never given to a child or a teen (the function's own result is null).
//   2. videos/tool.ts, the line that refuses a child a clip started from a saved subject's photo (reason `photos`, CHILD_NO_PHOTOS_LINE).
// Each was proved by removing the rule in a scratch copy: the test below failed, and the copy was restored (see the landing note).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { db } from "@/db";
import { mediaSubjects, people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { storeFile } from "@/lib/attachments";
import { createMediaSubject, subjectsForNames } from "@/lib/mediaSubjects";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { CHILD_NO_PHOTOS_LINE } from "@/lib/pictures/lane";
import { runGenerateVideo } from "@/lib/videos/tool";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { resetDb } from "./reset-db";
import { installFakeVideoStack } from "./videoFixture";
import { createBenchPeople } from "../scripts/bench/conversationRunner";

describe("child gates named by their own tests", () => {
  let owner: ReturnType<typeof createBenchPeople>["owner"];
  let fake: ReturnType<typeof installFakeVideoStack>;
  beforeEach(() => {
    resetDb(); owner = createBenchPeople().owner; fake = installFakeVideoStack();
    __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25Picture: true }));
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } })));
  });
  afterEach(async () => { await new Promise((r) => setTimeout(r, 50)); fake.restore(); });

  function personOf(role: string): typeof owner {
    const found = db.select().from(people).all().find((p) => p.role === role);
    if (found) return found as typeof owner;
    const now = new Date().toISOString(), id = `person-${role}gates`;
    db.insert(people).values({ id, displayName: role, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
    return db.select().from(people).where(eq(people.id, id)).get() as typeof owner;
  }
  async function subjectWithPhoto(name: string, real: boolean, who: typeof owner = owner) {
    const bytes = new Uint8Array(await sharp({ create: { width: 32, height: 32, channels: 3, background: "blue" } }).png().toBuffer());
    const stored = storeFile(who, { conversationId: null, turnId: null, mediaType: "image/png", bytes, provenance: `media-subject-reference:${JSON.stringify({ audience: "all-ages" })}`, deduplicate: false, retention: "kept" });
    if (!stored.ok) throw new Error("reference attachment failed");
    return createMediaSubject(who, { name, kind: "character", look: "A tiny blue fox", referenceIds: [stored.value.id], real });
  }

  test("subjectsForNames gives a real-person subject to nobody under 18, with everything else about it readable (mediaSubjects.ts, the child and teen refusal)", async () => {
    // The subject is the child's (or teen's) own, with their own readable photo: the only thing left between them and it is this rule. `real` is set by hand because the create path itself refuses a real subject to a minor.
    for (const role of ["child", "teen"]) {
      const minor = personOf(role);
      const own = await subjectWithPhoto(`${role} Pip`, false, minor);
      expect(subjectsForNames(minor, [own.name])).not.toBeNull();   // control: not real, so it is theirs to use and its photo loads
      db.update(mediaSubjects).set({ real: true }).where(eq(mediaSubjects.id, own.id)).run();
      expect(subjectsForNames(minor, [own.name])).toBeNull();
    }
    expect(subjectsForNames(owner, [(await subjectWithPhoto("Adult Pip", true)).name])).not.toBeNull();   // an adult may use a real subject: the rule is about age
  });

  test("a child asking for a clip from a saved character's photo is refused with the no-photos line and nothing is made (tool.ts, reason photos)", async () => {
    const child = personOf("child");
    const pip = await subjectWithPhoto("Pip", false, child);   // the child's own made-up character with a photo, so the earlier subject rules let it through and only the no-photos rule is left
    const result = await runGenerateVideo({ state: { actor: child, temporary: false, conversationId: null, turnId: null }, args: { prompt: "Pip waves hello", subjects: [pip.name] }, callId: "c", spoken: false, audience: { actor: child, band: "child", surface: "chat", surfaceClass: "written", spoken: false } as never });
    expect(JSON.stringify(result)).toContain(CHILD_NO_PHOTOS_LINE);
    expect(fake.submitted).toHaveLength(0);
  });
});
