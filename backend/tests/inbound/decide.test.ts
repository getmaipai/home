import { describe, expect, test } from "bun:test";
import { decideInbound, type Binding } from "../../src/lib/inbound/decide";

const adult: Binding = { externalId: "1001", personId: "p-adult", band: "adult", capabilities: ["remind", "lists"] };
const teen: Binding = { externalId: "1002", personId: "p-teen", band: "teen", capabilities: ["remind"] };
const child: Binding = { externalId: "1003", personId: "p-child", band: "child", capabilities: ["remind", "lists"] };
const all = [adult, teen, child];

describe("decideInbound", () => {
  test("a paired adult acts as that member with the granted tools, and the turn is tainted", () => {
    expect(decideInbound(all, { senderId: "1001", isGroup: false })).toEqual({ speaker: "member", personId: "p-adult", band: "adult", tools: ["remind", "lists"], tainted: true, reason: "bound" });
  });

  test("a teen or a child binding gets no tools, but is still that member at that band", () => {
    expect(decideInbound(all, { senderId: "1002", isGroup: false })).toEqual({ speaker: "member", personId: "p-teen", band: "teen", tools: [], tainted: true, reason: "bound" });
    expect(decideInbound(all, { senderId: "1003", isGroup: false })).toEqual({ speaker: "member", personId: "p-child", band: "child", tools: [], tainted: true, reason: "bound" });
  });

  test("a stranger is an unknown speaker at the child band with no tools", () => {
    expect(decideInbound(all, { senderId: "9999", isGroup: false })).toEqual({ speaker: "unknown", personId: null, band: "child", tools: [], tainted: true, reason: "no-binding" });
  });

  test("a group chat is an unknown speaker at the child band, even for a paired adult", () => {
    expect(decideInbound(all, { senderId: "1001", isGroup: true })).toEqual({ speaker: "unknown", personId: null, band: "child", tools: [], tainted: true, reason: "group" });
  });

  test("a revoked binding is a stranger", () => {
    const revoked: Binding = { ...adult, revoked: true };
    expect(decideInbound([revoked], { senderId: "1001", isGroup: false })).toEqual({ speaker: "unknown", personId: null, band: "child", tools: [], tainted: true, reason: "revoked" });
  });

  test("senders match by numeric id only: a handle never matches, even a binding stored as a handle", () => {
    const byHandle: Binding = { externalId: "@sage", personId: "p-adult", band: "adult", capabilities: ["remind"] };
    expect(decideInbound([byHandle], { senderId: "@sage", isGroup: false })).toEqual({ speaker: "unknown", personId: null, band: "child", tools: [], tainted: true, reason: "id-mismatch" });
    expect(decideInbound(all, { senderId: "sage", isGroup: false }).reason).toBe("id-mismatch");
    expect(decideInbound(all, { senderId: "", isGroup: false }).reason).toBe("id-mismatch");
  });

  test("ids compare exactly: no trimming, no case folding, no partial match", () => {
    expect(decideInbound(all, { senderId: " 1001", isGroup: false }).reason).toBe("id-mismatch");
    expect(decideInbound(all, { senderId: "10011", isGroup: false }).reason).toBe("no-binding");
    expect(decideInbound(all, { senderId: "100", isGroup: false }).reason).toBe("no-binding");
  });

  test("two bindings for the same sender id is ambiguous and is refused as a stranger", () => {
    const dup: Binding = { ...teen, externalId: "1001" };
    expect(decideInbound([adult, dup], { senderId: "1001", isGroup: false })).toEqual({ speaker: "unknown", personId: null, band: "child", tools: [], tainted: true, reason: "no-binding" });
  });

  test("the granted tools are a copy, never the binding's own array, and the input is not changed", () => {
    const input = [{ ...adult, capabilities: ["remind"] }];
    const copy = JSON.stringify(input);
    const out = decideInbound(input, { senderId: "1001", isGroup: false });
    out.tools.push("send_email");
    expect(JSON.stringify(input)).toBe(copy);
  });

  test("an empty binding list gives a stranger", () => {
    expect(decideInbound([], { senderId: "1001", isGroup: false }).reason).toBe("no-binding");
  });
});
