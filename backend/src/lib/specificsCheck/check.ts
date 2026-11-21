import { completeBackground } from "@/lib/llm";

const INSTRUCTION = 'Decide whether the reply states specific names, figures, or dates that the turn gives no basis for. Treat injected memory as a possible basis. Answer only JSON: {"specifics_without_basis": true|false}.';
export const __specificsCheckInstructionForTests = INSTRUCTION;

export async function runSpecificsCheck(input: { question: string; reply: string; memoryInjected: boolean }): Promise<"flagged" | "clear" | "unavailable"> {
  const controller = new AbortController();
  let deadline: ReturnType<typeof setTimeout>;
  const timedOut = new Promise<null>((resolve) => {
    deadline = setTimeout(() => { controller.abort(); resolve(null); }, 1500);
    deadline.unref?.();
  });
  try {
    const variable = `Question: ${input.question}\nReply: ${input.reply}\nMemory injected: ${input.memoryInjected}`;
    const result = await Promise.race([completeBackground([
      { role: "system", content: INSTRUCTION },
      { role: "user", content: variable },
    ], { max_tokens: 40, thinking: false, timeoutMs: 1500, signal: controller.signal }), timedOut]);
    if (result === null || controller.signal.aborted || !result.ok) return "unavailable";
    const parsed: unknown = JSON.parse(result.text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "unavailable";
    const keys = Object.keys(parsed);
    if (keys.length !== 1 || keys[0] !== "specifics_without_basis" || typeof (parsed as { specifics_without_basis?: unknown }).specifics_without_basis !== "boolean") return "unavailable";
    return (parsed as { specifics_without_basis: boolean }).specifics_without_basis ? "flagged" : "clear";
  } catch {
    return "unavailable";
  } finally { clearTimeout(deadline!); }
}
