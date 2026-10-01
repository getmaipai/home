import { isStackRoleEnabled } from "@/lib/stackEngine";

export type EngineWarmup = "chat" | "embed" | "tts";

export function engineWarmupsForStackRoles(): EngineWarmup[] {
  return [
    ...(!isStackRoleEnabled("chat") ? ["chat" as const] : []),
    ...(!isStackRoleEnabled("embeddings") ? ["embed" as const] : []),
    ...(!isStackRoleEnabled("tts") ? ["tts" as const] : []),
  ];
}
