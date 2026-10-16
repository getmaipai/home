import { describe, expect, test } from "bun:test";
import { engineImpact, type EngineImpactProposal } from "@/lib/engineImpact";

const base = (): EngineImpactProposal => ({
  hardware: { unifiedMemory: false, systemMemoryBytes: 16 * 1024 ** 3, graphicsMemoryBytes: 12 * 1024 ** 3 },
  roles: [
    { role: "chat", label: "Chat", proposed: "large", choices: [
      { id: "large", label: "Large", memoryBytes: 7 * 1024 ** 3, speed: "steady" },
      { id: "small", label: "Small", memoryBytes: 4 * 1024 ** 3, speed: "fast", loses: ["stronger answers to hard questions"] },
    ] },
    { role: "image", label: "Pictures", proposed: "pictures", choices: [
      { id: "pictures", label: "Pictures", memoryBytes: 3 * 1024 ** 3, speed: "steady" },
    ] },
  ],
  choices: { chat: "large", image: "pictures" },
});

describe("engineImpact", () => {
  test("accepts a set that fits and reports what each role uses", () => {
    const result = engineImpact(base());
    expect(result.fits).toBe(true);
    expect(result.usedBytes).toBe(10 * 1024 ** 3);
    expect(result.roles[0]?.impact).toContain("Keeps 7.0 GB");
  });

  test("refuses an allocation that does not fit and names roles to turn down", () => {
    const proposal = base();
    proposal.choices.chat = "large";
    proposal.choices.image = "pictures";
    proposal.roles[0]!.choices[0]!.memoryBytes = 10 * 1024 ** 3;
    expect(engineImpact(proposal).refusal).toContain("Turn down Chat, Pictures");
  });

  test("uses system memory for unified memory machines", () => {
    const proposal = base();
    proposal.hardware.unifiedMemory = true;
    expect(engineImpact(proposal).availableBytes).toBe(28 * 1024 ** 3);
  });

  test("asks for total video memory when graphics memory is unknown", () => {
    const proposal = base();
    proposal.hardware.graphicsMemoryBytes = null;
    const result = engineImpact(proposal);
    expect(result.fits).toBeNull();
    expect(result.memoryQuestion).toContain("How much video memory");
  });

  test("asks for total video memory when unified memory is missing a reading", () => {
    const proposal = base();
    proposal.hardware.unifiedMemory = true;
    proposal.hardware.systemMemoryBytes = null;
    const result = engineImpact(proposal);
    expect(result.fits).toBeNull();
    expect(result.memoryQuestion).toContain("How much video memory");
  });

  test("reports freed memory and the trade when a role is turned off", () => {
    const proposal = base();
    proposal.choices.image = "off";
    const result = engineImpact(proposal);
    expect(result.freedBytes).toBe(3 * 1024 ** 3);
    expect(result.trade).toContain("chat can use a bigger model");
  });
});
