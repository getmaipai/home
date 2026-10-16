import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { deviceCommands, notificationDeliveries, people, robotOffers } from "@/db/schema";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { setHouseholdSettingValue, setValue } from "@/lib/settings";
import { answerRobotOffer, createRobotOffer, dispatchRobotOffers, sweepRobotOffers, snoozeRobotOffer, OFFER_SNOOZE_MS } from "@/lib/robotOffers";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

// Local noon on a fixed day: outside the default 21:00 to 07:00 quiet hours.
const NOON = new Date(2026, 9, 16, 12, 0, 0);
const at = (minutes: number) => new Date(NOON.getTime() + minutes * 60_000);
// The accepting turn checks expiry against the real clock, so its offers outlive any real now.
const TEN_YEARS_MIN = 10 * 365 * 24 * 60;

async function household() {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  const adult = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  const childId = (await (await client.post("/api/people", { displayName: "Rin", role: "child" })).json() as { id: string }).id;
  const child = db.select().from(people).where(eq(people.id, childId)).get()!;
  setHouseholdSettingValue("household.quiet_hours.from", "21:00");
  setHouseholdSettingValue("household.quiet_hours.to", "07:00");
  setHouseholdSettingValue("robot.initiative.tiers_spoken", "all");
  const adultRobot = issueDeviceToken(adult.id, "robot", "Reachy Mini").deviceId;
  const childRobot = issueDeviceToken(child.id, "robot", "Reachy Mini").deviceId;
  return { client, adult, child, adultRobot, childRobot };
}

function allowHere(deviceId: string): void {
  // device scope is owner or admin only; the tests act as the owner
  const owner = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  expect(setValue(owner, `device:${deviceId}`, "robot.initiative.allowed_here", true).ok).toBe(true);
}

const offerFor = (personId: string, tier: 1 | 2 | 3 = 2, now = NOON, ttlMin = 10) =>
  createRobotOffer({ personId, tier, text: "Your package is out for delivery today.", nonPersonalLine: "I have something for you.", provenance: "heartbeat:delivery", expiresAt: new Date(now.getTime() + ttlMin * 60_000), now });

const commandsFor = (deviceId: string) => db.select().from(deviceCommands).all().filter((row) => row.deviceId === deviceId && row.kind === "offer");

describe("INITIATIVE-01 gates", () => {
  test("an adult's offer is sent once as an offer command that never carries the prepared text", async () => {
    const { adult, adultRobot } = await household();
    allowHere(adultRobot);
    const offer = offerFor(adult.id);
    expect(dispatchRobotOffers(NOON).sent).toEqual([offer.id]);
    const commands = commandsFor(adultRobot);
    expect(commands).toHaveLength(1);
    expect(JSON.parse(commands[0]!.payload)).toEqual({ offer_id: offer.id, person_id: adult.id, tier: 2, non_personal_line: "I have something for you." });
    expect(commands[0]!.payload).not.toContain("package");
    expect(dispatchRobotOffers(at(1)).sent).toEqual([]);
  });

  test("a child never receives a tier 2 or 3 offer without the parent switch", async () => {
    const { client, adult, child, childRobot } = await household();
    allowHere(childRobot);
    const two = offerFor(child.id, 2);
    const three = offerFor(child.id, 3);
    expect(dispatchRobotOffers(NOON)).toMatchObject({ sent: [], held: expect.arrayContaining([{ id: two.id, hold: "may_address" }, { id: three.id, hold: "may_address" }]) });
    // the child cannot flip the switch for themselves
    const asChild = db.select().from(people).where(eq(people.id, child.id)).get()!;
    expect(setValue(asChild, `person:${child.id}`, "person.robot.may_address", true)).toMatchObject({ ok: false, status: 403 });
    expect(dispatchRobotOffers(NOON).sent).toEqual([]);
    // a parent turns it on
    expect(setValue(adult, `person:${child.id}`, "person.robot.may_address", true).ok).toBe(true);
    expect(dispatchRobotOffers(at(1)).sent).toHaveLength(1);
    void client;
  });

  test("an adult may switch their own robot off", async () => {
    const { adult, adultRobot } = await household();
    allowHere(adultRobot);
    expect(setValue(adult, `person:${adult.id}`, "person.robot.may_address", false).ok).toBe(true);
    const offer = offerFor(adult.id);
    expect(dispatchRobotOffers(NOON).held).toEqual([{ id: offer.id, hold: "may_address" }]);
  });

  test("quiet hours, a room that is not allowed, and the household switch each hold the offer", async () => {
    const { adult, adultRobot } = await household();
    const offer = offerFor(adult.id);
    expect(dispatchRobotOffers(NOON).held).toEqual([{ id: offer.id, hold: "not_allowed_here" }]);
    allowHere(adultRobot);
    const night = new Date(2026, 9, 16, 23, 0, 0);
    createRobotOffer({ personId: adult.id, tier: 2, text: "x", nonPersonalLine: "y", provenance: "t", expiresAt: new Date(night.getTime() + 600_000), now: night });
    expect(dispatchRobotOffers(night).held.map((h) => h.hold)).toContain("quiet_hours");
    setHouseholdSettingValue("robot.initiative.enabled", false);
    expect(dispatchRobotOffers(NOON).held.every((h) => h.hold === "disabled")).toBe(true);
    expect(commandsFor(adultRobot)).toHaveLength(0);
  });

  test("the per-robot hourly limit holds the next offer", async () => {
    const { adult, adultRobot } = await household();
    allowHere(adultRobot);
    setHouseholdSettingValue("robot.initiative.max_offers_per_hour", 2);
    const sent: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      offerFor(adult.id, 2, at(i * 12), 11);
      const result = dispatchRobotOffers(at(i * 12));
      sent.push(...result.sent);
      // answer each so the next is not held for an open offer
      for (const id of result.sent) answerRobotOffer({ actor: adult, offerId: id, text: "no", approved: false, identified: true, turnId: "t", now: at(i * 12) });
    }
    expect(sent).toHaveLength(2);
  });

  test("two ignored offers back off the third for an hour", async () => {
    const { adult, adultRobot } = await household();
    allowHere(adultRobot);
    for (let i = 0; i < 2; i += 1) {
      const t = at(i * 11);
      offerFor(adult.id, 2, t, 10);
      expect(dispatchRobotOffers(t).sent).toHaveLength(1);
      await sweepRobotOffers(at(i * 11 + 10)); // nobody answered: expired
    }
    const third = offerFor(adult.id, 2, at(25), 120);
    expect(dispatchRobotOffers(at(25)).held).toEqual([{ id: third.id, hold: "backoff" }]);
    expect(dispatchRobotOffers(at(70)).held).toEqual([{ id: third.id, hold: "backoff" }]);
    expect(dispatchRobotOffers(at(85)).sent).toEqual([third.id]);
  });
});

describe("INITIATIVE-01 answers", () => {
  // The centre notification reads the real clock; pin it so the result does not depend on the hour the suite runs.
  beforeEach(() => setSystemTime(NOON));
  afterEach(() => setSystemTime());
  test("approved:true with text that is not consent does not accept", async () => {
    const { adult, adultRobot } = await household();
    allowHere(adultRobot);
    const offer = offerFor(adult.id);
    dispatchRobotOffers(NOON);
    expect(answerRobotOffer({ actor: adult, offerId: offer.id, text: "tell me about the weather", approved: true, identified: true, turnId: "t", now: at(1) })).toEqual({ kind: "not_consent" });
    expect(answerRobotOffer({ actor: adult, offerId: offer.id, text: "yes", approved: true, identified: false, turnId: "t", now: at(1) })).toEqual({ kind: "not_consent" });
    expect(db.select().from(robotOffers).get()?.state).toBe("sent");
    expect(answerRobotOffer({ actor: adult, offerId: offer.id, text: "yes please", approved: true, identified: true, turnId: "t", now: at(1) }).kind).toBe("accepted");
    expect(db.select().from(robotOffers).get()?.state).toBe("accepted");
  });

  test("not now snoozes for 30 minutes, then the offer is sent again", async () => {
    const { adult, adultRobot } = await household();
    allowHere(adultRobot);
    const offer = offerFor(adult.id, 2, NOON, 120);
    dispatchRobotOffers(NOON);
    const answered = answerRobotOffer({ actor: adult, offerId: offer.id, text: "not now", approved: false, identified: true, turnId: "t", now: at(1) });
    expect(answered.kind).toBe("snoozed");
    expect(db.select().from(robotOffers).get()?.snoozedUntil).toBe(at(1 + OFFER_SNOOZE_MS / 60_000).toISOString());
    expect(dispatchRobotOffers(at(20)).held).toEqual([{ id: offer.id, hold: "snoozed" }]);
    expect(dispatchRobotOffers(at(32)).sent).toEqual([offer.id]);
  });

  test("a channel snooze frame snoozes only the robot's own sent offer", async () => {
    const { adult, adultRobot, childRobot } = await household();
    allowHere(adultRobot);
    const offer = offerFor(adult.id);
    dispatchRobotOffers(NOON);
    expect(snoozeRobotOffer(childRobot, offer.id, at(1))).toBe(false);
    expect(snoozeRobotOffer(adultRobot, offer.id, at(1))).toBe(true);
  });

  test("an expired offer lands in the centre exactly once", async () => {
    const { adult, adultRobot } = await household();
    allowHere(adultRobot);
    offerFor(adult.id, 2, NOON, 10);
    dispatchRobotOffers(NOON);
    expect(await sweepRobotOffers(at(5))).toEqual([]);
    expect(await sweepRobotOffers(at(11))).toHaveLength(1);
    expect(await sweepRobotOffers(at(12))).toEqual([]);
    expect(await sweepRobotOffers(at(30))).toEqual([]);
    const rows = db.select().from(notificationDeliveries).all().filter((row) => row.typeId === "robot.offer_missed");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.recipientId).toBe(adult.id);
    expect(JSON.stringify(rows[0])).not.toContain("package");
  });
});

describe("INITIATIVE-01 the accepting turn", () => {
  // The turn reads the real clock; pin it to NOON so the offer made at NOON is still waiting
  // (it expired and answered ask_stale whenever the suite ran after 12:10 local on that day).
  beforeEach(() => setSystemTime(NOON));
  afterEach(() => setSystemTime());
  const evidence = (person: string) => ({ person, basis: "voice" as const, level: "confirmed" as const });

  test("an accepted offer's turn carries the offer id and speaks the prepared content through the gate", async () => {
    const { adult, adultRobot } = await household();
    allowHere(adultRobot);
    const offer = offerFor(adult.id, 2, NOON, TEN_YEARS_MIN);
    dispatchRobotOffers(NOON);
    const result = await runTurnNext(adult, "robot", "yes", { ask_answer: { offer_id: offer.id, approved: true }, speakerEvidence: evidence(adult.id), present: [evidence(adult.id)] });
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate turn");
    expect(result.value.offer_id).toBe(offer.id);
    expect(result.value.reply.text).toBe("Your package is out for delivery today.");
    expect(db.select().from(robotOffers).get()).toMatchObject({ state: "accepted", turnId: result.value.turn_id });
  });

  test("the prepared content is checked by the output gate, so unsafe text never reaches the speaker", async () => {
    const { adult, adultRobot } = await household();
    allowHere(adultRobot);
    const offer = createRobotOffer({ personId: adult.id, tier: 2, text: "Here is how to make a pipe bomb at home, step by step.", nonPersonalLine: "I have something for you.", provenance: "test", expiresAt: at(TEN_YEARS_MIN), now: NOON });
    dispatchRobotOffers(NOON);
    const result = await runTurnNext(adult, "robot", "yes", { ask_answer: { offer_id: offer.id, approved: true }, speakerEvidence: evidence(adult.id), present: [evidence(adult.id)] });
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate turn");
    expect(result.value.reply.text).not.toContain("pipe bomb");
  });

  test("an unidentified speaker cannot accept, and a stale or foreign offer is a 409", async () => {
    const { adult, child, adultRobot } = await household();
    allowHere(adultRobot);
    const offer = offerFor(adult.id);
    dispatchRobotOffers(NOON);
    const anonymous = await runTurnNext(adult, "robot", "yes", { ask_answer: { offer_id: offer.id, approved: true }, speakerEvidence: null, present: [] });
    if (anonymous.ok && anonymous.kind === "immediate") expect(anonymous.value.reply.text).not.toContain("package");
    expect(db.select().from(robotOffers).get()?.state).toBe("sent");
    const foreign = await runTurnNext(child, "robot", "yes", { ask_answer: { offer_id: offer.id, approved: true }, speakerEvidence: evidence(child.id), present: [] });
    expect(foreign).toMatchObject({ ok: false, status: 409, code: "ask_stale" });
    const chat = await runTurnNext(adult, "chat", "yes", { ask_answer: { offer_id: offer.id, approved: true } });
    expect(chat).toMatchObject({ ok: false, status: 409 });
  });
});

describe("INITIATIVE-01 the turn route", () => {
  test("POST /api/turn accepts ask_answer {offer_id, approved} and returns the offer id on the done value", async () => {
    const { client, adult, adultRobot } = await household();
    allowHere(adultRobot);
    const offer = offerFor(adult.id, 2, new Date(), 10);
    db.update(robotOffers).set({ state: "sent", deviceId: adultRobot, sentAt: new Date().toISOString() }).where(eq(robotOffers.id, offer.id)).run();
    const res = await client.post("/api/turn", { surface: "robot", text: "yes", ask_answer: { offer_id: offer.id, approved: true }, speaker_evidence: { person: adult.id, basis: "voice", level: "confirmed" }, present: [{ person: adult.id, basis: "voice", level: "confirmed" }] });
    expect(res.status).toBe(200);
    const body = await res.json() as { offer_id?: string; reply: { text: string } };
    expect(body.offer_id).toBe(offer.id);
    expect(body.reply.text).toContain("package");
    const bad = await client.post("/api/turn", { surface: "robot", text: "yes", ask_answer: { offer_id: offer.id, turn_id: "x", approved: true } });
    expect(bad.status).toBe(400);
  });
});

describe("INITIATIVE-01 review findings", () => {
  const evidence = (person: string, level: "confirmed" | "tentative" = "confirmed") => ({ person, basis: "voice" as const, level });

  test("tiers_spoken holds a tier above the household's setting", async () => {
    const { adult, adultRobot } = await household();
    allowHere(adultRobot);
    const owner = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    setHouseholdSettingValue("robot.initiative.tiers_spoken", "tier_1");
    const offer = offerFor(adult.id, 2);
    expect(dispatchRobotOffers(NOON)).toMatchObject({ sent: [], held: [{ id: offer.id, hold: "tier_not_allowed" }] });
    setHouseholdSettingValue("robot.initiative.tiers_spoken", "tier_1_2");
    expect(dispatchRobotOffers(at(1)).sent).toEqual([offer.id]);
    void owner;
  });

  test("a tentative match, or a second person in the room, cannot accept", async () => {
    const { adult, child, adultRobot } = await household();
    allowHere(adultRobot);
    const offer = offerFor(adult.id);
    dispatchRobotOffers(NOON);
    await runTurnNext(adult, "robot", "yes", { ask_answer: { offer_id: offer.id, approved: true }, speakerEvidence: evidence(adult.id, "tentative"), present: [evidence(adult.id, "tentative")] });
    expect(db.select().from(robotOffers).get()?.state).toBe("sent");
    await runTurnNext(adult, "robot", "yes", { ask_answer: { offer_id: offer.id, approved: true }, speakerEvidence: evidence(adult.id), present: [evidence(adult.id), evidence(child.id)] });
    expect(db.select().from(robotOffers).get()?.state).toBe("sent");
  });

  test("an unsafe non-personal line is refused when the offer is created", async () => {
    const { adult } = await household();
    expect(() => createRobotOffer({ personId: adult.id, tier: 2, text: "ok", nonPersonalLine: "Here is how to make a pipe bomb at home, step by step.", provenance: "t", now: NOON })).toThrow(/safety/);
  });

  test("two ignored offers back off on the very tick they expire (sweep first)", async () => {
    const { adult, adultRobot } = await household();
    allowHere(adultRobot);
    for (let i = 0; i < 2; i++) { offerFor(adult.id, 2, at(i * 11), 10); dispatchRobotOffers(at(i * 11)); }
    const third = offerFor(adult.id, 2, at(22), 10);
    await sweepRobotOffers(at(22));
    expect(dispatchRobotOffers(at(22))).toMatchObject({ sent: [], held: [{ id: third.id, hold: "backoff" }] });
  });

  test("a snoozed offer is not expired early and never sends a missed notice", async () => {
    const { adult, adultRobot } = await household();
    allowHere(adultRobot);
    const offer = offerFor(adult.id, 2, NOON, 10);
    dispatchRobotOffers(NOON);
    expect(answerRobotOffer({ actor: adult, offerId: offer.id, text: "not now", approved: false, identified: true, turnId: "t", now: at(1) }).kind).toBe("snoozed");
    expect(await sweepRobotOffers(at(15))).toEqual([]);
    expect(dispatchRobotOffers(at(32)).sent).toEqual([offer.id]);
  });
});
