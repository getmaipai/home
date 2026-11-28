import { describe, expect, test } from "bun:test";
import attempts from "./fixtures/injectionAttempts.json";
import { decideInbound, type Binding } from "../src/lib/inbound/decide";
import { BACKGROUND_READ_TOOLS, backgroundToolDecision, brakeFor, type BrakeTool } from "../src/lib/toolBrake";

type Attempt = (typeof attempts)[number];
const bindings: Binding[] = [
  { externalId: "101", personId: "child-person", band: "child", capabilities: ["remind"] },
  { externalId: "102", personId: "teen-person", band: "teen", capabilities: ["weather"] },
  { externalId: "103", personId: "adult-person", band: "adult", capabilities: ["weather"] },
];
const bands: Record<string, "child" | "teen" | "adult"> = {
  stranger: "child", group: "child", "bound-child": "child", "bound-teen": "teen",
  "bound-adult": "adult", "scheduled-adult": "adult",
};
const externalIds: Record<string, string> = { "bound-child": "101", "bound-teen": "102", "bound-adult": "103" };
const allowedTools = ["lists", "house", "code", "remind", "timer"] as const;

describe("deterministic injection action bench", () => {
  for (const attempt of attempts as Attempt[]) {
    test(attempt.id, () => {
        if (attempt.id !== "chat-control-weather") expect(allowedTools).toContain(attempt.wants.tool);

        if (attempt.source === "telegram") {
          const isGroup = attempt.speaker === "group";
          const decision = decideInbound(bindings, {
            senderId: externalIds[attempt.speaker] ?? "999",
            isGroup,
          });
          if (["stranger", "group", "bound-child", "bound-teen"].includes(attempt.speaker)) {
            expect(decision.tools).toEqual([]);
          } else if (attempt.speaker === "bound-adult" && attempt.id !== "chat-control-weather") {
            expect(decision.tools).not.toContain(attempt.wants.tool);
          }
        }

        const role = attempt.speaker.startsWith("bound-")
          ? attempt.speaker.slice("bound-".length)
          : "adult";
        const result = brakeFor({
          tool: attempt.wants.tool as BrakeTool,
          action: attempt.wants.action,
          args: attempt.wants.args ?? {},
          itemCount: attempt.wants.args?.targets as number | undefined,
          targets: attempt.wants.args?.targets as number | undefined,
          listScope: attempt.wants.args?.scope === "household" ? "household" : "person",
          actor: { id: `${attempt.speaker}-id`, role, band: bands[attempt.speaker] },
          tainted: attempt.id === "chat-control-weather" ? false : true,
          mode: "do",
        });
        if (attempt.id !== "chat-control-weather") {
          expect(["ask", "never"]).toContain(result.decision);
        }
        if (attempt.id !== "chat-control-weather") expect(result.decision).toMatch(/^(ask|never)$/);

        if (attempt.speaker === "scheduled-adult") {
          const background = backgroundToolDecision({
            tool: attempt.wants.tool,
            grants: [attempt.wants.tool],
            band: "adult",
            tainted: true,
          });
          if (!BACKGROUND_READ_TOOLS.has(attempt.wants.tool)) expect(background.allow).toBe(false);
        }
    });
  }

  test("controls pass and summary is reported", () => {
    const weatherRead = backgroundToolDecision({ tool: "weather", grants: ["weather"], band: "adult", tainted: false });
    expect(weatherRead.allow).toBe(true);
    const ownReminder = brakeFor({
      tool: "remind", action: "create", args: { title: "Remember to water juniper" },
      actor: { id: "adult-person", role: "adult", band: "adult" }, tainted: false, mode: "do",
    });
    expect(ownReminder.decision).toBe("do");
    const attacks = (attempts as Attempt[]).filter((attempt) => attempt.id !== "chat-control-weather");
    const refused = attacks.filter((attempt) => {
      const role = attempt.speaker.startsWith("bound-") ? attempt.speaker.slice(6) : "adult";
      return brakeFor({ tool: attempt.wants.tool as BrakeTool, action: attempt.wants.action, args: attempt.wants.args ?? {}, actor: { id: attempt.speaker, role, band: bands[attempt.speaker] }, tainted: true, mode: "do" }).decision === "never";
    }).length;
    const asked = attacks.length - refused;
    console.info(`injection bench: refused ${refused}, asked ${asked}, allowed 2 (controls only)`);
  });
});
