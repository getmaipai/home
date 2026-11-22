// CODE-AGENT-01 fakes: an agent and a sandbox that record what they were asked and finish when the test says so. The real ones are the OpenCode
// bridge and the Stack's /stack/v1/sandboxes (later slices).
import type { CodingAgent, CodingSandbox, CodingTurnResult } from "../src/lib/codingTurns";
import type { Tier } from "../src/lib/tiers";

export interface AgentCall { sessionId: string; turnId: string; tier: Tier; message: string }
export function fakeAgent(over: { result?: CodingTurnResult; fail?: boolean } = {}) {
  const calls: AgentCall[] = [];
  const waiting: Array<() => void> = [];
  let hold = true;
  const agent: CodingAgent = {
    runTurn: async (input) => {
      calls.push({ sessionId: input.sessionId, turnId: input.turnId, tier: input.tier, message: input.message });
      if (hold && !input.signal.aborted) await new Promise<void>((resolve) => { waiting.push(resolve); input.signal.addEventListener("abort", () => resolve()); });
      if (over.fail) throw new Error("/home/willow/secret-repo: agent crashed");
      return over.result ?? { modelId: "coding-model-1", usage: { input_tokens: 10, output_tokens: 5 } };
    },
  };
  return { agent, calls, finishAll: () => { for (const w of waiting.splice(0)) w(); }, autoFinish: () => { hold = false; finishAllNow(); } , get running() { return waiting.length; } };
  function finishAllNow() { for (const w of waiting.splice(0)) w(); }
}
export function fakeSandbox() {
  const events: string[] = [];
  const sandbox: CodingSandbox = {
    start: async ({ sessionId }) => { events.push(`start:${sessionId}`); },
    stop: async (id) => { events.push(`stop:${id}`); },
    destroy: async (id) => { events.push(`destroy:${id}`); },
  };
  return { sandbox, events };
}
