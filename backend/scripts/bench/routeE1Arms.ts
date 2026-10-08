import { CHAT_SAMPLING } from "@/lib/llm";

export type RouteE1Arm = "A0" | "A0n" | "A2" | "A2n" | "A1";

export interface RouteE1ArmConfig {
  arm: RouteE1Arm;
  modelId: string;
  sampling: "chat" | "nodrx";
  thinking: boolean;
  thinkingBudgetTokens: number;
  samplingParams: Record<string, unknown>;
}

const MODEL_8B = "qwen3-8b-instruct-q4-k-m";
const MODEL_VL_8B = "qwen3-vl-8b-instruct-q4-k-m";

export function routeE1ArmConfig(arm: RouteE1Arm): RouteE1ArmConfig {
  const modelId = arm === "A2" || arm === "A2n" ? MODEL_VL_8B : MODEL_8B;
  const sampling = arm === "A0" || arm === "A2" ? "chat" : "nodrx";
  const thinking = arm === "A1";
  return {
    arm,
    modelId,
    sampling,
    thinking,
    thinkingBudgetTokens: thinking ? 512 : 0,
    samplingParams: sampling === "chat" ? { ...CHAT_SAMPLING } : { temperature: 0.7, min_p: 0.05 },
  };
}

export function isRouteE1Arm(value: string): value is RouteE1Arm {
  return value === "A0" || value === "A0n" || value === "A2" || value === "A2n" || value === "A1";
}
