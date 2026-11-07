// LTXD-18B (docs/design/ltx-desktop-features-2026-11-06.md): which styles are OFFERED. A style is offered by default in the Create picker, in the chat tool's
// choices and in suggestions only when it is made for LTX-2.5, or made for LTX-2.3 and the bench marked it `tested` on 2.5. An untested 2.3 style is library-only
// (with one plain line); a `no_effect` file is never offered, and the Stack's refusal text reaches the person through the failing call's own response.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { resetDb } from "./reset-db";
import { __resetAdultLockForTests } from "@/lib/adultLock";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { loraUsable, runsOn, untestedLine } from "@/lib/loras/access";
import { __resetLoraSyncForTests, recordFromStack, syncLoras } from "@/lib/loras/sync";
import { getLoraRecord } from "@/lib/loras/store";
import { suggestStyles } from "@/lib/loras/suggest";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { styleChips } from "@/lib/videos/createStyles";
import { listableStyleNames, resolveStyles } from "@/lib/videos/styleChoice";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { makeAudienceOf } from "@/lib/videos/make";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { household } from "./fixtures/adultLock";
import { putLora } from "./fixtures/lora";
import type { Lora } from "@/lib/loras/store";
import type { StackVideoLora } from "@/lib/videos/stack";

setDefaultTimeout(30_000);
let fake: FakeVideoStack;
beforeEach(() => {
  resetDb(); __resetVideoAdapterCacheForTests(); __resetLoraSyncForTests(); __resetAdultLockForTests(); __resetThrottleForTests();
  fake = installFakeVideoStack();
  fake.loras = [];
});
afterEach(() => { fake.restore(); __setVideoStatusForTests(undefined); });

const ADULTS = { availability: { who: "adults", people: [] } } as Partial<Lora>;
const on25 = (name: string): Partial<Lora> => ({ name, base_model: "ltx-2.5", compatible_with: ["ltx-2.5"], ...ADULTS });
const on23 = (name: string, mark: "tested" | "no_effect" | null): Partial<Lora> => ({ name, base_model: "ltx-2.3", compatible_with: ["ltx-2.3"], tested_on_25: mark, untested_on_25: mark === null, ...ADULTS });

function engineWithStyles(): void {
  const status = readyVideoStatusForTests({ ltx25: "ready", ltx25max: "ready" });
  const loras = { supported: true, max: 2, mode: "unfused" as const, negative_prompt: "none" as const };
  status.qualities!.ltx25!.loras = loras;
  status.qualities!.ltx25max!.loras = loras;
  __setVideoStatusForTests(status);
}

describe("the offer rule", () => {
  test("loraUsable and runsOn: 2.5 yes; 2.3 only when tested; untested and no_effect never", async () => {
    const { row } = await household(); const by = row("Sage").id;
    const fresh = putLora(by, on25("Fresh"));
    const tested = putLora(by, on23("Clay", "tested"));
    const untested = putLora(by, on23("Dusty", null));
    const none = putLora(by, on23("Googly", "no_effect"));
    expect([fresh, tested, untested, none].map(loraUsable)).toEqual([true, true, false, false]);
    expect([fresh, tested, untested, none].map((l) => runsOn(l, "ltx-2.5"))).toEqual([true, true, false, false]);
    expect(untestedLine(fresh)).toBeNull();
    expect(untestedLine(tested)).toBeNull();
    expect(untestedLine(untested)).toBe("Made for an older video model. It is untested on the newer one, so it is not offered yet.");
    expect(untestedLine(none)).toBe("Made for an older video model. A test clip on the newer one showed no change, so it is not used.");
  });

  test("the picker, the chat tool's names and suggestions offer the 2.5 and the tested 2.3 style only", async () => {
    const { row } = await household(); const sage = row("Sage");
    putLora(sage.id, { ...on25("Paper craft"), description: "paper craft" });
    putLora(sage.id, { ...on23("Clay look", "tested"), description: "paper craft" });
    putLora(sage.id, { ...on23("Dusty look", null), description: "paper craft" });
    putLora(sage.id, { ...on23("Googly look", "no_effect"), description: "paper craft" });
    engineWithStyles();
    const audience = makeAudienceOf(sage);
    expect(listableStyleNames(audience)).toEqual(["Clay look", "Paper craft"]);
    const chips = styleChips({ person: sage, engine: readyVideoStatusForTests({ ltx25: "ready", ltx25max: "ready" }), offered: ["standard", "boost", "max"] });
    const labels = (chips.find((c) => c.state === "style")!.options as Array<{ label: string }>).map((o) => o.label);
    expect(labels).toEqual(["No style", "Paper craft", "Clay look"]);
    expect(suggestStyles({ person: sage, media: "video", text: "paper craft" }).items.map((l) => l.name).sort()).toEqual(["Clay look", "Paper craft"]);
  });

  test("a chat name or a stored id of an untested or no_effect style answers 'no longer available'; a tested one resolves", async () => {
    const { row } = await household(); const sage = row("Sage");
    const tested = putLora(sage.id, on23("Clay look", "tested"));
    const untested = putLora(sage.id, on23("Dusty look", null));
    const audience = makeAudienceOf(sage);
    const ok = await resolveStyles({ audience, names: ["Clay look"] });
    expect(ok.ok && ok.adapters.map((a) => a.id)).toEqual([tested.id]);
    expect(await resolveStyles({ audience, names: ["Dusty look"] })).toMatchObject({ ok: false, code: "style_gone" });
    expect(await resolveStyles({ audience, ids: [untested.id] })).toMatchObject({ ok: false, code: "style_gone" });
  });
});

describe("the Stack's marks reach the record", () => {
  const stackFile = (over: Partial<StackVideoLora>): StackVideoLora => ({ id: "claymation", name: "Claymation", sha256: "d".repeat(64), bytes: 1000, base_model: "ltx-2.3", licence: "MIT", source_url: null, classification: "all-ages", strength_default: 1, trigger_words: [], added_at: "2026-11-06T00:00:00.000Z", ...over });

  test("a new record copies the mark and untested flag of an ltx-2.3 file; an ltx-2.5 file holds none", () => {
    expect(recordFromStack(stackFile({ tested_on_25: "tested", untested_on_25: false }), null, "person-aaaaaa1")).toMatchObject({ tested_on_25: "tested", untested_on_25: false });
    expect(recordFromStack(stackFile({}), null, "person-aaaaaa1")).toMatchObject({ tested_on_25: null, untested_on_25: true });
    const fresh = recordFromStack(stackFile({ base_model: "ltx-2.5" }), null, "person-aaaaaa1")!;
    expect(fresh.tested_on_25).toBeUndefined();
  });

  test("a mark the Stack sets later replaces the record's copy on the next sync", async () => {
    const { row } = await household(); const by = row("Sage").id;
    const record = putLora(by, on23("Claymation", null));
    fake.loras = [stackFile({ id: record.id, sha256: record.file.sha256, bytes: record.file.bytes, tested_on_25: "tested", untested_on_25: false })];
    await syncLoras(true);
    expect(getLoraRecord(record.id)).toMatchObject({ tested_on_25: "tested", untested_on_25: false });
    expect(loraUsable(getLoraRecord(record.id)!)).toBe(true);
    fake.loras = [stackFile({ id: record.id, sha256: record.file.sha256, bytes: record.file.bytes, tested_on_25: "no_effect", untested_on_25: false })];
    await syncLoras(true);
    expect(loraUsable(getLoraRecord(record.id)!)).toBe(false);
  });
});

describe("a clip made with a tested 2.3 style", () => {
  test("the Stack's lora_warnings ride the clip's existing muted line (create.note)", async () => {
    const { owner, row } = await household(); const sage = row("Sage");
    const clay = putLora(sage.id, on23("Clay look", "tested"));
    fake.loras = [{ id: clay.id, name: clay.name, sha256: clay.file.sha256, bytes: 1000, base_model: "ltx-2.3", licence: "MIT", source_url: null, classification: "all-ages", strength_default: 1, trigger_words: [], added_at: clay.added_at, tested_on_25: "tested", untested_on_25: false }];
    fake.loraWarnings = [{ id: clay.id, code: "tested_on_25", message: "\"Clay look\" was made for LTX 2.3. It was tested on LTX 2.5 and changed the clip." }];
    engineWithStyles();
    const res = await owner.post("/api/videos/make", { prompt: "A paper boat floats down a rainy street", tier: "max", styles: [clay.id] });
    expect(res.status).toBe(200);
    const sent = fake.submitted[0]! as { loras: Array<{ id: string }> };
    expect(sent.loras.map((l) => l.id)).toEqual([clay.id]);
    const body = (await res.json()) as { id: string };
    await Bun.sleep(50);
    expect(getVideoJobFor(sage, body.id)!.request.create?.note).toContain("tested on LTX 2.5 and changed the clip");
  });

  test("a no_effect file the Stack refuses (422 lora_no_effect): its plain text is inside the failed job's own error line", async () => {
    const { owner, row } = await household(); const sage = row("Sage");
    const clay = putLora(sage.id, on23("Clay look", "tested"));
    fake.loras = [{ id: clay.id, name: clay.name, sha256: clay.file.sha256, bytes: 1000, base_model: "ltx-2.3", licence: "MIT", source_url: null, classification: "all-ages", strength_default: 1, trigger_words: [], added_at: clay.added_at, tested_on_25: "tested", untested_on_25: false }];
    const line = "\"Clay look\" was made for LTX 2.3 and changed nothing in a test clip on LTX 2.5, so it was not used. Pick another style, or make the video without one.";
    fake.refuseSubmit = { status: 422, code: "lora_no_effect", error: line };
    engineWithStyles();
    const res = await owner.post("/api/videos/make", { prompt: "A paper boat floats down a rainy street", tier: "max", styles: [clay.id] });
    const body = (await res.json()) as { id?: string; error?: string };
    await Bun.sleep(100);
    const job = body.id ? getVideoJobFor(sage, body.id) : null;
    expect(job?.state).toBe("failed");
    expect(job?.error).toContain(line);
  });
});
