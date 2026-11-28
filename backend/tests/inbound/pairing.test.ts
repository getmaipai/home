import { beforeEach, describe, expect, test } from "bun:test";
import { createInboundPairing, redeemInboundPairing, __pairingStoreKeysForTests, __resetInboundPairingForTests } from "../../src/lib/inbound/pairing";

describe("inbound pairing", () => {
  beforeEach(() => __resetInboundPairingForTests());

  test("redeems to a binding for the selected person", () => {
    createInboundPairing({ personId: "p1", band: "adult", capabilities: ["remind"] }, { now: () => 100, randomCode: () => "ABC234" });
    expect(redeemInboundPairing({ code: "abc234", externalId: "123", source: "ip1" }, { now: () => 101 })).toEqual({ ok: true, binding: { externalId: "123", personId: "p1", band: "adult", capabilities: ["remind"] } });
  });

  test("child capabilities are forced empty", () => {
    createInboundPairing({ personId: "kid", band: "child", capabilities: ["anything"] }, { now: () => 10, randomCode: () => "ABC234" });
    expect(redeemInboundPairing({ code: "ABC234", externalId: "1", source: "s" }, { now: () => 11 })).toMatchObject({ ok: true, binding: { capabilities: [] } });
  });

  test("a code is one time only", () => {
    createInboundPairing({ personId: "p1", band: "teen", capabilities: [] }, { now: () => 1, randomCode: () => "ABC234" });
    expect(redeemInboundPairing({ code: "ABC234", externalId: "1", source: "s" }, { now: () => 2 }).ok).toBe(true);
    expect(redeemInboundPairing({ code: "ABC234", externalId: "2", source: "s" }, { now: () => 3 })).toEqual({ ok: false, reason: "invalid" });
  });

  test("rejects handles without consuming the code or counting a wrong guess", () => {
    createInboundPairing({ personId: "p1", band: "adult", capabilities: [] }, { now: () => 1, randomCode: () => "ABC234" });
    expect(redeemInboundPairing({ code: "ABC234", externalId: "@sage", source: "s" }, { now: () => 2 })).toEqual({ ok: false, reason: "bad-id" });
    expect(redeemInboundPairing({ code: "ABC234", externalId: "1", source: "s" }, { now: () => 3 }).ok).toBe(true);
  });

  test("expires and deletes codes", () => {
    createInboundPairing({ personId: "p1", band: "adult", capabilities: [] }, { now: () => 100, randomCode: () => "ABC234" });
    expect(redeemInboundPairing({ code: "ABC234", externalId: "1", source: "s" }, { now: () => 600100 })).toEqual({ ok: false, reason: "expired" });
    expect(__pairingStoreKeysForTests()).toEqual([]);
  });

  test("locks a source after five wrong codes for fifteen minutes", () => {
    createInboundPairing({ personId: "p1", band: "adult", capabilities: [] }, { now: () => 1, randomCode: () => "ABC234" });
    createInboundPairing({ personId: "p2", band: "adult", capabilities: [] }, { now: () => 600000, randomCode: () => "DEF567" });
    for (let i = 0; i < 5; i++) expect(redeemInboundPairing({ code: "ZZZ999", externalId: "1", source: "s" }, { now: () => 2 + i })).toEqual({ ok: false, reason: "invalid" });
    expect(redeemInboundPairing({ code: "ABC234", externalId: "1", source: "s" }, { now: () => 10 })).toEqual({ ok: false, reason: "locked" });
    expect(redeemInboundPairing({ code: "DEF567", externalId: "1", source: "s" }, { now: () => 900006 }).ok).toBe(true);
  });

  test("stores only a hash and never returns the plain code on failure", () => {
    const code = "ABC234";
    createInboundPairing({ personId: "p1", band: "adult", capabilities: [] }, { now: () => 1, randomCode: () => code });
    expect(__pairingStoreKeysForTests()).not.toContain(code);
    const failed = redeemInboundPairing({ code: "wrong", externalId: "1", source: "s" }, { now: () => 2 });
    expect(JSON.stringify(failed)).not.toContain(code);
  });
});
